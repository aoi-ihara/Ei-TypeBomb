import type { Server } from "socket.io";
import { Events } from "../../shared/events";
import { room } from "./room";
import { User } from "../../shared/types";

export function registerSocket(io: Server) {
    io.on("connection", (socket) => {
        console.log("connected:", socket.id);

        socket.on(Events.ROOM_WATCH, () => {
            socket.emit(Events.ROOM_STATE, room);
        });

        socket.on(Events.ROOM_JOIN, (data: User) => {
            if (room.users.some((user) => user.userId === socket.id)) return;

            const user = {
                userId: socket.id,
                displayName: data.displayName,
            };

            room.users.push(user);

            socket.emit(Events.USER_REGISTERED, user);
            io.emit(Events.ROOM_STATE, room);
        });

        socket.on("disconnect", () => {
            room.users = room.users.filter((user) => user.userId !== socket.id);
            io.emit(Events.ROOM_STATE, room);
        });
    });
}
