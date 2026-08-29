import express from "express";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { Server } from "socket.io";
import type { Room, User } from "./type";
import { verifyToken } from "./lib/auth";
import { getRoomFromId } from "./lib/get";
import { logError, logEvent, setServerState, startConsole } from "./lib/console";

let rooms: Room[] = [];
const pendingRoomLoads = new Map<string, Promise<Room | null>>();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const refreshServerState = () => {
    setServerState({
        rooms: rooms.length,
        players: rooms.reduce((total, room) => total + (room.users?.length ?? 0), 0),
        games: rooms.filter((room) => room.isStart).length,
    });
};

const createRoomIfNeeded = (roomId: string): Promise<Room | null> => {
    const existingRoom = rooms.find((item) => item.id === roomId);
    if (existingRoom) return Promise.resolve(existingRoom);

    const pendingLoad = pendingRoomLoads.get(roomId);
    if (pendingLoad) return pendingLoad;

    const loadPromise = (async () => {
        const room = await getRoomFromId(roomId);
        if (!room) return null;

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
        refreshServerState();
        logEvent("ROOM", `created ${roomId}`);
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

    io.to(roomId).emit("room:broadcast", {
        ...room,
        password: undefined,
        bombTimer: undefined,
    });
};

const sendInputUpdate = (roomId: string | null, input: string) => {
    if (!roomId) return;

    const room = rooms.find((item) => item.id === roomId);
    if (!room?.isStart || !room.users?.length) return;

    io.to(roomId).emit("typing:input", { input });
};

// MAIN
io.on("connection", (socket) => {
    let user: User = { id: socket.id };
    let roomId: null | string = null;

    const getRoomIndex = () => {
        return rooms.findIndex((item) => item.id === roomId);
    };

    logEvent("SERVER", "client connected");

    // AUTH
    socket.emit("auth:request");

    socket.on("room:join", () => {
        if (!roomId) return;

        const room = rooms.find((item) => item.id === roomId);
        if (!room) return;

        const maxPlayers = room.maxPlayers;
        if (!maxPlayers) return;

        if (!room.users || room.users.length >= maxPlayers) return;

        socket.join(roomId);

        if (!room.users.some((u) => u.id === user.id)) {
            room.users.push({
                id: user.id,
                displayName: user.displayName,
            });
            refreshServerState();
            logEvent("ROOM", `player joined ${roomId}`);
        }

        sendRoomInfo(roomId);
    });

    const leaveRoom = () => {
        const currentRoomId = roomId;
        if (!currentRoomId) return;

        deleteUser(user.id);

        socket.leave(currentRoomId);

        const socketRoom = io.sockets.adapter.rooms.get(currentRoomId);
        if (!socketRoom || socketRoom.size === 0) {
            const room = rooms.find((item) => item.id === currentRoomId);
            if (room?.bombTimer) {
                clearTimeout(room.bombTimer);
            }
            rooms = rooms.filter((item) => item.id !== currentRoomId);
            refreshServerState();
            logEvent("ROOM", `closed ${currentRoomId}`);
        }
    };

    socket.on("room:leave", leaveRoom);

    socket.on(
        "auth:response",
        async (response: { jwtToken: string; displayName: string }) => {
            try {
                const jwtResult = await verifyToken(response.jwtToken);
                if (!jwtResult) return;

                roomId = jwtResult;
                user = { ...user, displayName: response.displayName };

                const room = await createRoomIfNeeded(roomId);
                if (!room) return;

                socket.join(roomId);
                logEvent("ROOM", `authenticated ${roomId}`);
                sendRoomInfo(roomId);
            } catch (error) {
                logError("auth or room fetch failed", error);
            }
        },
    );

    const handleCurrentInput = (input: unknown) => {
        if (typeof input !== "string") return;

        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;

        const room = rooms[roomIndex];
        const currentUser = room.users?.[room.bombHolder ?? 0];

        if (!room.isStart || !currentUser || currentUser.id !== user.id) return;

        sendInputUpdate(roomId, input.slice(0, 1000));
    };

    socket.on("currentInput", handleCurrentInput);
    socket.on("cuttentInput", handleCurrentInput);

    socket.on("word:success", () => {
        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;

        const room = rooms[roomIndex];
        const currentUser = room.users?.[room.bombHolder ?? 0];

        if (
            !room.isStart ||
            room.bombHolder === undefined ||
            !currentUser ||
            currentUser.id !== user.id ||
            !room.users?.length
        ) {
            return;
        }

        room.bombHolder = (room.bombHolder + 1) % room.users.length;
        if (room.words && room.words.length > 0) {
            room.wordIndex = Math.floor(Math.random() * room.words.length);
        }

        logEvent("GAME", `word passed in ${roomId}`);
        sendInputUpdate(roomId, "");
        sendRoomInfo(roomId);
    });

    socket.on("game:start", () => {
        const index = getRoomIndex();
        if (index === -1) return;

        const room = rooms[index];
        if (!room.users || room.users.length < 2 || room.isStart) return;

        if (room.bombTimer) {
            clearTimeout(room.bombTimer);
            room.bombTimer = undefined;
        }

        const gameId = randomUUID();
        room.gameId = gameId;
        room.isStart = true;
        room.bombHolder = Math.floor(Math.random() * room.users.length);
        room.wordIndex = undefined;
        room.bombStatus = 0;

        refreshServerState();
        logEvent("GAME", `started ${roomId}`);
        sendInputUpdate(roomId, "");
        sendRoomInfo(roomId);

        setTimeout(() => {
            const currentRoomIndex = getRoomIndex();
            if (currentRoomIndex === -1) return;
            const currentRoom = rooms[currentRoomIndex];

            if (currentRoom.gameId !== gameId || !currentRoom.isStart) return;

            if (currentRoom.words && currentRoom.words.length > 0) {
                currentRoom.wordIndex = Math.floor(
                    Math.random() * currentRoom.words.length,
                );
            }
            sendInputUpdate(roomId, "");
            sendRoomInfo(roomId);
        }, 3000);

        const changeBombStatus = () => {
            const roomIndex = getRoomIndex();
            if (roomIndex === -1) return;

            const currentRoom = rooms[roomIndex];
            if (currentRoom.gameId !== gameId || !currentRoom.isStart) return;

            const duration = Math.random() * 10000 + 20000;

            currentRoom.bombTimer = setTimeout(() => {
                const currentRoomIndex = getRoomIndex();
                if (currentRoomIndex === -1) return;

                const currentRoom = rooms[currentRoomIndex];
                if (currentRoom.gameId !== gameId || !currentRoom.isStart) {
                    return;
                }

                if (currentRoom.bombStatus === 4) {
                    if (!roomId) return;
                    const lostUser =
                        currentRoom.users?.[currentRoom.bombHolder!];
                    if (lostUser) {
                        io.to(roomId).emit("game:end", {
                            holderUserId: lostUser.id,
                            holderDisplayName: lostUser.displayName,
                        });
                    }

                    resetGameStatus(gameId);
                    currentRoom.users = [];
                    refreshServerState();
                    logEvent("GAME", `ended ${roomId}`);
                    logEvent("ROOM", `players kicked after game ${roomId}`);
                    sendInputUpdate(roomId, "");
                    sendRoomInfo(roomId);
                } else {
                    currentRoom.bombStatus = (currentRoom.bombStatus ?? 0) + 1;

                    sendRoomInfo(roomId);
                    changeBombStatus();
                }
            }, duration);
        };

        changeBombStatus();
    });

    const resetGameStatus = (expectedGameId?: string) => {
        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;

        const room = rooms[roomIndex];
        if (expectedGameId && room.gameId !== expectedGameId) return;

        if (room.bombTimer) {
            clearTimeout(room.bombTimer);
            room.bombTimer = undefined;
        }

        room.isStart = false;
        room.gameId = undefined;
        room.bombStatus = 0;
        room.bombHolder = 0;
        room.wordIndex = undefined;
        refreshServerState();
        sendInputUpdate(roomId, "");
    };

    const deleteUser = (userId: string) => {
        if (!roomId) return;

        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;

        const room = rooms[roomIndex];

        if (room.users?.find((item) => item.id === userId)) {
            if (room.isStart) {
                resetGameStatus();
                io.to(roomId).emit("game:quited");
                logEvent("GAME", `cancelled ${roomId}`);
            }

            room.users = room.users.filter((item) => item.id !== userId);
            refreshServerState();
            logEvent("ROOM", `player left ${roomId}`);
        }

        const socketRoom = io.sockets.adapter.rooms.get(roomId);
        if (!socketRoom || socketRoom.size === 0) {
            if (room.bombTimer) {
                clearTimeout(room.bombTimer);
            }
            rooms = rooms.filter((item) => item.id !== roomId);
            refreshServerState();
        } else {
            sendInputUpdate(roomId, "");
        }

        sendRoomInfo(roomId);
    };

    socket.on("disconnect", () => {
        deleteUser(user.id);
        logEvent("SERVER", "client disconnected");
    });
});

httpServer.listen(3001, () => {
    startConsole(3001);
});
