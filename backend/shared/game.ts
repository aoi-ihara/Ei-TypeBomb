import type { GameState, User } from "./types";
import type { ServerGameEvent } from "./protocol";
import { roomSnapshot } from "./protocol";
import { MAX_CURRENT_INPUT_LENGTH, requireRoomItems } from "./validation";
export type GameEvent =
    | { type: "room:join"; player: User }
    | {
          type: "room:leave";
          playerId: string;
          reason: "disconnect" | "room_leave";
      }
    | {
          type: "game:start";
          playerId: string;
          gameId: string;
          gameDuration: number;
      }
    | { type: "word:success"; playerId: string }
    | { type: "player:rename"; playerId: string; displayName: string }
    | { type: "currentInput"; playerId: string; input: unknown }
    | { type: "deadline" };
// Callers choose compatibility policies; the core has no runtime dependencies.
export type GameRules = {
    allowSpectatorStart: boolean;
    allowCountdownPass: boolean;
    clearInputOnStop: boolean;
};
export type GameContext = {
    now: number;
    random: () => number;
    rules: GameRules;
};
export type Activity = {
    event:
        | "player_joined"
        | "player_left"
        | "game_started"
        | "game_cancelled"
        | "game_finished"
        | "word_passed";
    playerCount: number;
    reason?: "disconnect" | "room_leave";
};
export type GameEffect =
    | { type: "broadcast"; packet: ServerGameEvent }
    | { type: "activity"; activity: Activity };
export type GameResult = { state: GameState; effects: GameEffect[] };
export function canStart(
    state: GameState,
    playerId: string,
    rules: GameRules,
): boolean {
    const room = state.room;
    return (
        !room.isStart &&
        room.users.length >= 2 &&
        (rules.allowSpectatorStart ||
            room.users.some((user) => user.id === playerId))
    );
}
export function nextGameDeadline(state: GameState): number | undefined {
    const deadlines = [state.wordAt, state.bombAt].filter(
        (at): at is number => at !== undefined,
    );
    return deadlines.length ? Math.min(...deadlines) : undefined;
}
export function applyGameEvent(
    state: GameState,
    event: GameEvent,
    context: GameContext,
): GameResult {
    const effects: GameEffect[] = [];
    const next: GameState = {
        ...state,
        revision: state.revision ?? 0,
        room: {
            ...state.room,
            users: state.room.users.map((user) => ({ ...user })),
        },
    };
    const room = next.room;
    const broadcast = (packet: ServerGameEvent) =>
        effects.push({ type: "broadcast", packet });
    const activity = (event: Activity["event"], reason?: Activity["reason"]) =>
        effects.push({
            type: "activity",
            activity: { event, playerCount: room.users.length, reason },
        });
    const clearInput = () =>
        broadcast({ event: "typing:input", data: { input: "" } });
    const snapshot = () =>
        broadcast({
            event: "room:broadcast",
            data: roomSnapshot(room, next.revision),
        });
    const ignored = (): GameResult => ({ state, effects: [] });
    // Clamp injected entropy to guarantee valid indexes even at boundary values.
    const random = () =>
        Math.max(0, Math.min(1 - Number.EPSILON, context.random()));
    const index = (length: number) => Math.floor(random() * length);
    const bombAt = () => {
        const duration = room.gameDuration;
        const base =
            Number.isInteger(duration) && duration >= 1 && duration <= 2147473
                ? duration
                : 20;
        return context.now + (base + random() * 10) * 1000;
    };
    const reset = () => {
        Object.assign(room, {
            isStart: false,
            gameId: undefined,
            bombStatus: 0,
            bombHolder: 0,
            wordIndex: undefined,
        });
        next.wordAt = next.bombAt = undefined;
        if (context.rules.clearInputOnStop) clearInput();
    };
    const isHolder = (playerId: string) =>
        room.isStart && room.users[room.bombHolder]?.id === playerId;
    switch (event.type) {
        case "room:join":
            if (!room.maxPlayers || room.users.length >= room.maxPlayers)
                return ignored();
            if (!room.users.some((user) => user.id === event.player.id)) {
                room.users.push({ ...event.player });
                activity("player_joined");
            }
            break;
        case "room:leave":
            if (!room.users.some((user) => user.id === event.playerId))
                return ignored();
            if (room.isStart) {
                activity("game_cancelled", event.reason);
                reset();
                room.users = [];
                broadcast({ event: "game:quited", data: undefined });
            } else
                room.users = room.users.filter(
                    (user) => user.id !== event.playerId,
                );
            activity("player_left", event.reason);
            break;
        case "game:start":
            if (!canStart(state, event.playerId, context.rules))
                return ignored();
            requireRoomItems(room);
            Object.assign(room, {
                gameDuration: event.gameDuration,
                gameId: event.gameId,
                isStart: true,
                bombHolder: index(room.users.length),
                wordIndex: undefined,
                bombStatus: 0,
            });
            next.wordAt = context.now + 3000;
            next.bombAt = bombAt();
            clearInput();
            activity("game_started");
            break;
        case "word:success":
            if (
                !isHolder(event.playerId) ||
                (!context.rules.allowCountdownPass && next.wordAt !== undefined)
            )
                return ignored();
            room.bombHolder = (room.bombHolder + 1) % room.users.length;
            room.wordIndex = index(room.items.length);
            clearInput();
            activity("word_passed");
            break;
        case "player:rename": {
            const player = room.users.find(
                (user) => user.id === event.playerId,
            );
            if (!player || player.displayName === event.displayName)
                return ignored();
            player.displayName = event.displayName;
            break;
        }
        case "currentInput":
            if (!isHolder(event.playerId) || typeof event.input !== "string")
                return ignored();
            broadcast({
                event: "typing:input",
                data: { input: event.input.slice(0, MAX_CURRENT_INPUT_LENGTH) },
            });
            return { state, effects };
        case "deadline": {
            if (!room.isStart) return ignored();
            let due = false;
            if (next.wordAt !== undefined && next.wordAt <= context.now) {
                due = true;
                next.wordAt = undefined;
                room.wordIndex = index(room.items.length);
                clearInput();
            }
            if (next.bombAt !== undefined && next.bombAt <= context.now) {
                due = true;
                if (room.bombStatus === 4) {
                    const loser = room.users[room.bombHolder];
                    if (loser)
                        broadcast({
                            event: "game:end",
                            data: {
                                holderUserId: loser.id,
                                holderDisplayName: loser.displayName,
                            },
                        });
                    activity("game_finished");
                    reset();
                    room.users = [];
                } else {
                    room.bombStatus++;
                    next.bombAt = bombAt();
                }
            }
            if (!due) return ignored();
            break;
        }
    }
    // Revision tracks persisted GameState changes, not emitted effects. This
    // intentionally excludes currentInput, which returns above without mutation.
    if (
        JSON.stringify({ ...next, revision: undefined }) !==
        JSON.stringify({ ...state, revision: undefined })
    )
        next.revision = (state.revision ?? 0) + 1;
    snapshot();
    return { state: next, effects };
}
