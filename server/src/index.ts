import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";
import type { User } from "../../shared/types";
import type { Word } from "../../shared/types";
import type { GameState } from "../../shared/types";

// 変数の宣言

const words: Word[] = JSON.parse(
    // JSONファイルの読み込み
    fs.readFileSync("src/words/demo.json", "utf8"),
) as Word[];

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

const game: GameState = {
    status: "waiting",
    bombHolder: null,
    wordIndex: null,
    bombStatus: 0,
    users: [],
    remainingTime: 0,
};
