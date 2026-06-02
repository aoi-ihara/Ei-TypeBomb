import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import fs from "fs";

const words: Word[] = JSON.parse(fs.readFileSync("src/words/demo.json", "utf8")) as Word[];

type User = {
    displayName: string;
    userId: string;
    pulse?: string;
};

type Word = {
    jp: string;
    en: string;
};

let room: User[] = [];
let isStarted = false;
let previousPulse: string = "";
let currentTurn = 0;
let bombTimer: NodeJS.Timeout | null = null;
let currentWord: Word | null = null;
let bombStatus: number = 0;
let currentInput = "";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const bombExplosioned = () => {
    console.log("💥 BOMB EXPLODED");

    io.emit("bombExplosioned", room[currentTurn].userId);

    isStarted = false;
    currentTurn = 0;
    currentWord = null;
    bombStatus = 0;
    room = [];
    currentInput = "";

    if (bombTimer) {
        clearTimeout(bombTimer);
        bombTimer = null;
    }

    broadcastRoomInfo();
};

const broadcastRoomInfo = () => {
    io.emit("roomInfo", room);
    io.emit("gameStatus", {
        isStarted: isStarted,
        currentTurn: currentTurn,
        currentWord: currentWord,
        bombStatus: bombStatus,
        currentInput: currentInput,
    });

    console.log(
        "Room status:",
        isStarted,
        currentTurn,
        currentWord,
        bombStatus,
    );
};

const updateRoom = (fn: (room: User[]) => void) => {
    fn(room);
    broadcastRoomInfo();
};

const endGame = () => {
    isStarted = false;
    currentWord = null;
    currentTurn = 0;
    bombStatus = 0;
    currentInput = "";

    if (bombTimer) {
        clearTimeout(bombTimer);
        bombTimer = null;
    }
};

const startGame = () => {
    isStarted = true;
    console.log("Game Started 🎮");

    bombStatus = 0;
    currentTurn = 0;
    currentInput = "";

    broadcastRoomInfo();

    setTimeout(() => {
        currentWord = words[Math.floor(Math.random() * words.length)];
        broadcastRoomInfo();
        console.log("Word Changed");
    }, 3000);

    scheduleBombTick();
};

const scheduleBombTick = () => {
    if (!isStarted) return;

    const delay = 8000 + Math.random() * 8000;

    bombTimer = setTimeout(() => {
        if (!isStarted) return;

        if (bombStatus >= 4) {
            bombExplosioned();
            return;
        } else {
            bombStatus += 1;
        }

        console.log("💣 bombStatus:", bombStatus);

        broadcastRoomInfo();

        scheduleBombTick();
    }, delay);
};

setInterval(() => {
    updateRoom((r) => {
        for (let i = r.length - 1; i >= 0; i--) {
            if (r[i].pulse !== previousPulse) {
                console.log("user kicked:", previousPulse, "!=", r[i].pulse);
                r.splice(i, 1);

                if (isStarted) {
                    endGame();
                    room = [];
                }
            }
        }
    });

    const sharedUUID = crypto.randomUUID();
    io.emit("pulse", sharedUUID);
    console.log("Pulse sent📡:", sharedUUID);
    previousPulse = sharedUUID;
}, 2000);

io.on("connection", (socket) => {
    const ip = socket.handshake.address;
    const origin = socket.handshake.headers.origin;
    const userAgent = socket.handshake.headers["user-agent"];
    let userId: string | null = null;

    console.log("Connected👍:", socket.id);
    console.log("IP:", ip);
    console.log("Origin:", origin);
    console.log("UA:", userAgent);

    socket.on("fetch", () => {
        console.log("Room Info Requested:", ip);
        socket.emit("roomInfo", room);
        socket.emit("isStarted", isStarted);
    });

    socket.on("disconnect", () => {
        console.log("Disconnected:", socket.id);
    });

    socket.on("joinRoom", (displayName: string) => {
        if (room.length < 6 && !isStarted) {
            const uuid = crypto.randomUUID();
            updateRoom((r) =>
                r.push({ displayName, userId: uuid, pulse: previousPulse }),
            );
            socket.emit("joined", uuid);
            userId = uuid;

            if (room.length == 6) {
                startGame();
            }
        }
    });

    socket.on("cuttentInput", (newCurrentInput) => {
        if (userId == room[currentTurn].userId) {
            currentInput = newCurrentInput;
        }

        broadcastRoomInfo();
    });

    socket.on("success", () => {
        console.log("success 💻");

        if (userId == room[currentTurn].userId) {
            if (currentTurn == room.length - 1) {
                currentTurn = 0;
            } else {
                currentTurn += 1;
            }
            currentInput = "";
            currentWord = words[Math.floor(Math.random() * words.length)];

            broadcastRoomInfo();
        }
    });

    socket.on("startGame", () => {
        if (
            userId &&
            room.map((user) => user.userId).includes(userId) &&
            room.length <= 6 &&
            room.length > 1 &&
            !isStarted
        ) {
            startGame();
        }
    });

    socket.on(
        "pulseResponse",
        (response: { userId: string; newPulse: string }) => {
            updateRoom((r) => {
                for (let i = r.length - 1; i >= 0; i--) {
                    if (r[i].userId == userId) {
                        r[i].pulse = response.newPulse;
                    }
                }
            });
            console.log(
                "Pulse response received📡:",
                response.newPulse,
                "Current Users",
                room,
            );
        },
    );
});

httpServer.listen(3001, () => {
    console.log("Socket.IO Server running on :3001");
});
