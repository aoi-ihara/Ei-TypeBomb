import type { GameState, Room, User } from "./types";
import type { ServerGameEvent } from "./protocol";
import { requireRoomItems } from "./validation";

export type GameEvent =
    | { event: "room:join"; player: User }
    | { event: "room:leave"; playerId: string }
    | { event: "game:start"; playerId: string }
    | { event: "word:success"; playerId: string }
    | { event: "currentInput"; playerId: string; input: unknown }
    | { event: "deadlines" }
    | { event: "game:reset" };
export type GameContext = {
    now: number;
    random: () => number;
    gameId?: string;
    allowCountdownPass?: boolean;
    allowSpectatorStart?: boolean;
};
export type GameEffect = Extract<ServerGameEvent, { event: "typing:input" | "game:end" | "game:quited" }>;
export type GameResult = { state: GameState; effects: GameEffect[] };

// Adapters may also use this to preserve full-room response behavior.
export function hasPlayerCapacity(room: Room): boolean {
    return Boolean(room.maxPlayers) && (room.users?.length ?? 0) < room.maxPlayers!;
}

export function applyGameEvent(state: GameState, event: GameEvent, context: GameContext): GameResult {
    const room = state.room;
    const users = room.users ?? [];
    const effects: GameEffect[] = [];
    const unchanged = () => ({ state, effects });
    const clearInput = () => effects.push({ event: "typing:input", data: { input: "" } });
    const reset = (clearUsers = false): GameState => ({
        room: { ...room, isStart: false, gameId: undefined, bombStatus: 0, bombHolder: 0, wordIndex: undefined,
            ...(clearUsers ? { users: [] } : {}) },
    });
    const nextBombAt = () => {
        const duration = room.gameDuration ?? 20;
        const base = Number.isInteger(duration) && duration >= 1 && duration <= 2147473 ? duration : 20;
        return context.now + (base + context.random() * 10) * 1000;
    };
    const nextWord = () => room.items?.length ? Math.floor(context.random() * room.items.length) : undefined;
    switch (event.event) {
        case "room:join":
            if (!hasPlayerCapacity(room) || users.some(user => user.id === event.player.id)) return unchanged();
            return { state: { ...state, room: { ...room, users: [...users, { ...event.player }] } }, effects };
        case "room:leave":
            if (!users.some(user => user.id === event.playerId)) return unchanged();
            if (room.isStart) {
                clearInput();
                effects.push({ event: "game:quited", data: undefined });
                return { state: reset(true), effects };
            }
            return { state: { ...state, room: { ...room, users: users.filter(user => user.id !== event.playerId) } }, effects };
        case "game:start":
            if (room.isStart || users.length < 2 || (!context.allowSpectatorStart && !users.some(user => user.id === event.playerId))) return unchanged();
            if (!context.gameId) throw new Error("game:start requires a gameId");
            requireRoomItems(room);
            const bombHolder = Math.floor(context.random() * users.length);
            clearInput();
            return {
                state: { room: { ...room, gameId: context.gameId, isStart: true, bombHolder, wordIndex: undefined, bombStatus: 0 },
                    wordAt: context.now + 3000, bombAt: nextBombAt() },
                effects,
            };
        case "currentInput":
            if (!room.isStart || users[room.bombHolder ?? 0]?.id !== event.playerId || typeof event.input !== "string") return unchanged();
            effects.push({ event: "typing:input", data: { input: event.input.slice(0, 32) } });
            return unchanged();
        case "word:success":
            if (!room.isStart || room.bombHolder === undefined || users[room.bombHolder]?.id !== event.playerId ||
                (state.wordAt !== undefined && !context.allowCountdownPass)) return unchanged();
            clearInput();
            return { state: { ...state, room: { ...room, bombHolder: (room.bombHolder + 1) % users.length, wordIndex: nextWord() } }, effects };
        case "game:reset":
            if (!room.isStart && room.gameId === undefined && room.bombStatus === 0 && room.bombHolder === 0 &&
                room.wordIndex === undefined && state.wordAt === undefined && state.bombAt === undefined) return unchanged();
            clearInput();
            return { state: reset(), effects };
        case "deadlines": {
            if (!room.isStart) return unchanged();
            let next = state;
            if (state.wordAt !== undefined && state.wordAt <= context.now) {
                next = { ...next, room: { ...room, wordIndex: nextWord() }, wordAt: undefined };
                clearInput();
            }
            if (state.bombAt !== undefined && state.bombAt <= context.now) {
                if (room.bombStatus === 4) {
                    const loser = users[room.bombHolder ?? 0];
                    if (loser) effects.push({ event: "game:end", data: { holderUserId: loser.id, holderDisplayName: loser.displayName } });
                    clearInput();
                    next = reset(true);
                } else {
                    next = { ...next, room: { ...next.room, bombStatus: room.bombStatus + 1 }, bombAt: nextBombAt() };
                }
            }
            return { state: next, effects };
        }
    }
}
