import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

type User = {
    displayName: string;
    userId: string;
    pulse?: string;
};

let room: User[] = [];
let previousPulse: string = "";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
    },
});

function updateRoom(fn: (room: User[]) => void) {
    fn(room);
    io.emit("roomInfo", room);
}

setInterval(() => {
    updateRoom((r) => {
        for (let i = r.length - 1; i >= 0; i--) {
            if (r[i].pulse !== previousPulse) {
                console.log("user kicked:", previousPulse, "!=", r[i].pulse);
                r.splice(i, 1);
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
    });

    socket.on("disconnect", () => {
        console.log("Disconnected:", socket.id);
    });

    socket.on("joinRoom", (displayName: string) => {
        if (room.length < 4) {
            const uuid = crypto.randomUUID();
            updateRoom((r) => r.push({ displayName, userId: uuid, pulse: previousPulse }));
            socket.emit("joined", uuid);
            userId = uuid;
        }
    });

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