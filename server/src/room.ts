import type { GameState } from "../../shared/types";
import { words } from "./words";

export const room: GameState = {
    status: "waiting",
    bombHolder: null,
    wordIndex: null,
    bombStatus: 0,
    users: [],
    remainingTime: 0,
};

export function startGame() {
    room.status = "playing";
}

export function updateWord() {
    room.wordIndex = Math.floor(Math.random() * words.length);
}
