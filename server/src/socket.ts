import type { Server } from "socket.io";
import { Events } from "../events";
import { room, addUser, removeUser } from "./room";
import type { User, JoinRequest } from "../types";

export function registerSocket(io: Server) {
    io.on("connection", (socket) => {
        console.log("connected:", socket.id);

        socket.on(Events.ROOM_WATCH, () => {
            socket.emit(Events.ROOM_STATE, room);
            console.log("Room Info Emitted");
        });

        socket.on(Events.ROOM_JOIN, (data: JoinRequest) => {
            const newUser: User = {
                userId: socket.id,
                displayName: data.displayName,
            };

            addUser(newUser);
            io.emit(Events.ROOM_STATE, room);
            console.log("Room Joined");
        });

        socket.on("disconnect", () => {
            removeUser(socket.id);
            io.emit(Events.ROOM_STATE, room);
            console.log("User Disconnected");
        });
    });
}
