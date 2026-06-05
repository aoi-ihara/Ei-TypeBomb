import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";

// 型定義

type Word = {
    jp: string;
    en: string;
};

type User = {
    displayName: string;
    userId: string;
};

type GameState = {
    status: "waiting" | "countdown" | "playing"; // ゲームのステータス
    bombHolder: string | null; // 爆弾を持っている人
    wordIndex: number | null; // 現在の単語
    bombStatus: number; // 爆弾の色
    users: User[]; // ユーザー
    remainingTime: number; // 爆弾のステータス変更までの時間
};

//

const words: Word[] = JSON.parse(
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
