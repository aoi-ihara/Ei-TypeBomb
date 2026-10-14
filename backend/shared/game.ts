import type { GameState, User } from "./types";
import type { ServerGameEvent } from "./protocol";
import { roomSnapshot } from "./protocol";
import { MAX_CURRENT_INPUT_LENGTH, requireRoomItems } from "./validation";

export type GameEvent =
    | { type: "room:join"; player: User }
    | { type: "room:leave"; playerId: string; reason: "disconnect" | "room_leave" }
    | { type: "game:start"; playerId: string; gameId: string; gameDuration: number }
    | { type: "word:success"; playerId: string }
    | { type: "player:rename"; playerId: string; displayName: string }
    | { type: "currentInput"; playerId: string; input: unknown }
    | { type: "deadline" };

export type GameRules = {
    allowSpectatorStart: boolean;
    allowCountdownPass: boolean;
    clearInputOnStop: boolean;
};
export type GameContext = { now: number; random: () => number; rules: GameRules };
export type Activity = {
    event: "player_joined" | "player_left" | "game_started" | "game_cancelled" | "game_finished" | "word_passed";
    playerCount: number;
    reason?: "disconnect" | "room_leave";
};
export type GameEffect =
    | { type: "broadcast"; packet: ServerGameEvent }
    | { type: "activity"; activity: Activity };
export type GameResult = { state: GameState; effects: GameEffect[] };

// Set only at game start. A bomb disappears permanently when it explodes.
export const bombsForPlayers = (players: number): number =>
    Math.max(1, Math.ceil(players / 4));

export function canStart(state: GameState, playerId: string, rules: GameRules): boolean {
    const room = state.room;
    return !room.isStart && room.users.length >= 2 &&
        (rules.allowSpectatorStart || room.users.some(user => user.id === playerId));
}

export function nextGameDeadline(state: GameState): number | undefined {
    const deadlines = [state.wordAt, ...(state.room.bombs?.map(bomb => bomb.at) ?? 
        (state.bombAt === undefined ? [] : [state.bombAt]))]
        .filter((at): at is number => at !== undefined);
    return deadlines.length ? Math.min(...deadlines) : undefined;
}

export function applyGameEvent(state: GameState, event: GameEvent, context: GameContext): GameResult {
    const effects: GameEffect[] = [];
    const next: GameState = {
        ...state,
        revision: state.revision ?? 0,
        room: {
            ...state.room,
            users: state.room.users.map(user => ({ ...user })),
            bombs: state.room.bombs?.map(bomb => ({ ...bomb })),
            losers: state.room.losers?.map(loser => ({ ...loser })),
        },
    };
    const room = next.room;
    const broadcast = (packet: ServerGameEvent) => effects.push({ type: "broadcast", packet });
    const activity = (event: Activity["event"], reason?: Activity["reason"]) =>
        effects.push({ type: "activity", activity: { event, playerCount: room.users.length, reason } });
    const clearInput = (playerId?: string) =>
        broadcast({ event: "typing:input", data: { input: "", ...(playerId ? { playerId } : {}) } });
    const snapshot = () => broadcast({ event: "room:broadcast", data: roomSnapshot(room, next.revision) });
    const ignored = (): GameResult => ({ state, effects: [] });
    const random = () => Math.max(0, Math.min(1 - Number.EPSILON, context.random()));
    const index = (length: number) => Math.floor(random() * length);
    const bombAt = () => {
        const duration = room.gameDuration;
        const base = Number.isInteger(duration) && duration >= 1 && duration <= 2147473 ? duration : 20;
        return context.now + (base + random() * 10) * 1000;
    };
    const syncLegacy = () => {
        const first = room.bombs?.[0];
        room.bombHolder = first?.holder ?? 0;
        room.bombStatus = first?.status ?? 0;
        room.wordIndex = first?.wordIndex;
        next.bombAt = room.bombs?.length
            ? Math.min(...room.bombs.map(bomb => bomb.at)) : undefined;
    };
    const reset = () => {
        Object.assign(room, {
            isStart: false, gameId: undefined, bombStatus: 0, bombHolder: 0,
            wordIndex: undefined, bombs: undefined, losers: undefined,
        });
        next.wordAt = next.bombAt = undefined;
        if (context.rules.clearInputOnStop) clearInput();
    };
    const activeBomb = (playerId: string) =>
        room.isStart
            ? room.bombs?.find(bomb => room.users[bomb.holder]?.id === playerId)
            : undefined;
    const nextLivingHolder = (holder: number): number => {
        const out = new Set((room.losers ?? []).map(loser => loser.id));
        for (let offset = 1; offset <= room.users.length; offset++) {
            const candidate = (holder + offset) % room.users.length;
            if (!out.has(room.users[candidate].id)) return candidate;
        }
        return holder;
    };

    switch (event.type) {
        case "room:join":
            if (room.isStart || !room.maxPlayers || room.users.length >= room.maxPlayers)
                return ignored();
            if (!room.users.some(user => user.id === event.player.id)) {
                room.users.push({ ...event.player });
                activity("player_joined");
            }
            break;
        case "room:leave":
            if (!room.users.some(user => user.id === event.playerId)) return ignored();
            if (room.isStart) {
                activity("game_cancelled", event.reason);
                reset();
                room.users = [];
                broadcast({ event: "game:quited", data: undefined });
            } else room.users = room.users.filter(user => user.id !== event.playerId);
            activity("player_left", event.reason);
            break;
        case "game:start":
            if (!canStart(state, event.playerId, context.rules)) return ignored();
            requireRoomItems(room);
            room.gameDuration = event.gameDuration;
            room.gameId = event.gameId;
            room.isStart = true;
            room.losers = [];
            const count = bombsForPlayers(room.users.length);
            const initial = index(room.users.length);
            room.bombs = Array.from({ length: count }, (_, id) => ({
                id: String(id),
                holder: (initial + Math.floor(id * room.users.length / count)) % room.users.length,
                status: 0,
                wordIndex: undefined,
                at: bombAt(),
                turn: 0,
            }));
            next.wordAt = context.now + 3000;
            syncLegacy();
            clearInput();
            activity("game_started");
            break;
        case "word:success": {
            const bomb = activeBomb(event.playerId);
            if (!bomb || (!context.rules.allowCountdownPass && next.wordAt !== undefined))
                return ignored();
            bomb.holder = nextLivingHolder(bomb.holder);
            bomb.wordIndex = index(room.items.length);
            bomb.turn++;
            syncLegacy();
            clearInput(event.playerId);
            activity("word_passed");
            break;
        }
        case "player:rename": {
            const player = room.users.find(user => user.id === event.playerId);
            if (!player || player.displayName === event.displayName) return ignored();
            player.displayName = event.displayName;
            break;
        }
        case "currentInput": {
            if (!activeBomb(event.playerId)) return ignored();
            const raw = event.input;
            const input = typeof raw === "string" ? raw :
                raw && typeof raw === "object" && "input" in raw && typeof raw.input === "string"
                    ? raw.input : null;
            if (input === null) return ignored();
            const failed = typeof raw === "object" && raw !== null &&
                "failed" in raw && raw.failed === true;
            broadcast({
                event: "typing:input",
                data: {
                    input: input.slice(0, MAX_CURRENT_INPUT_LENGTH),
                    playerId: event.playerId,
                    ...(failed ? { failed: true } : {}),
                },
            });
            return { state, effects };
        }
        case "deadline": {
            if (!room.isStart) return ignored();
            let due = false;
            if (next.wordAt !== undefined && next.wordAt <= context.now) {
                due = true;
                next.wordAt = undefined;
                for (const bomb of room.bombs ?? []) bomb.wordIndex = index(room.items.length);
                clearInput();
            }
            // Independent bomb timers. A loser can only be counted once:
            // if they hold other bombs, those bombs move to the next survivor.
            for (const bomb of [...(room.bombs ?? [])]) {
                if (bomb.at > context.now) continue;
                due = true;
                if (bomb.status === 4) {
                    const loser = room.users[bomb.holder];
                    if (loser && !room.losers?.some(item => item.id === loser.id)) {
                        room.losers?.push({ id: loser.id, displayName: loser.displayName });
                    }
                    room.bombs = room.bombs?.filter(item => item.id !== bomb.id);
                    for (const other of room.bombs ?? []) {
                        if (other.holder === bomb.holder) {
                            other.holder = nextLivingHolder(other.holder);
                            other.turn++;
                            other.wordIndex = index(room.items.length);
                        }
                    }
                    clearInput();
                } else {
                    bomb.status++;
                    bomb.at = bombAt();
                }
            }
            if (!due) return ignored();
            if (!room.bombs?.length) {
                const losers = room.losers ?? [];
                const last = losers[losers.length - 1];
                broadcast({
                    event: "game:end",
                    data: {
                        holderUserId: last?.id ?? "",
                        holderDisplayName: last?.displayName,
                        losers,
                    },
                });
                activity("game_finished");
                reset();
                room.users = [];
            } else syncLegacy();
            break;
        }
    }
    if (JSON.stringify({ ...next, revision: undefined }) !==
        JSON.stringify({ ...state, revision: undefined }))
        next.revision = (state.revision ?? 0) + 1;
    snapshot();
    return { state: next, effects };
}
