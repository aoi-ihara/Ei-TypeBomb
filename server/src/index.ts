import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import type { Room, User } from "./type";
import { verifyToken } from "./lib/auth";
import { getRoomFromId } from "./lib/get";

let rooms: Room[] = [];

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const sendRoomInfo = (roomId: string | null) => {
    if (!roomId) return;

    const room = rooms.find((item) => item.id === roomId);
    if (!room) return;

    io.to(roomId).emit("room:broadcast", {
        ...room,
        password: undefined,
        bombTimer: undefined,
    });
    console.log("room:", room);
};

// MAIN
io.on("connection", (socket) => {
    let user: User = { id: socket.id };
    let roomId: null | string = null;

    const getRoomIndex = () => {
        return rooms.findIndex((item) => item.id === roomId);
    };

    console.log("Connected👍:", user.id);

    // AUTH
    socket.emit("auth:request");

    socket.on("room:join", () => {
        const index = getRoomIndex();
        if (index === -1) return;

        const room = rooms[index];
        const maxPlayers = room.maxPlayers;
        if (!maxPlayers) return;

        if (!room.users || room.users.length >= maxPlayers) return;

        if (!room.users.some((u) => u.id === user.id)) {
            room.users.push({
                id: user.id,
                displayName: user.displayName,
            });
        }

        sendRoomInfo(roomId);
    });

    socket.on("room:leave", () => {
        deleteUser(user.id);
    });

    socket.on(
        "auth:response",
        async (response: { jwtToken: string; displayName: string }) => {
            try {
                console.log("JWT Token:", response.jwtToken);

                const jwtResult = await verifyToken(response.jwtToken);
                console.log("room id:", jwtResult);
                if (!jwtResult) return;

                roomId = jwtResult;
                user = { ...user, displayName: response.displayName };
                socket.join(roomId);

                if (getRoomIndex() === -1) {
                    console.log("searching room info…");
                    const room = await getRoomFromId(roomId);
                    console.log("room:", room);
                    if (!room) return;

                    if (getRoomIndex() === -1) {
                        rooms.push({
                            ...room,
                            users: [],
                            isStart: false,
                            bombStatus: 0,
                            bombHolder: 0,
                        });
                    }
                }

                sendRoomInfo(roomId);
            } catch (error) {
                console.error("Auth or Room Fetch Error:", error);
            }
        },
    );

    socket.on("word:success", () => {
        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;

        const room = rooms[roomIndex];
        if (
            room.bombHolder === undefined ||
            !room.users ||
            room.users.length === 0
        )
            return;

        console.log("success!!");

        room.bombHolder = (room.bombHolder + 1) % room.users.length;
        if (room.words && room.words.length > 0) {
            room.wordIndex = Math.floor(Math.random() * room.words.length);
        }

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

        room.isStart = true;
        room.bombHolder = Math.floor(Math.random() * room.users.length);
        room.wordIndex = undefined;
        room.bombStatus = 0;

        sendRoomInfo(roomId);

        setTimeout(() => {
            const currentRoomIndex = getRoomIndex();
            if (currentRoomIndex === -1) return;
            const currentRoom = rooms[currentRoomIndex];

            if (currentRoom.words && currentRoom.words.length > 0) {
                currentRoom.wordIndex = Math.floor(
                    Math.random() * currentRoom.words.length,
                );
            }
            sendRoomInfo(roomId);
        }, 3000);

        const changeBombStatus = () => {
            const roomIndex = getRoomIndex();
            if (roomIndex === -1) return;

            const duration = Math.random() * 10000 + 20000;

            rooms[roomIndex].bombTimer = setTimeout(() => {
                const currentRoomIndex = getRoomIndex();
                if (currentRoomIndex === -1) return;

                const currentRoom = rooms[currentRoomIndex];
                if (!currentRoom?.isStart) return;

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
                    resetGameStatus();
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

    const resetGameStatus = () => {
        const roomIndex = getRoomIndex();
        if (roomIndex === -1) return;

        const room = rooms[roomIndex];

        if (room.bombTimer) {
            clearTimeout(room.bombTimer);
            room.bombTimer = undefined;
        }

        room.isStart = false;
        room.bombStatus = 0;
        room.bombHolder = 0;
        room.wordIndex = undefined;
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
            }

            room.users = room.users.filter((item) => item.id !== userId);
        }

        const socketRoom = io.sockets.adapter.rooms.get(roomId);
        if (!socketRoom || socketRoom.size === 0) {
            if (room.bombTimer) {
                clearTimeout(room.bombTimer);
            }
            rooms = rooms.filter((item) => item.id !== roomId);
            console.log("room deleted");
        }

        sendRoomInfo(roomId);
    };

    socket.on("disconnect", () => {
        deleteUser(user.id);
    });
});

httpServer.listen(3001, () => {
    console.log("Socket.IO Server running on :3001");
});
