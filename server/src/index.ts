import express from "express";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { Server } from "socket.io";
import type { Room, User, GameState } from "../../shared/types";
import { applyGameEvent, hasPlayerCapacity, type GameEvent } from "../../shared/game";
import { roomToWireSnapshot, type ClientSocketEvents, type ServerSocketEvents } from "../../shared/protocol";
import { ClientError, requireRoomItems, validateAuthResponse, isHealthRequestId } from "../../shared/validation";
import { verifyToken } from "./lib/auth";
import { getRoomFromId } from "./lib/get";
import { capturePostHogEvent } from "./lib/posthog";
import { createSocketRateLimit } from "./lib/socketRateLimit";
import { roomDatabase } from "./lib/db";
import { probeRoomDatabase } from "./lib/databaseHealth";
import { createDatabaseProbeRateLimit } from "./lib/databaseProbeRateLimit";
import { logError, logEvent, recordLatencySample, setServerState, startConsole } from "./lib/console";

const states = new Map<string, GameState>();
const timers = new Map<string, NodeJS.Timeout>();
const pendingRoomLoads = new Map<string, Promise<Room | null>>();
const httpServer = createServer(express());
const io = new Server<ClientSocketEvents, ServerSocketEvents>(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
});
const acceptDatabaseProbe = createDatabaseProbeRateLimit();

const loggedPlayer = (player: User | undefined) => player
    ? { userId: player.id, displayName: player.displayName }
    : undefined;

const refreshServerState = () => setServerState({
    rooms: [...states.values()].map(({ room }) => ({
        id: room.id,
        players: (room.users ?? []).map(({ id, displayName }) => ({ id, displayName })),
        isStart: Boolean(room.isStart),
        bombHolder: room.bombHolder,
    })),
});
const sendRoomInfo = (roomId: string) => {
    const state = states.get(roomId);
    if (state) io.to(roomId).emit("room:broadcast", roomToWireSnapshot(state.room));
};
const cancelTimer = (roomId: string) => {
    const timer = timers.get(roomId);
    if (timer) clearTimeout(timer);
    timers.delete(roomId);
};

// Timer ownership is the room/game, never the connection which started it.
// Re-arm against absolute deadlines after each immutable state replacement.
const scheduleDeadline = (roomId: string) => {
    cancelTimer(roomId);
    const state = states.get(roomId);
    if (!state?.room.isStart) return;
    const deadlines = [state.wordAt, state.bombAt].filter((at): at is number => at !== undefined);
    if (!deadlines.length) return;
    const gameId = state.room.gameId;
    const timer = setTimeout(() => {
        if (timers.get(roomId) !== timer) return;
        timers.delete(roomId);
        const current = states.get(roomId);
        if (!current?.room.isStart || current.room.gameId !== gameId) return;
        dispatch(roomId, { event: "deadlines" });
    }, Math.max(0, Math.min(...deadlines) - Date.now()));
    timers.set(roomId, timer);
};
const dispatch = (roomId: string, event: GameEvent, gameId?: string) => {
    const previous = states.get(roomId);
    if (!previous) return;
    const result = applyGameEvent(previous, event, {
        now: Date.now(), random: Math.random, gameId,
        allowCountdownPass: true, allowSpectatorStart: true,
    });
    states.set(roomId, result.state);
    for (const effect of result.effects) {
        switch (effect.event) {
            case "typing:input": io.to(roomId).emit(effect.event, effect.data); break;
            case "game:quited": io.to(roomId).emit(effect.event); break;
            case "game:end":
                io.to(roomId).emit(effect.event, effect.data);
                logEvent("GAME", `ended ${roomId}`, {
                    roomId, gameId: previous.room.gameId,
                    holder: loggedPlayer(previous.room.users?.[previous.room.bombHolder ?? 0]),
                    players: previous.room.users?.map(loggedPlayer),
                });
                capturePostHogEvent("game_finished", { player_count: previous.room.users?.length ?? 0 });
                logEvent("ROOM", `players kicked after game ${roomId}`, { roomId, gameId: previous.room.gameId });
                break;
        }
    }
    if (result.state !== previous) {
        refreshServerState();
        sendRoomInfo(roomId);
        scheduleDeadline(roomId);
    } else if (event.event === "deadlines") {
        // setTimeout may fire before the wall-clock deadline.
        scheduleDeadline(roomId);
    }
    return result;
};
const createRoomIfNeeded = (roomId: string): Promise<Room | null> => {
    const existing = states.get(roomId);
    if (existing) return Promise.resolve(existing.room);
    const pending = pendingRoomLoads.get(roomId);
    if (pending) return pending;
    const load = (async () => {
        const room = await getRoomFromId(roomId);
        if (!room) return null;
        requireRoomItems(room);
        const current = states.get(roomId);
        if (current) return current.room;
        const newRoom: Room = { ...room, users: [], isStart: false, bombStatus: 0, bombHolder: 0 };
        states.set(roomId, { room: newRoom });
        refreshServerState();
        logEvent("ROOM", `created ${roomId}`, { roomId });
        return newRoom;
    })();
    pendingRoomLoads.set(roomId, load);
    return load.finally(() => {
        if (pendingRoomLoads.get(roomId) === load) pendingRoomLoads.delete(roomId);
    });
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
    let roomId: string | null = null;
    let authGeneration = 0;
    logEvent("SERVER", "client connected", { socketId: socket.id });
    socket.emit("auth:request");
    const reportError = (message: string, error: unknown = new Error(message)) => {
        logError(message, error, { socketId: socket.id, userId: user.id, displayName: user.displayName, roomId });
        socket.emit("error", { message });
    };
    socket.on("health:ping", (requestId: unknown) => {
        if (isHealthRequestId(requestId)) socket.emit("health:pong", requestId);
    });
    socket.on("health:database", async (requestId: unknown) => {
        if (!isHealthRequestId(requestId) || !acceptDatabaseProbe(socket.handshake.address)) return;
        const startedAt = performance.now();
        try {
            await probeRoomDatabase(roomDatabase);
            socket.emit("health:database-result", { requestId, ok: true, latencyMs: Math.round(performance.now() - startedAt) });
        } catch (error) {
            logError("Database health check failed", error, { socketId: socket.id });
            socket.emit("health:database-result", { requestId, ok: false, latencyMs: null });
        }
    });
    const deleteUser = (reason: "disconnect" | "room_leave") => {
        if (!roomId) return;
        const room = states.get(roomId)?.room;
        if (!room) return;
        const leaving = room.users?.find((player) => player.id === user.id);
        const result = dispatch(roomId, { event: "room:leave", playerId: user.id });
        if (leaving) {
            if (room.isStart) {
                logEvent("GAME", `cancelled ${roomId}`, {
                    roomId, gameId: room.gameId, socketId: socket.id, userId: leaving.id, displayName: leaving.displayName,
                });
                capturePostHogEvent("game_cancelled", { reason, player_count: room.users?.length ?? 0 });
            }
            logEvent("ROOM", `player left ${roomId}`, {
                roomId, socketId: socket.id, userId: leaving.id, displayName: leaving.displayName,
                remainingPlayers: result?.state.room.users?.map(loggedPlayer),
            });
            capturePostHogEvent("player_left", { reason, player_count: result?.state.room.users?.length ?? 0 });
        }
        if (!io.sockets.adapter.rooms.get(roomId)?.size) {
            cancelTimer(roomId);
            states.delete(roomId);
            refreshServerState();
            logEvent("ROOM", `deleted ${roomId}`, { roomId });
        }
    };
    socket.on("room:leave", () => deleteUser("room_leave"));
    socket.on("room:join", () => {
        if (!roomId) return;
        const previous = states.get(roomId);
        const room = previous?.room;
        if (!room || !hasPlayerCapacity(room)) return;
        const result = dispatch(roomId, { event: "room:join", player: user });
        if (result && result.state !== previous) {
            socket.join(roomId);
            logEvent("ROOM", `player joined ${roomId}`, { roomId, socketId: socket.id, userId: user.id, displayName: user.displayName });
            capturePostHogEvent("player_joined", { player_count: result.state.room.users?.length ?? 0 });
        } else {
            sendRoomInfo(roomId);
        }
    });
    socket.on("auth:response", async (payload: unknown) => {
        const generation = ++authGeneration;
        const isCurrent = () => socket.connected && generation === authGeneration;
        try {
            const response = validateAuthResponse(payload);
            const targetRoomId = await verifyToken(response.jwtToken);
            if (!isCurrent()) return;
            if (!targetRoomId) throw new ClientError("認証トークンが無効または有効期限切れです。ルームに入り直してください。");
            const room = await createRoomIfNeeded(targetRoomId);
            if (!isCurrent()) return;
            if (!room) throw new ClientError("ルーム情報を取得できませんでした。ルームを確認して再度お試しください。");
            requireRoomItems(room);
            // Reauthentication cannot leave a player or timer behind in the old room.
            if (roomId && roomId !== targetRoomId) {
                const oldRoomId = roomId;
                deleteUser("room_leave");
                await socket.leave(oldRoomId);
                if (!io.sockets.adapter.rooms.get(oldRoomId)?.size) {
                    cancelTimer(oldRoomId);
                    states.delete(oldRoomId);
                    refreshServerState();
                }
            }
            if (!isCurrent()) return;
            roomId = targetRoomId;
            user = { ...user, displayName: response.displayName };
            socket.join(roomId);
            logEvent("ROOM", `authenticated ${roomId}`, { roomId, socketId: socket.id, userId: user.id, displayName: user.displayName });
            capturePostHogEvent("room_authenticated");
            sendRoomInfo(roomId);
        } catch (error) {
            if (!isCurrent()) return;
            reportError(error instanceof ClientError ? error.message : "認証またはルーム情報の取得に失敗しました。しばらくしてから再度お試しください。", error);
        }
    });
    socket.on("currentInput", (input: unknown) => {
        if (roomId) dispatch(roomId, { event: "currentInput", playerId: user.id, input });
    });
    socket.on("word:success", () => {
        if (!roomId) return;
        const previous = states.get(roomId);
        const result = dispatch(roomId, { event: "word:success", playerId: user.id });
        if (result && result.state !== previous) {
            logEvent("GAME", `word passed in ${roomId}`, {
                roomId, gameId: result.state.room.gameId, socketId: socket.id, userId: user.id, displayName: user.displayName,
                previousHolder: loggedPlayer(previous?.room.users?.[previous.room.bombHolder ?? 0]),
                nextHolder: loggedPlayer(result.state.room.users?.[result.state.room.bombHolder ?? 0]),
            });
        }
    });
    socket.on("game:start", async () => {
        if (!roomId) return;
        const targetRoomId = roomId;
        const previous = states.get(targetRoomId);
        if (!previous || previous.room.isStart || (previous.room.users?.length ?? 0) < 2) return;
        try {
            const savedRoom = await getRoomFromId(targetRoomId);
            if (!savedRoom) { reportError("ルームの設定を取得できませんでした。"); return; }
            // A leave/rejoin, competing start, removal or reauthentication during
            // the query invalidates this request. Spectators may still start.
            if (!socket.connected || roomId !== targetRoomId || !socket.rooms.has(targetRoomId)
                || states.get(targetRoomId) !== previous || previous.room.isStart
                || (previous.room.users?.length ?? 0) < 2) return;
            requireRoomItems(previous.room);
            states.set(targetRoomId, { ...previous, room: { ...previous.room, gameDuration: savedRoom.gameDuration } });
            const result = dispatch(targetRoomId, { event: "game:start", playerId: user.id }, randomUUID());
            if (!result?.state.room.isStart) return;
            logEvent("GAME", `started ${targetRoomId}`, {
                roomId: targetRoomId, gameId: result.state.room.gameId,
                starter: { socketId: socket.id, userId: user.id, displayName: user.displayName },
                players: result.state.room.users?.map((player) => ({ userId: player.id, displayName: player.displayName })),
            });
            capturePostHogEvent("game_started", { player_count: result.state.room.users?.length ?? 0 });
        } catch (error) {
            reportError(error instanceof Error ? error.message : "ルームの設定を取得できませんでした。", error);
        }
    });
    socket.on("disconnect", () => {
        logEvent("SERVER", "client disconnected", { socketId: socket.id, userId: user.id, displayName: user.displayName, roomId });
        deleteUser("disconnect");
    });
});
// Port 0 allows integration tests to use an isolated ephemeral listener.
httpServer.listen(Number(process.env.PORT ?? 3001), () => {
    const address = httpServer.address();
    if (address && typeof address !== "string") startConsole(address.port);
});
