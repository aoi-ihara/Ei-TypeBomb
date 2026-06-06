import type { GameState, User } from "../types";
import { words } from "./words";

export const room: GameState = {
    status: "waiting",
    bombHolder: null,
    wordIndex: null,
    bombStatus: null,
    users: [],
    remainingTime: 0,
};

export function startGame() {
    room.status = "playing";
}

export function setRandomWord() {
    room.wordIndex = Math.floor(Math.random() * words.length);
}

export function addUser(user: User) {
    if (room.users.some((u) => u.userId === user.userId)) return;
    room.users.push(user);
}

export function getUser(userId: string) {
    return room.users.find((user) => user.userId === userId);
}

export function removeUser(userId: string) {
    room.users = room.users.filter((user) => user.userId !== userId);
}
