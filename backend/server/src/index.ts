import express from "express";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { Server } from "socket.io";
import type { Room, User } from "./type";
import { verifyToken } from "./lib/auth";
import { getRoomFromId } from "./lib/get";
import { capturePostHogEvent } from "./lib/posthog";
import { createSocketRateLimit } from "./lib/socketRateLimit";
import { probeRoomDatabase } from "./lib/databaseHealth";
import { createDatabaseProbeRateLimit } from "./lib/databaseProbeRateLimit";
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
} from "../../shared/validation";
import { canStart } from "../../shared/game";
import {
    roomSnapshot,
    type ClientPayloads,
    type ServerPayloads,
    type EventHandlers,
} from "../../shared/protocol";
import { NodeGameAdapter, NODE_GAME_RULES } from "./lib/gameAdapter";

const games = new Map<string, NodeGameAdapter>();

let rooms: Room[] = [];
const pendingRoomLoads = new Map<string, Promise<Room | null>>();

const app = express();
const httpServer = createServer(app);
const io = new Server<
    EventHandlers<ClientPayloads>,
    EventHandlers<ServerPayloads>
>(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
});
const acceptDatabaseProbe = createDatabaseProbeRateLimit();

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
                (result, previous) => {
                    if (result.state.room !== previous.room) {
                        const index = rooms.findIndex(
                            (item) => item.id === roomId,
                        );
                        if (index === -1) return;
                        rooms[index] = result.state.room;
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
    io.to(roomId).emit(
        "room:broadcast",
        roomSnapshot(room, games.get(roomId)?.state.revision ?? 0),
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
        socket.emit("health:pong", pingId);
    });

    socket.on("health:database", async (requestId: unknown) => {
        if (!isRequestId(requestId)) return;

        if (!acceptDatabaseProbe(socket.handshake.address)) return;

        const startedAt = performance.now();
        try {
            // await probeRoomDatabase(roomDatabase);
            socket.emit("health:database-result", {
                requestId,
                ok: true,
                latencyMs: Math.round(performance.now() - startedAt),
            });
        } catch (error) {
            logError("Database health check failed", error, {
                socketId: socket.id,
            });
            socket.emit("health:database-result", {
                requestId,
                ok: false,
                latencyMs: null,
            });
        }
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

    socket.on("room:join", () => {
        const game = getGame();
        if (!game || !roomId) return;
        const result = game.apply({ type: "room:join", player: user });
        if (result.effects.length) socket.join(roomId);
    });
    socket.on("room:leave", () => deleteUser(user.id, "room_leave"));

    socket.on(
        "auth:response",
        async (response: { jwtToken: string; displayName: string }) => {
            try {
                response = validateAuthPayload(response);
                const jwtResult = await verifyToken(response.jwtToken);
                if (!jwtResult) {
                    throw new ClientError(
                        "認証トークンが無効または有効期限切れです。ルームに入り直してください。",
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

                const displayName = response.displayName;

                roomId = jwtResult;
                user = { ...user, displayName };
                socket.join(roomId);
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
    socket.on("word:success", () => {
        getGame()?.apply({ type: "word:success", playerId: user.id });
    });
    socket.on("game:start", () => {
        const game = getGame();

        if (!game || !canStart(game.state, user.id, NODE_GAME_RULES)) {
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
        if (!roomId) return;
        const game = getGame();
        if (!game) return;
        game.apply({ type: "room:leave", playerId, reason });
        const socketRoom = io.sockets.adapter.rooms.get(roomId);
        if (!socketRoom || socketRoom.size === 0) {
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
        deleteUser(user.id, "disconnect");
    });
});

httpServer.listen(3001, () => {
    startConsole(3001);
});
