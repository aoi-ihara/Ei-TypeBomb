import express from "express";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { Server } from "socket.io";
import type { Room, User } from "./type";
import { verifyToken, verifyClientSessionToken } from "./lib/auth";
import { getRoomFromId } from "./lib/get";
import { capturePostHogEvent } from "./lib/posthog";
import { createSocketRateLimit } from "./lib/socketRateLimit";
import { createHealthRttProbeRateLimit } from "./lib/healthRttProbeRateLimit";
import {
    logError,
    logEvent,
    recordLatencySample,
    setServerState,
    startConsole,
} from "./lib/console";

import {
    ClientError,
    requireRoomItems,
    validateAuthPayload,
    isRequestId,
    parseClientEvent,
} from "../../shared/validation";
import { canStart, type GameEvent } from "../../shared/game";
import { canDeleteRoom, disconnectDeadline } from "../../shared/session";
import {
    roomSnapshot,
    type ClientPayloads,
    type ServerPayloads,
    type EventHandlers,
} from "../../shared/protocol";
import { NodeGameAdapter, NODE_GAME_RULES } from "./lib/gameAdapter";
import { Identity } from "../../shared/distributed/identity";
import { parseETBClusterConfig } from "../../shared/clusterConfig";
import { parseServerTopology } from "../../shared/topology";

import { clusterConfig, assertClusterIdentity } from "../../shared/distributed/control";
import { DistributedRoom } from "../../shared/distributed/runtime";
import { PeerControl } from "../../shared/distributed/peers";
import { parsePageExit } from "../../shared/distributed/pageExit";
import { recoveryFailure } from "../../shared/distributed/recovery";
import { persistentPeerIdentity, nodeClusterEnv } from "./lib/peerStorage";
import { MAX_CLUSTER_FRAME_BYTES, bufferPeerSocket } from "../../shared/distributed/link";
import { WebSocket as PeerSocket, WebSocketServer } from "ws";
import { NODE_DISCONNECT_GRACE_MS, type Command } from "../../shared/distributed/types";
const clusterEnv = nodeClusterEnv(process.env);
const topology = parseServerTopology(clusterEnv, "socket.io");
const config = clusterConfig(clusterEnv, "socket.io");
let cluster: PeerControl | null = null;
const clusterReady = config
    ? Identity.generate(parseETBClusterConfig(clusterEnv.ETB_CLUSTER_CONFIG!), config.id)
        .then(declaration => persistentPeerIdentity(declaration, process.env.CLUSTER_STATE_DIR ?? ".cluster-state")).then(async ({ identity, storage }) => {
          assertClusterIdentity(process.env, identity);
          cluster = new PeerControl(identity, config, async (id) => {
              const url = new URL("/cluster/ws", id);
              url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
              const socket = new PeerSocket(url, {
                  maxPayload: MAX_CLUSTER_FRAME_BYTES,
              });
              const buffered = bufferPeerSocket(socket as unknown as import("../../shared/distributed/link").ClusterSocket);
              await new Promise<void>((resolve, reject) => {
                  const timer = setTimeout(() => {
                      socket.close();
                      reject(new Error("Peer connection timeout"));
                  }, 1500);
                  socket.once("open", () => {
                      clearTimeout(timer);
                      resolve();
                  });
                  socket.once("error", (error) => {
                      clearTimeout(timer);
                      reject(error);
                  });
              });
              return buffered;
          }, storage);
          await cluster.restoreRegistry(storage.members());
          cluster.draining = process.env.CLUSTER_DRAINING === "true";
      })
    : Promise.resolve();

const games = new Map<string, NodeGameAdapter | DistributedRoom>();
// Game identity is scoped to a signed, tab-specific session, not a transport ID.
const recommendedItems = new Map<string, string>();
const liveSessions = new Map<string, string>();
const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>();
const sessionKey = (roomId: string, playerId: string) =>
    `${roomId}:${playerId}`;

let rooms: Room[] = [];
const pendingRoomLoads = new Map<string, Promise<Room | null>>();

const app = express();
const httpServer = createServer(app);
app.get("/health", (_req, res) => {
    // Public, credential-free browser RTT probe. Cache and CORS are explicit
    // so a previous response cannot masquerade as current availability.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
});
app.get("/cluster/identity", async (_req, res) => {
    try {
        await clusterReady;
        res.setHeader("Cache-Control", "no-store");
        if (!cluster) { res.sendStatus(404); return; }
        res.json(cluster.identity.publicIdentity());
    } catch { res.sendStatus(503); }
});
app.use(["/cluster/route", "/cluster/report"], express.json({ limit: "8kb" }));
for (const path of ["/cluster/route", "/cluster/report"]) {
    app.options(path, (_req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "content-type");
        res.setHeader("Access-Control-Allow-Methods", "POST");
        res.status(204).end();
    });
    app.post(path, async (req, res) => {
        const requestStartedAt = performance.now();
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Expose-Headers", "Server-Timing");
        const timings: Record<string, number> = {};
        const exposeTimings = () => {
            const labels: Record<string, string> = {
                readMs: "read",
                ownerProbeMs: "ownerProbe",
                promoteMs: "promote",
                resumeMs: "resume",
                authMs: "auth",
                totalMs: "total",
                resumeReadMs: "resumeRead",
                resumeOpenMs: "resumeOpen",
            };
            timings.totalMs = performance.now() - requestStartedAt;
            res.setHeader("Server-Timing", Object.entries(timings)
                .filter(([key, value]) => labels[key] &&
                    Number.isFinite(value) && value >= 0)
                .map(([key, value]) =>
                    `${labels[key]};dur=${value.toFixed(2)}`)
                .join(", "));
        };
        try {
            if (!cluster) {
                res.status(404).end();
                return;
            }
            const roomId = await verifyToken(req.body?.jwtToken);
            if (!roomId || (req.body.roomId && req.body.roomId !== roomId)) {
                res.status(403).end();
                return;
            }
            if (path.endsWith("report")) {
                await verifyClientSessionToken(req.body.sessionToken, roomId);
                if (req.body.failure !== true)
                    throw new Error("Missing failure report");
            }
            timings.authMs = performance.now() - requestStartedAt;
            const result = await cluster.call(
                path.endsWith("report") ? "report" : "read",
                { roomId, expectedInstance: req.body.expectedInstance, owner: req.body.owner, revision: req.body.revision,
                    diagnosticTimings: timings },
            );
            if (
                path.endsWith("report") &&
                result.ownership?.owner === cluster.config.id &&
                result.ownership.lifecycle === "MIGRATING"
            ) {
                const resumeStartedAt = performance.now();
                try {
                    await createRoomIfNeeded(roomId, req.body.jwtToken, timings);
                } finally {
                    timings.resumeMs = performance.now() - resumeStartedAt;
                }
            }
            exposeTimings();
            res.json({ ownership: result.ownership, servers: result.servers });
        } catch (error) {
            // Keep authentication errors and peer secrets out of HTTP responses.
            // Server-side diagnostics distinguish identity, connectivity and
            // missing certified checkpoints during failover experiments.
            const message = error instanceof Error ? error.message : "Unknown error";
            console.error(`Cluster ${path} failed:`, message);
            exposeTimings();
            const failure = recoveryFailure(error);
            if (failure) res.status(409).json(failure);
            else res.status(503).end();
        }
    });
}
// text/plain is CORS-safelisted: a closing page must not need a preflight.
app.options("/cluster/leave", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    res.setHeader("Access-Control-Allow-Methods", "POST");
    res.status(204).end();
});
app.post("/cluster/leave", express.text({ type: "text/plain", limit: "8kb" }),
    express.json({ limit: "8kb" }), async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    try {
        if (!cluster) { res.status(404).end(); return; }
        const data = parsePageExit(typeof req.body === "string" ? JSON.parse(req.body) : req.body);
        const roomId = await verifyToken(data.jwtToken);
        if (!roomId) { res.status(403).end(); return; }
        const id = await verifyClientSessionToken(data.sessionToken, roomId);
        const saved = await cluster.call("read", { roomId, expectedInstance: data.expectedInstance });
        if (saved.ownership?.instance !== data.expectedInstance || saved.ownership.owner !== cluster.config.id) {
            res.status(409).end(); return;
        }
        if (saved.ownership.lifecycle !== "DELETED") {
            await createRoomIfNeeded(roomId, data.jwtToken, undefined, data.expectedInstance, false);
            const game = games.get(roomId);
            if (!(game instanceof DistributedRoom)) { res.status(409).end(); return; }
            // A page cached by the browser may retain its live socket. Keep
            // its authentication until actual disconnect, just like room:leave.
            const socketId = liveSessions.get(sessionKey(roomId, id));
            const live = socketId === data.connectionId && !!io.sockets.sockets.get(socketId)?.connected;
            await game.closeSession(id, data.expectedInstance, data.connectionId, live);
        }
        res.status(204).end();
    } catch (error) {
        console.error("Page exit rejected:", error instanceof Error ? error.message : "Unknown error");
        res.status(409).end();
    }
});
const peerServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_CLUSTER_FRAME_BYTES,
});
httpServer.on("upgrade", (request, socket, head) => {
    if (request.url !== "/cluster/ws") return;
    if (!cluster) {
        socket.destroy();
        return;
    }
    peerServer.handleUpgrade(request, socket, head, (ws) => {
        void cluster!
            .accept(
                ws as unknown as import("../../shared/distributed/link").ClusterSocket,
            )
            .catch(() => ws.close());
    });
});
const io = new Server<
    EventHandlers<ClientPayloads>,
    EventHandlers<ServerPayloads>
>(httpServer, {
    maxHttpBufferSize: 8192,
    destroyUpgrade: false,
    // A missing peer is detected within roughly 8 seconds of its last ping.
    // Explicit disconnects still remove the player immediately.
    pingInterval: 3_000,
    pingTimeout: 5_000,
    cors: { origin: "*", methods: ["GET", "POST"] },
});
const acceptHealthRttProbe = createHealthRttProbeRateLimit();

const refreshServerState = () =>
    setServerState({
        rooms: rooms.map((room) => ({
            id: room.id,
            players: (room.users ?? []).map((player) => ({
                id: player.id,
                displayName: player.displayName,
            })),
            isStart: Boolean(room.isStart),
            bombHolder: room.bombs?.[0]?.holder ?? room.bombHolder,
            bombHolders: room.bombs?.map((bomb) => bomb.holder),
        })),
    });

const createRoomIfNeeded = async (
    roomId: string,
    jwtToken: string,
    timings?: Record<string, number>,
    expectedInstance?: string,
    allowCreate = true,
): Promise<Room | null> => {
    const existingRoom = rooms.find((item) => item.id === roomId);
    if (existingRoom) return Promise.resolve(existingRoom);

    const pendingLoad = pendingRoomLoads.get(roomId);
    if (pendingLoad) return pendingLoad;

    const loadPromise = (async () => {
        if (cluster) {
            const readStartedAt = performance.now();
            let saved: Awaited<ReturnType<typeof cluster.call>>;
            try {
                saved = await cluster.call("read", { roomId, expectedInstance });
            } finally {
                if (timings) timings.resumeReadMs =
                    performance.now() - readStartedAt;
            }
            const fresh =
                !saved.ownership || saved.ownership.lifecycle === "DELETED";
            if (fresh && !allowCreate) return null;
            // Any surviving certified tier may initialize a genuinely fresh
            // room, using its own signed suffix voting cohort.
            const initial = fresh
                ? await getRoomFromId(roomId, jwtToken)
                : undefined;
            if (initial) requireRoomItems(initial);
            if (
                (!saved.ownership || saved.ownership.lifecycle === "DELETED") &&
                !initial
            )
                return null;
            const game = new DistributedRoom(roomId, cluster, (result) => {
                const index = rooms.findIndex((room) => room.id === roomId);
                const previous = index < 0 ? undefined : rooms[index];
                if (index < 0) rooms.push(result.state.room);
                else rooms[index] = result.state.room;
                // Distributed checkpoints do not go through NodeGameAdapter's
                // state/activity callbacks. Keep the server console in sync
                // without refreshing on every typing/input checkpoint.
                const oldPlayers = previous?.users.map((user) => user.id) ?? [];
                const newPlayers = result.state.room.users.map((user) => user.id);
                const membershipChanged =
                    oldPlayers.length !== newPlayers.length ||
                    oldPlayers.some((id, i) => id !== newPlayers[i]);
                const gameChanged =
                    previous?.isStart !== result.state.room.isStart ||
                    previous?.gameId !== result.state.room.gameId;
                const bombChanged =
                    previous?.bombHolder !== result.state.room.bombHolder ||
                    JSON.stringify(previous?.bombs?.map((bomb) => bomb.holder) ?? []) !==
                        JSON.stringify(result.state.room.bombs?.map((bomb) => bomb.holder) ?? []);
                if (membershipChanged || gameChanged || bombChanged || index < 0) {
                    refreshServerState();
                    for (const id of newPlayers.filter((id) => !oldPlayers.includes(id)))
                        logEvent("ROOM", `joined ${roomId}`, { roomId, playerId: id });
                    for (const id of oldPlayers.filter((id) => !newPlayers.includes(id)))
                        logEvent("ROOM", `left ${roomId}`, { roomId, playerId: id });
                    if (gameChanged && previous)
                        logEvent("GAME", `state changed ${roomId}`, {
                            roomId,
                            isStart: result.state.room.isStart,
                        });
                }
                for (const effect of result.effects)
                    if (
                        effect.type === "broadcast" &&
                        effect.packet.event !== "room:broadcast"
                    ) {
                        const emit = io.to(roomId).emit.bind(io.to(roomId)) as (
                            event: string,
                            data?: unknown,
                        ) => boolean;
                        emit(effect.packet.event, effect.packet.data);
                    }
                io.to(roomId).emit("room:broadcast", game.snapshot());
            });
            const openStartedAt = performance.now();
            try {
                await game.open(initial ?? undefined);
            } finally {
                if (timings) timings.resumeOpenMs =
                    performance.now() - openStartedAt;
            }
            games.set(roomId, game);
            if (!rooms.some((room) => room.id === roomId))
                rooms.push(game.state.room);
            refreshServerState();
            logEvent("ROOM", `loaded ${roomId}`, { roomId });
            return game.state.room;
        }
        const room = await getRoomFromId(roomId, jwtToken);
        if (!room) return null;
        requireRoomItems(room);

        const roomAfterFetch = rooms.find((item) => item.id === roomId);
        if (roomAfterFetch) return roomAfterFetch;

        const newRoom: Room = {
            ...room,
            users: [],
            isStart: false,
            gameId: undefined,
            bombStatus: 0,
            bombHolder: 0,
        };

        rooms.push(newRoom);
        games.set(
            roomId,
            new NodeGameAdapter(
                { room: newRoom, revision: 0 },
                (result, previous, event) => {
                    if (result.state.room !== previous.room) {
                        const index = rooms.findIndex(
                            (item) => item.id === roomId,
                        );
                        if (index === -1) return;
                        rooms[index] = result.state.room;
                        // Typing focus/input is deliberately lightweight: don't
                        // scan every room or emit server-state logs per keystroke.
                        if (
                            event.type !== "currentInput" &&
                            event.type !== "hint:update"
                        )
                            refreshServerState();
                    }
                    for (const effect of result.effects) {
                        if (effect.type === "broadcast") {
                            const packet = effect.packet;
                            // The protocol union pairs each event with its payload. Socket.IO
                            // cannot infer that correlation through a variadic generic emit.
                            const target = io.to(roomId);
                            const emit = target.emit.bind(target) as (
                                event: string,
                                data?: unknown,
                            ) => boolean;
                            if (packet.data === undefined) emit(packet.event);
                            else emit(packet.event, packet.data);
                        } else {
                            const activity = effect.activity;
                            logEvent("GAME", `${activity.event} ${roomId}`, {
                                roomId,
                                gameId:
                                    result.state.room.gameId ??
                                    previous.room.gameId,
                                playerCount: activity.playerCount,
                                reason: activity.reason,
                                previousHolder:
                                    previous.room.users[
                                        previous.room.bombHolder
                                    ],
                                nextHolder:
                                    result.state.room.users[
                                        result.state.room.bombHolder
                                    ],
                            });
                            if (activity.event !== "word_passed")
                                capturePostHogEvent(activity.event, {
                                    player_count: activity.playerCount,
                                    ...(activity.reason
                                        ? { reason: activity.reason }
                                        : {}),
                                });
                        }
                    }
                },
                Date.now,
                Math.random,
                (message, metadata) =>
                    logEvent("GAME", `bomb_timer:${message} ${roomId}`, {
                        roomId,
                        ...metadata,
                    }),
                (playerId, currentRoom) => {
                    const itemId = recommendedItems.get(playerId);
                    if (!itemId) return undefined;
                    const index = currentRoom.items.findIndex(
                        (item) => item.id === itemId,
                    );
                    return index >= 0 ? index : undefined;
                },
            ),
        );
        refreshServerState();
        logEvent("ROOM", `created ${roomId}`, { roomId });
        return newRoom;
    })();

    pendingRoomLoads.set(roomId, loadPromise);

    return loadPromise.finally(() => {
        if (pendingRoomLoads.get(roomId) === loadPromise) {
            pendingRoomLoads.delete(roomId);
        }
    });
};

const sendRoomInfo = (roomId: string | null) => {
    if (!roomId) return;
    const room = rooms.find((item) => item.id === roomId);
    if (!room) return;
    const game = games.get(roomId);
    if (game instanceof DistributedRoom) {
        if (!game.halted && !game.deleted)
            io.to(roomId).emit("room:broadcast", game.snapshot());
    } else
        io.to(roomId).emit(
            "room:broadcast",
            roomSnapshot(room, game?.state.revision ?? 0),
        );
};

io.on("connection", (socket) => {
    socket.use(createSocketRateLimit());

    let pingStartedAt: number | undefined;
    socket.conn.on("packetCreate", (packet) => {
        if (packet.type === "ping") pingStartedAt = performance.now();
    });
    socket.conn.on("packet", (packet) => {
        if (packet.type !== "pong" || pingStartedAt === undefined) return;
        recordLatencySample(performance.now() - pingStartedAt);
        pingStartedAt = undefined;
    });

    let user: User = { id: socket.id };
    let roomId: null | string = null;
    const getGame = () => (roomId ? games.get(roomId) : undefined);
    const isCurrentSession = () => !!roomId &&
        liveSessions.get(sessionKey(roomId, user.id)) === socket.id;
    const applyEvent = (event: GameEvent) => {
        if (!isCurrentSession()) return;
        const game = getGame();
        if (game) void Promise.resolve(game.apply(event)).catch(error =>
            logError("Room event failed", error, { roomId, userId: user.id, event: event.type }));
    };
    logEvent("SERVER", "client connected", { socketId: socket.id });
    socket.emit("auth:request");

    socket.on("health:ping", (pingId: unknown) => {
        if (!isRequestId(pingId)) return;
        if (!acceptHealthRttProbe(socket.handshake.address)) return;
        socket.emit("health:pong", pingId);
    });

    const reportError = (
        message: string,
        error: unknown = new Error(message),
    ) => {
        logError(message, error, {
            socketId: socket.id,
            userId: user.id,
            displayName: user.displayName,
            roomId,
        });
        socket.emit("error", { message, ...recoveryFailure(error) });
    };

    const emitRaw = socket.emit.bind(socket) as (
        event: string,
        data?: unknown,
    ) => boolean;
    // Every authoritative mutation carries a retry-stable event ID and fencing metadata.
    socket.on("cluster:ping", () => {
        const game = getGame();
        if (
            game instanceof DistributedRoom &&
            !game.halted &&
            game.checkpoint.ownership.owner === cluster?.config.id
        )
            emitRaw("cluster:pong");
    });
    socket.on("game:command", async (payload: unknown) => {
        const game = getGame();
        if (
            !(game instanceof DistributedRoom) ||
            !roomId ||
            liveSessions.get(sessionKey(roomId, user.id)) !== socket.id
        )
            return;
        try {
            const command = payload as Command;
            if (!command || typeof command !== "object" || !command.event)
                return;
            if (command.event.type === "room:join") command.event.player = user;
            const status = await game.command(command, user.id);
            sendRoomInfo(roomId);
            emitRaw("command:ack", { id: command.id, status });
        } catch (error) {
            logError("Distributed command failed", error, { roomId, userId: user.id });
            if (game.halted) emitRaw("cluster:paused");
            else
                emitRaw("command:ack", {
                    id: (payload as Command)?.id,
                    status: "rejected",
                });
        }
    });
    socket.on("room:join", () => {
        const game = getGame();
        if (!game || !roomId || !isCurrentSession()) return;
        if (game instanceof DistributedRoom) return;
        const result = game.apply({ type: "room:join", player: user });
        if (result.effects.length) socket.join(roomId);
    });
    socket.on("room:leave", (payload: unknown) => {
        if (!roomId) return;
        // The client chooses the correlation ID; only the server-controlled
        // session identity determines which player can leave.
        const requestId = payload && typeof payload === "object" &&
            "requestId" in payload && isRequestId(payload.requestId)
            ? payload.requestId : undefined;
        const acknowledge = () => {
            if (requestId && socket.connected)
                socket.emit("room:leave:ack", { requestId });
        };
        const key = sessionKey(roomId, user.id);
        if (liveSessions.get(key) !== socket.id) return;
        const distributed = getGame();
        if (distributed instanceof DistributedRoom) {
            // An explicit exit differs from a transient transport disconnect:
            // remove the player now, rather than waiting for reconnect grace.
            // Leaving a match does not disconnect the authenticated socket.
            // Keep liveSessions so this exact socket can join again and
            // its eventual transport disconnect can retire the room.
            void distributed.leave(user.id).then(acknowledge).catch((error) =>
                logError("Distributed room leave failed", error, { roomId }),
            );
            return;
        }
        // Standalone sockets also stay in their Socket.IO room after leave.
        // Only release their session mapping on actual socket disconnect.
        deleteUser(user.id, "room_leave");
        acknowledge();
    });

    const authenticate = async (response: ClientPayloads["auth:response"]) => {
        try {
            if (!socket.connected) return;
            response = validateAuthPayload(response);
            const jwtResult = await verifyToken(response.jwtToken);
            if (!jwtResult) {
                throw new ClientError(
                    "認証トークンが無効または有効期限切れです。ルームに入り直してください。",
                );
            }

            if (cluster && !response.sessionToken)
                throw new ClientError("署名付きセッションが必要です。");
            const stableId = response.sessionToken
                ? await verifyClientSessionToken(response.sessionToken, jwtResult)
                : socket.id;
            if (roomId && (roomId !== jwtResult || user.id !== stableId))
                throw new ClientError("接続済みセッションの認証情報は変更できません。");
            if (!socket.connected) return;
            const room = await createRoomIfNeeded(
                jwtResult,
                response.jwtToken,
                undefined,
                response.expectedInstance,
            );
            if (!room) {
                throw new ClientError(
                    "ルーム情報を取得できませんでした。ルームを確認して再度お試しください。",
                );
            }
            requireRoomItems(room);
            if (!socket.connected) return;

            const displayName = response.displayName;
            const key = sessionKey(jwtResult, stableId);
            const previousSocketId = liveSessions.get(key);
            liveSessions.set(key, socket.id);
            const pending = pendingLeaves.get(key);
            if (pending) clearTimeout(pending);
            pendingLeaves.delete(key);

            roomId = jwtResult;
            user = { id: stableId, displayName };
            socket.join(roomId);
            if (previousSocketId && previousSocketId !== socket.id) {
                io.sockets.sockets.get(previousSocketId)?.disconnect(true);
            }
            const game = getGame();
            if (game instanceof DistributedRoom) {
                if (!response.sessionToken)
                    throw new ClientError("署名付きセッションが必要です。");
                await game.connect(stableId, socket.id);
            }
            if (!socket.connected || !isCurrentSession()) return;
            socket.emit("auth:session", { id: stableId });
            logEvent("ROOM", `authenticated ${roomId}`, {
                roomId,
                socketId: socket.id,
                userId: user.id,
                displayName: user.displayName,
            });
            capturePostHogEvent("room_authenticated");
            sendRoomInfo(roomId);
        } catch (error) {
            reportError(
                error instanceof ClientError
                    ? error.message
                    : "認証またはルーム情報の取得に失敗しました。しばらくしてから再度お試しください。",
                error,
            );
        }
    };
    // A transport may resend auth while a database/peer read is in flight.
    // Serialize it so completion order cannot rebind its room or identity.
    let authentication = Promise.resolve();
    socket.on("auth:response", response => {
        authentication = authentication.then(() => authenticate(response));
    });

    socket.on("currentInput", (input: unknown) => {
        applyEvent({ type: "currentInput", playerId: user.id, input });
    });
    socket.on("hint:update", (payload: unknown) => {
        const parsed = parseClientEvent("hint:update", payload);
        if (!parsed || parsed.event !== "hint:update") return;
        applyEvent({
            type: "hint:update",
            playerId: user.id,
            length: parsed.data.length,
        });
    });
    socket.on("item:recommend", (payload: unknown) => {
        const game = getGame();
        const parsed = parseClientEvent("item:recommend", payload);
        if (!game || !roomId || !isCurrentSession() || !parsed || parsed.event !== "item:recommend")
            return;
        // Only an authenticated room participant may influence their own
        // next question; unknown item IDs are ignored.
        if (!game.state.room.users.some((player) => player.id === user.id))
            return;
        if (
            !game.state.room.items.some(
                (item) => item.id === parsed.data.itemId,
            )
        )
            return;
        if (game instanceof DistributedRoom)
            game.recommend(user.id, parsed.data.itemId);
        else recommendedItems.set(user.id, parsed.data.itemId);
    });
    socket.on("word:success", () => {
        const game = getGame();
        if (isCurrentSession() && !(game instanceof DistributedRoom))
            game?.apply({ type: "word:success", playerId: user.id });
    });
    socket.on("game:start", () => {
        const game = getGame();

        if (
            !game || !isCurrentSession() ||
            game instanceof DistributedRoom ||
            !canStart(game.state, user.id, NODE_GAME_RULES)
        ) {
            return;
        }

        game.apply({
            type: "game:start",
            playerId: user.id,
            gameId: randomUUID(),
            gameDuration: game.state.room.gameDuration,
        });
    });

    const deleteUser = (
        playerId: string,
        reason: "disconnect" | "room_leave",
    ) => {
        recommendedItems.delete(playerId);
        if (!roomId) return;
        const game = getGame();
        if (!game) return;
        game.apply({ type: "room:leave", playerId, reason });
        const socketRoom = io.sockets.adapter.rooms.get(roomId);
        const pendingCount = [...pendingLeaves.keys()].filter((key) =>
                key.startsWith(`${roomId}:`),
            ).length;
        if (canDeleteRoom(game.state.room, (socketRoom?.size ?? 0) + pendingCount)) {
            game.dispose();
            games.delete(roomId);
            rooms = rooms.filter((item) => item.id !== roomId);
            refreshServerState();
            logEvent("ROOM", `deleted ${roomId}`, { roomId });
        } else {
            if (game.state.room.isStart && game.state.room.users.length)
                io.to(roomId).emit("typing:input", { input: "" });
            sendRoomInfo(roomId);
        }
    };

    socket.on("disconnect", () => {
        logEvent("SERVER", "client disconnected", {
            socketId: socket.id,
            userId: user.id,
            displayName: user.displayName,
            roomId,
        });
        if (!roomId) return;
        const key = sessionKey(roomId, user.id);
        if (liveSessions.get(key) !== socket.id) return;
        liveSessions.delete(key);
        const distributed = getGame();
        if (distributed instanceof DistributedRoom) {
            // A confirmed Socket.IO disconnect removes idle/lobby users
            // immediately. During an active match preserve the seat for
            // recovery: killing a game because of transient failover would
            // otherwise affect every remaining player.
            void distributed.disconnect(user.id, "lobby", NODE_DISCONNECT_GRACE_MS, undefined, socket.id).catch((error) =>
                logError("Distributed socket disconnect cleanup failed", error, {
                    roomId,
                    userId: user.id,
                }),
            );
            return;
        }
        // Lobby loss is immediate. An active player's transport loss has the
        // same 20s recovery window as distributed rooms and Workers.
        const game = getGame();
        if (game?.state.room.isStart &&
            game.state.room.users.some(player => player.id === user.id)) {
            if (pendingLeaves.has(key)) return;
            const deadline = disconnectDeadline(game.state.room, user.id, Date.now());
            pendingLeaves.set(key, setTimeout(() => {
                pendingLeaves.delete(key);
                if (!liveSessions.has(key)) deleteUser(user.id, "disconnect");
            }, Math.max(1, deadline - Date.now())));
            logEvent("ROOM", `reconnect pending ${roomId}`, { roomId, userId: user.id, deadline });
            return;
        }
        deleteUser(user.id, "disconnect");
    });
});

if (config) {
    void clusterReady.then(awaitClusterStartup);
    function awaitClusterStartup() {
        if (!cluster) return;
        void cluster
            .register()
            .catch((error) =>
                console.error("Cluster registration failed", error.message),
            );
    }
    setInterval(awaitClusterStartup, 1_000).unref();
    setInterval(() => {
        for (const [id, game] of games)
            if (game instanceof DistributedRoom) {
                void game
                    .tick()
                    .then(() => {
                        if (game.deleted || game.halted) {
                            games.delete(id);
                            rooms = rooms.filter((room) => room.id !== id);
                            refreshServerState();
                            logEvent("ROOM", `${game.deleted ? "deleted" : "unavailable"} ${id}`, { roomId: id });
                            io.to(id).emit("error", {
                                message:
                                    "所有権の確認のため接続先を再確認しています。",
                            });
                            io.in(id).disconnectSockets(true);
                        }
                    })
                    .catch((error) => {
                        logError("Distributed room maintenance failed", error, { roomId: id });
                        io.in(id).disconnectSockets(true);
                        games.delete(id);
                        rooms = rooms.filter((room) => room.id !== id);
                        refreshServerState();
                    });
            }
    }, 100).unref();
}
const port = Number(process.env.PORT ?? 3001);
void clusterReady
    .then(() =>
        httpServer.listen(port, () => {
            startConsole(port);
            console.info(`Server topology: ${topology.role}`);
        }),
    )
    .catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
