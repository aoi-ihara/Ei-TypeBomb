import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import type { Word, Room } from "./type";
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

io.on("connection", (socket) => {
    const ip = socket.handshake.address;
    const origin = socket.handshake.headers.origin;
    const userAgent = socket.handshake.headers["user-agent"];
    let userId = socket.id;
    let roomId: null | string = null;

    console.log("Connected👍:", userId);
    socket.emit("token:request");

    // TOKEN

    socket.on("token:response", (token: string) => {
        const getRoomId = async () => {
            console.log("JWT Token:", token);

            const jwtResult = await verifyToken(token);
            console.log("room id:", jwtResult);
            if (!jwtResult) return;
            roomId = jwtResult;

            let index = rooms.findIndex((item) => item.id == jwtResult);
            console.log("room index:", index);

            if (index == -1) {
                console.log("searching room info…");
                const room = await getRoomFromId(jwtResult);
                console.log("room:", room);
                if (!room) return;
                rooms.push({ ...room, users: [] });
                index = rooms.length;
            }
            console.log(rooms);

            rooms[index].users?.push({ id: userId });
            console.log(rooms);
        };

        getRoomId();
    });
});

httpServer.listen(3001, () => {
    console.log("Socket.IO Server running on :3001");
});
