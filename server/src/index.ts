import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { registerSocket } from "./socket";

const app = express();

const httpServer = createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
    pingInterval: 10000,
    pingTimeout: 5000,
});

registerSocket(io);

httpServer.listen(3001);
