import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import type { Word, Room, User } from "./type";
import { verifyToken } from "./lib/auth";
import { getRoomFromId } from "./lib/get";
import { randomUUID, UUID } from "crypto";

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

    console.log("Connected👍:", user.id);

    // AUTH

    socket.emit("auth:request");

    socket.on("room:join", () => {
        let index = rooms.findIndex((item) => item.id == roomId);
        console.log("room index:", index);

        rooms[index].users?.push({
            id: user.id,
            displayName: user.displayName,
        });

        sendRoomInfo(roomId);
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

                let index = rooms.findIndex((item) => item.id == roomId);

                if (index == -1) {
                    console.log("searching room info…");
                    const room = await getRoomFromId(roomId);
                    console.log("room:", room);
                    if (!room) return;
                    rooms.push({ ...room, users: [] });
                    index = rooms.length - 1;
                }

                sendRoomInfo(roomId);
            };

            getRoomId();
        },
    );

    socket.on("disconnect", () => {
        console.log("disconnected", user.id);
        if (!roomId) return;

        const roomIndex = rooms.findIndex((item) => item.id == roomId);
        if (roomIndex == -1) return;

        const newUsers = rooms[roomIndex].users?.filter(
            (item) => item.id !== user.id,
        );

        if (newUsers?.length == 0)
            rooms = rooms.filter((item) => item.id !== roomId);
        else rooms[roomIndex] = { ...rooms[roomIndex], users: newUsers };

        sendRoomInfo(roomId);
    });
});

httpServer.listen(3001, () => {
    console.log("Socket.IO Server running on :3001");
});
