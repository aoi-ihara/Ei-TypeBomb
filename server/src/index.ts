import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import type { Word, Room, User } from "./type";
import { verifyToken } from "./lib/auth";
import { getRoomFromId } from "./lib/get";
import { randomUUID, UUID } from "crypto";
import { useDeprecatedInvertedScale } from "framer-motion";
import { send } from "process";

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

    io.to(roomId).emit("room:broadcast", { ...room, password: undefined });
    console.log("room:", room);
};

// MAIN

io.on("connection", (socket) => {
    const ip = socket.handshake.address;
    const origin = socket.handshake.headers.origin;
    const userAgent = socket.handshake.headers["user-agent"];
    let user: User = { id: socket.id };
    let roomId: null | string = null;

    const getRoomIndex = () => {
        return rooms.findIndex((item) => item.id == roomId);
    };

    console.log("Connected👍:", user.id);

    // AUTH

    socket.emit("auth:request");

    socket.on("room:join", () => {
        let index = rooms.findIndex((item) => item.id == roomId);
        if (index == -1) return;
        console.log("room index:", index);

        const maxPlayers: number | undefined = rooms[index].maxPlayers;
        if (!maxPlayers) return;
        console.log("max players:", maxPlayers);
        if (
            rooms[index].users?.length == undefined ||
            rooms[index].users?.length >= maxPlayers
        )
            return;

        rooms[index].users?.push({
            id: user.id,
            displayName: user.displayName,
        });

        sendRoomInfo(roomId);
    });

    socket.on("room:leave", () => {
        deleteUser(user.id);
    });

    socket.on(
        "auth:response",
        (response: { jwtToken: string; displayName: string }) => {
            const getRoomId = async () => {
                console.log("JWT Token:", response.jwtToken);

                const jwtResult = await verifyToken(response.jwtToken);
                console.log("room id:", jwtResult);
                if (!jwtResult) return;

                roomId = jwtResult;
                user = { ...user, displayName: response.displayName };
                socket.join(roomId);

                if (getRoomIndex() == -1) {
                    console.log("searching room info…");
                    const room = await getRoomFromId(roomId);
                    console.log("room:", room);
                    if (!room) return;
                    rooms.push(room);
                    resetRoom();
                }

                sendRoomInfo(roomId);
            };

            getRoomId();
        },
    );

    socket.on("word:success", () => {
        const roomIndex = getRoomIndex();

        console.log("success!!");

        if (rooms[roomIndex].bombHolder == undefined) return;
        rooms[roomIndex] = {
            ...rooms[roomIndex],
            bombHolder:
                rooms[roomIndex].bombHolder + 1 ==
                rooms[roomIndex].users?.length
                    ? 0
                    : rooms[roomIndex].bombHolder + 1,
            wordIndex: Math.floor(
                Math.random() * rooms[roomIndex].words?.length!,
            ),
        };

        sendRoomInfo(roomId);
    });

    socket.on("game:start", () => {
        const index = getRoomIndex();
        if (rooms[index].users)
            rooms[index] = {
                ...rooms[index],
                isStart: true,
                bombHolder: Math.floor(
                    Math.random() * rooms[index].users?.length,
                ),
                wordIndex: undefined,
                bombStatus: 0,
            };

        sendRoomInfo(roomId);

        setTimeout(() => {
            const roomIndex = getRoomIndex();
            rooms[roomIndex] = {
                ...rooms[roomIndex],
                wordIndex: Math.floor(
                    Math.random() * rooms[roomIndex].words?.length!,
                ),
            };

            sendRoomInfo(roomId);
        }, 3000);

        const changeBombStatus = () => {
            const duration = Math.random() * 10000 + 20000;

            setTimeout(() => {
                const roomIndex = getRoomIndex();
                if (rooms[roomIndex].bombStatus == undefined) return;

                if (rooms[roomIndex].bombStatus == 4) {
                    if (!roomId) return;

                    const roomIndex = getRoomIndex();
                    if (!rooms[roomIndex].users) return;
                    if (rooms[roomIndex].bombHolder == undefined) return;

                    const lostUser =
                        rooms[roomIndex].users[rooms[roomIndex].bombHolder];
                    if (!lostUser) return;
                    io.to(roomId).emit("game:end", {
                        holderUserId: lostUser.id,
                        holderDisplayName: lostUser.displayName,
                    });
                    resetRoom();
                    sendRoomInfo(roomId);
                } else {
                    rooms[roomIndex] = {
                        ...rooms[roomIndex],
                        bombStatus: rooms[roomIndex].bombStatus + 1,
                    };

                    sendRoomInfo(roomId);
                    changeBombStatus();
                }
            }, duration);
        };

        changeBombStatus();
    });

    const resetRoom = () => {
        const roomIndex = getRoomIndex();
        rooms[roomIndex] = {
            ...rooms[roomIndex],
            users: [],
            isStart: false,
            bombStatus: 0,
            bombHolder: 0,
        };
    };

    const deleteUser = (userId: string) => {
        if (!roomId) return;

        const roomIndex = getRoomIndex();
        if (roomIndex == -1) return;

        if (rooms[roomIndex].users?.find((item) => item.id == userId)) {
            if (rooms[roomIndex].isStart) {
                resetRoom();
                io.to(roomId).emit("game:quited");
            } else {
                const newUsers = rooms[roomIndex].users?.filter(
                    (item) => item.id !== userId,
                );

                rooms[roomIndex] = {
                    ...rooms[roomIndex],
                    users: newUsers,
                };
            }
        }

        const room = io.sockets.adapter.rooms.get(roomId);
        if (!room || room.size === 0) {
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
