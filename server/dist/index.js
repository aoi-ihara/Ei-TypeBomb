"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const crypto_1 = require("crypto");
const socket_io_1 = require("socket.io");
const auth_1 = require("./lib/auth");
const get_1 = require("./lib/get");
const console_1 = require("./lib/console");
let rooms = [];
const pendingRoomLoads = new Map();
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: { origin: "*", methods: ["GET", "POST"] },
});
const refreshServerState = () => (0, console_1.setServerState)({
    rooms: rooms.length,
    players: rooms.reduce((total, room) => total + (room.users?.length ?? 0), 0),
    games: rooms.filter((room) => room.isStart).length,
});
const createRoomIfNeeded = (roomId) => {
    const existingRoom = rooms.find((item) => item.id === roomId);
    if (existingRoom)
        return Promise.resolve(existingRoom);
    const pendingLoad = pendingRoomLoads.get(roomId);
    if (pendingLoad)
        return pendingLoad;
    const loadPromise = (async () => {
        const room = await (0, get_1.getRoomFromId)(roomId);
        if (!room)
            return null;
        const roomAfterFetch = rooms.find((item) => item.id === roomId);
        if (roomAfterFetch)
            return roomAfterFetch;
        const newRoom = {
            ...room,
            users: [],
            isStart: false,
            gameId: undefined,
            bombStatus: 0,
            bombHolder: 0,
        };
        rooms.push(newRoom);
        refreshServerState();
        (0, console_1.logEvent)("ROOM", `created ${roomId}`);
        return newRoom;
    })();
    pendingRoomLoads.set(roomId, loadPromise);
    return loadPromise.finally(() => {
        if (pendingRoomLoads.get(roomId) === loadPromise) {
            pendingRoomLoads.delete(roomId);
        }
    });
};
const sendRoomInfo = (roomId) => {
    if (!roomId)
        return;
    const room = rooms.find((item) => item.id === roomId);
    if (!room)
        return;
    io.to(roomId).emit("room:broadcast", {
        ...room,
        password: undefined,
        bombTimer: undefined,
    });
};
const sendInputUpdate = (roomId, input) => {
    if (!roomId)
        return;
    const room = rooms.find((item) => item.id === roomId);
    if (!room?.isStart || !room.users?.length)
        return;
    io.to(roomId).emit("typing:input", { input });
};
io.on("connection", (socket) => {
    let user = { id: socket.id };
    let roomId = null;
    const getRoomIndex = () => rooms.findIndex((item) => item.id === roomId);
    (0, console_1.logEvent)("SERVER", "client connected");
    socket.emit("auth:request");
    socket.on("room:join", () => {
        if (!roomId)
            return;
        const room = rooms.find((item) => item.id === roomId);
        if (!room)
            return;
        const maxPlayers = room.maxPlayers;
        const users = room.users ?? (room.users = []);
        if (!maxPlayers || users.length >= maxPlayers)
            return;
        socket.join(roomId);
        if (!users.some((u) => u.id === user.id)) {
            users.push({ id: user.id, displayName: user.displayName });
            refreshServerState();
            (0, console_1.logEvent)("ROOM", `player joined ${roomId}`);
        }
        sendRoomInfo(roomId);
    });
    const leaveRoom = () => {
        if (!roomId)
            return;
        // Game-room membership is separate from Socket.IO membership.
        // Keep the socket in the Socket.IO room so the same connection can rejoin.
        deleteUser(user.id);
    };
    socket.on("room:leave", leaveRoom);
    socket.on("auth:response", async (response) => {
        try {
            const jwtResult = await (0, auth_1.verifyToken)(response.jwtToken);
            if (!jwtResult)
                return;
            roomId = jwtResult;
            user = { ...user, displayName: response.displayName };
            const room = await createRoomIfNeeded(roomId);
            if (!room)
                return;
            socket.join(roomId);
            (0, console_1.logEvent)("ROOM", `authenticated ${roomId}`);
            sendRoomInfo(roomId);
        }
        catch (error) {
            (0, console_1.logError)("auth or room fetch failed", error);
        }
    });
    const handleCurrentInput = (input) => {
        if (typeof input !== "string")
            return;
        const roomIndex = getRoomIndex();
        if (roomIndex === -1)
            return;
        const room = rooms[roomIndex];
        const currentUser = room.users?.[room.bombHolder ?? 0];
        if (!room.isStart || !currentUser || currentUser.id !== user.id)
            return;
        sendInputUpdate(roomId, input.slice(0, 1000));
    };
    socket.on("currentInput", handleCurrentInput);
    socket.on("cuttentInput", handleCurrentInput);
    socket.on("word:success", () => {
        const roomIndex = getRoomIndex();
        if (roomIndex === -1)
            return;
        const room = rooms[roomIndex];
        const currentUser = room.users?.[room.bombHolder ?? 0];
        if (!room.isStart ||
            room.bombHolder === undefined ||
            !currentUser ||
            currentUser.id !== user.id ||
            !room.users?.length)
            return;
        room.bombHolder = (room.bombHolder + 1) % room.users.length;
        if (room.words?.length)
            room.wordIndex = Math.floor(Math.random() * room.words.length);
        (0, console_1.logEvent)("GAME", `word passed in ${roomId}`);
        sendInputUpdate(roomId, "");
        sendRoomInfo(roomId);
    });
    socket.on("game:start", () => {
        const index = getRoomIndex();
        if (index === -1)
            return;
        const room = rooms[index];
        if (!room.users || room.users.length < 2 || room.isStart)
            return;
        if (room.bombTimer) {
            clearTimeout(room.bombTimer);
            room.bombTimer = undefined;
        }
        const gameId = (0, crypto_1.randomUUID)();
        room.gameId = gameId;
        room.isStart = true;
        room.bombHolder = Math.floor(Math.random() * room.users.length);
        room.wordIndex = undefined;
        room.bombStatus = 0;
        refreshServerState();
        (0, console_1.logEvent)("GAME", `started ${roomId}`);
        sendInputUpdate(roomId, "");
        sendRoomInfo(roomId);
        setTimeout(() => {
            const currentRoomIndex = getRoomIndex();
            if (currentRoomIndex === -1)
                return;
            const currentRoom = rooms[currentRoomIndex];
            if (currentRoom.gameId !== gameId || !currentRoom.isStart)
                return;
            if (currentRoom.words?.length)
                currentRoom.wordIndex = Math.floor(Math.random() * currentRoom.words.length);
            sendInputUpdate(roomId, "");
            sendRoomInfo(roomId);
        }, 3000);
        const changeBombStatus = () => {
            const roomIndex = getRoomIndex();
            if (roomIndex === -1)
                return;
            const currentRoom = rooms[roomIndex];
            if (currentRoom.gameId !== gameId || !currentRoom.isStart)
                return;
            const duration = Math.random() * 10000 + 20000;
            currentRoom.bombTimer = setTimeout(() => {
                const currentRoomIndex = getRoomIndex();
                if (currentRoomIndex === -1)
                    return;
                const currentRoom = rooms[currentRoomIndex];
                if (currentRoom.gameId !== gameId || !currentRoom.isStart)
                    return;
                if (currentRoom.bombStatus === 4) {
                    if (!roomId)
                        return;
                    const lostUser = currentRoom.users?.[currentRoom.bombHolder];
                    if (lostUser)
                        io.to(roomId).emit("game:end", {
                            holderUserId: lostUser.id,
                            holderDisplayName: lostUser.displayName,
                        });
                    resetGameStatus(gameId);
                    currentRoom.users = [];
                    refreshServerState();
                    (0, console_1.logEvent)("GAME", `ended ${roomId}`);
                    (0, console_1.logEvent)("ROOM", `players kicked after game ${roomId}`);
                    sendInputUpdate(roomId, "");
                    sendRoomInfo(roomId);
                }
                else {
                    currentRoom.bombStatus = (currentRoom.bombStatus ?? 0) + 1;
                    sendRoomInfo(roomId);
                    changeBombStatus();
                }
            }, duration);
        };
        changeBombStatus();
    });
    const resetGameStatus = (expectedGameId) => {
        const roomIndex = getRoomIndex();
        if (roomIndex === -1)
            return;
        const room = rooms[roomIndex];
        if (expectedGameId && room.gameId !== expectedGameId)
            return;
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
    const deleteUser = (userId) => {
        if (!roomId)
            return;
        const roomIndex = getRoomIndex();
        if (roomIndex === -1)
            return;
        const room = rooms[roomIndex];
        if (room.users?.find((item) => item.id === userId)) {
            if (room.isStart) {
                resetGameStatus();
                io.to(roomId).emit("game:quited");
                (0, console_1.logEvent)("GAME", `cancelled ${roomId}`);
                room.users = [];
                refreshServerState();
                (0, console_1.logEvent)("ROOM", `players kicked after game ${roomId}`);
            }
            else {
                room.users = room.users.filter((item) => item.id !== userId);
                refreshServerState();
                (0, console_1.logEvent)("ROOM", `player left ${roomId}`);
            }
        }
        const socketRoom = io.sockets.adapter.rooms.get(roomId);
        if (!socketRoom || socketRoom.size === 0) {
            if (room.bombTimer)
                clearTimeout(room.bombTimer);
            rooms = rooms.filter((item) => item.id !== roomId);
            refreshServerState();
        }
        else {
            sendInputUpdate(roomId, "");
        }
        sendRoomInfo(roomId);
    };
    socket.on("disconnect", () => {
        deleteUser(user.id);
        (0, console_1.logEvent)("SERVER", "client disconnected");
    });
});
httpServer.listen(3001, () => {
    (0, console_1.startConsole)(3001);
});
