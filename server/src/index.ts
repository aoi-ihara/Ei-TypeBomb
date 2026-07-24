import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import type { Word, Room } from "./type";
import { verifyToken } from "./lib/auth";

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
    let userId: string | null = null;

    console.log("Connected👍:", socket.id);
    socket.emit("token:request");

    socket.emit("request");

    socket.on("fetch", () => {
        console.log("Room Info Requested:", ip);
        socket.emit("roomInfo");
        socket.emit("isStarted");
    });

    socket.on("token:response", (token: string) => {
        const getRoomId = async () => {
            console.log("JWT Token:", token);

            const result = await verifyToken(token);
            console.log("result:", result);
        };

        getRoomId();
    });
});

httpServer.listen(3001, () => {
    console.log("Socket.IO Server running on :3001");
});
