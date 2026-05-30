import express from "express";
import { createServer } from "http";
import { start } from "repl";
import { Server } from "socket.io";

type User = {
    displayName: string;
    userId: string;
    pulse?: string;
};

type Word = {
    jp: string;
    en: string;
}

let room: User[] = [];
let isStarted = false;
let previousPulse: string = "";
let currentTurn = 0;
let currentWord: Word | null = null;

const words: Word[] = [{ jp: "ねこ", en: "cat" }, { jp: "りんご", en: "apple" }, { jp: "三毛ねこ", en: "calico cat" }]

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

const broadcastRoomInfo = () => {
    io.emit("roomInfo", room);
    io.emit("gameStatus", { isStarted: isStarted, currentTurn: currentTurn, currentWord: currentWord });

    console.log("Room status:", isStarted, currentTurn, currentWord);
}

const updateRoom = (fn: (room: User[]) => void) => {
    fn(room);
    broadcastRoomInfo();
}

const endGame = (() => {
    isStarted = false;
    currentWord = null;
    currentTurn = 0;
})

const startGame = () => {
    isStarted = true;
    console.log("Game Started 🎮");

    broadcastRoomInfo();
    currentTurn = 0;

    setTimeout(() => {
        const currentWord = words[Math.floor(Math.random() * words.length)];
        broadcastRoomInfo();
    }, 3000);
}

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
}, 1000);

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
        if (room.length < 4 && !isStarted) {
            const uuid = crypto.randomUUID();
            updateRoom((r) => r.push({ displayName, userId: uuid, pulse: previousPulse }));
            socket.emit("joined", uuid);
            userId = uuid;

            if (room.length == 4) {
                startGame();
            }
        }
    });

    socket.on("success", () => {
        console.log("success 💻");

        if (userId == room[currentTurn].userId) {
            if (currentTurn == room.length - 1) {
                currentTurn = 0;
            } else {
                currentTurn += 1;
            }

            broadcastRoomInfo();
        }
    })

    socket.on("startGame", () => {
        if (userId && room.map((user) => user.userId).includes(userId) && room.length < 5 && room.length > 1 && !isStarted) {
            startGame();
        }
    })

    socket.on("pulseResponse", (response: { userId: string; newPulse: string }) => {
        updateRoom((r) => {
            for (let i = r.length - 1; i >= 0; i--) {
                if (r[i].userId == userId) {
                    r[i].pulse = response.newPulse
                }
            }
        });
        console.log("Pulse response received📡:", response.newPulse, "Current Users", room);
    });
});

httpServer.listen(3001, () => {
    console.log("Socket.IO Server running on :3001");
});