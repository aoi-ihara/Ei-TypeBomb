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
import { canStart } from "../../shared/game";
import {
    roomSnapshot,
    type ClientPayloads,
    type ServerPayloads,
    type EventHandlers,
} from "../../shared/protocol";
import { NodeGameAdapter, NODE_GAME_RULES } from "./lib/gameAdapter";
import { parseServerTopology } from "../../shared/topology";

import { clusterConfig, assertClusterIdentity } from "../../shared/distributed/control";
import { DistributedRoom } from "../../shared/distributed/runtime";
import { PeerControl } from "../../shared/distributed/peers";
import { Identity } from "../../shared/distributed/identity";
import { MAX_CLUSTER_FRAME_BYTES } from "../../shared/distributed/link";
import { WebSocket as PeerSocket, WebSocketServer } from "ws";
import type { Command } from "../../shared/distributed/types";
const topology = parseServerTopology(process.env);
const config = clusterConfig(process.env, "socket.io");
let cluster: PeerControl | null = null;
const clusterReady = config
    ? Identity.create(process.env.CLUSTER_SERVER_TOKEN!).then((identity) => {
          assertClusterIdentity(process.env, identity);
          cluster = new PeerControl(identity, config, async (id) => {
              const url = new URL("/cluster/ws", id);
              url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
              const socket = new PeerSocket(url, {
                  maxPayload: MAX_CLUSTER_FRAME_BYTES,
              });
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
              return socket as unknown as import("../../shared/distributed/link").ClusterSocket;
          });
          cluster.draining = process.env.CLUSTER_DRAINING === "true";
      })
    : Promise.resolve();

const games = new Map<string, NodeGameAdapter | DistributedRoom>();
// Game identity is scoped to a signed, tab-specific session, not a transport ID.
const recommendedItems = new Map<string, string>();
const liveSessions = new Map<string, string>();
const pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>();
const DISCONNECT_GRACE_MS = 20_000;
const sessionKey = (roomId: string, playerId: string) =>
    `${roomId}:${playerId}`;

let rooms: Room[] = [];
const pendingRoomLoads = new Map<string, Promise<Room | null>>();

const app = express();
const httpServer = createServer(app);
app.get("/health", (_req, res) => {
    res.json({ ok: true });
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
        res.setHeader("Access-Control-Allow-Origin", "*");
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
            const result = await cluster.call(
                path.endsWith("report") ? "report" : "read",
                { roomId, owner: req.body.owner, revision: req.body.revision },
            );
            if (
                path.endsWith("report") &&
                result.ownership?.owner === cluster.config.id &&
                result.ownership.lifecycle === "MIGRATING"
            )
                await createRoomIfNeeded(roomId, req.body.jwtToken);
            res.json({ ownership: result.ownership, servers: result.servers });
        } catch {
            res.status(503).end();
        }
    });
}
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
            bombHolder: room.bombHolder,
        })),
    });

const createRoomIfNeeded = async (
    roomId: string,
    jwtToken: string,
): Promise<Room | null> => {
    const existingRoom = rooms.find((item) => item.id === roomId);
    if (existingRoom) return Promise.resolve(existingRoom);

    const pendingLoad = pendingRoomLoads.get(roomId);
    if (pendingLoad) return pendingLoad;

    const loadPromise = (async () => {
        if (cluster) {
            const saved = await cluster.call("read", { roomId });
            const fresh =
                !saved.ownership || saved.ownership.lifecycle === "DELETED";
            if (fresh && cluster.config.id !== cluster.config.primary)
                throw new Error("Only the primary may load new room settings");
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
                if (index < 0) rooms.push(result.state.room);
                else rooms[index] = result.state.room;
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
            await game.open(initial ?? undefined);
            games.set(roomId, game);
            if (!rooms.some((room) => room.id === roomId))
                rooms.push(game.state.room);
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
        socket.emit("error", { message });
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
        } catch {
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
        if (!game || !roomId) return;
        if (game instanceof DistributedRoom) return;
        const result = game.apply({ type: "room:join", player: user });
        if (result.effects.length) socket.join(roomId);
    });
    socket.on("room:leave", () => {
        if (!roomId) return;
        const key = sessionKey(roomId, user.id);
        if (liveSessions.get(key) !== socket.id) return;
        if (getGame() instanceof DistributedRoom) return;
        liveSessions.delete(key);
        deleteUser(user.id, "room_leave");
    });

    socket.on(
        "auth:response",
        async (response: ClientPayloads["auth:response"]) => {
            try {
                response = validateAuthPayload(response);
                const jwtResult = await verifyToken(response.jwtToken);
                if (!jwtResult) {
                    throw new ClientError(
                        "認証トークンが無効または有効期限切れです。ルームに入り直してください。",
                    );
                }

                if (cluster) {
                    if (!response.sessionToken)
                        throw new ClientError("署名付きセッションが必要です。");
                    await verifyClientSessionToken(
                        response.sessionToken,
                        jwtResult,
                    );
                }
                const room = await createRoomIfNeeded(
                    jwtResult,
                    response.jwtToken,
                );
                if (!room) {
                    throw new ClientError(
                        "ルーム情報を取得できませんでした。ルームを確認して再度お試しください。",
                    );
                }
                requireRoomItems(room);
                if (!socket.connected) return;

                const displayName = response.displayName;
                const stableId = response.sessionToken
                    ? await verifyClientSessionToken(
                          response.sessionToken,
                          jwtResult,
                      )
                    : socket.id;
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
                    await game.connect(stableId);
                }
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
        },
    );

    socket.on("currentInput", (input: unknown) => {
        getGame()?.apply({ type: "currentInput", playerId: user.id, input });
    });
    socket.on("hint:update", (payload: unknown) => {
        const parsed = parseClientEvent("hint:update", payload);
        if (!parsed || parsed.event !== "hint:update") return;
        getGame()?.apply({
            type: "hint:update",
            playerId: user.id,
            length: parsed.data.length,
        });
    });
    socket.on("item:recommend", (payload: unknown) => {
        const game = getGame();
        const parsed = parseClientEvent("item:recommend", payload);
        if (!game || !roomId || !parsed || parsed.event !== "item:recommend")
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
        if (!(game instanceof DistributedRoom))
            game?.apply({ type: "word:success", playerId: user.id });
    });
    socket.on("game:start", () => {
        const game = getGame();

        if (
            !game ||
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
        if (
            (!socketRoom || socketRoom.size === 0) &&
            ![...pendingLeaves.keys()].some((key) =>
                key.startsWith(`${roomId}:`),
            )
        ) {
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
            void distributed.disconnect(user.id).catch(() => {});
            return;
        }
        const previous = pendingLeaves.get(key);
        if (previous) clearTimeout(previous);
        const timer = setTimeout(() => {
            pendingLeaves.delete(key);
            if (!liveSessions.has(key)) deleteUser(user.id, "disconnect");
        }, DISCONNECT_GRACE_MS);
        pendingLeaves.set(key, timer);
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
                            io.to(id).emit("error", {
                                message:
                                    "所有権の確認のため接続先を再確認しています。",
                            });
                            io.in(id).disconnectSockets(true);
                        }
                    })
                    .catch(() => {
                        io.in(id).disconnectSockets(true);
                        games.delete(id);
                        rooms = rooms.filter((room) => room.id !== id);
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
