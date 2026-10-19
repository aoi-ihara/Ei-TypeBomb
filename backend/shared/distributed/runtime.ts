import {
    applyGameEvent,
    nextGameDeadline,
    type GameEvent,
    type GameResult,
} from "../game";
import { roomSnapshot } from "../protocol";
import type { GameState, Room } from "../types";
import {
    GAME_RULES,
    GRACE_MS,
    MAX_SNAPSHOT_BYTES,
    type Checkpoint,
    type Command,
    type Control,
    type ControlResult,
    type DurableRoom,
} from "./types";

export function resumeDeadlines(game: GameState, pauseMs: number): GameState {
    const next = structuredClone(game);
    if (next.wordAt !== undefined) next.wordAt += pauseMs;
    if (next.bombAt !== undefined) next.bombAt += pauseMs;
    for (const bomb of next.room.bombs ?? []) bomb.at += pauseMs;
    return next;
}
export class DistributedRoom {
    checkpoint!: Checkpoint;
    private queue: Promise<unknown> = Promise.resolve();
    private lastConfirmation = 0;
    private lastFull = 0;
    private inputs = new Map<string, GameEvent>();
    private ticking = false;
    inputFlushAt?: number;
    get needsInputFlush() {
        return this.inputs.size > 0;
    }
    private pauseAt?: number;
    halted = false;
    deleted = false;
    constructor(
        readonly roomId: string,
        private readonly control: Control,
        private readonly publish: (
            result: GameResult,
            checkpoint: Checkpoint,
        ) => void,
        private readonly now = Date.now,
        private readonly random = Math.random,
    ) {}
    get state(): GameState {
        return this.checkpoint.value!.game;
    }
    private serial<T>(task: () => Promise<T>): Promise<T> {
        const next = this.queue.then(task);
        this.queue = next.catch(() => {});
        return next;
    }
    async open(initial?: Room): Promise<void> {
        return this.serial(async () => {
            const value: DurableRoom | undefined = initial
                ? {
                      game: { room: initial, revision: 0 },
                      sessions: {},
                      events: {},
                  }
                : undefined;
            const result = await this.control.call("open", {
                roomId: this.roomId,
                initial: value,
            });
            if (!result.value) throw new Error("No recoverable checkpoint");
            this.checkpoint = result;
            this.lastConfirmation = this.now();
            if (result.ownership.lifecycle === "MIGRATING") {
                const restored = structuredClone(result.value);
                restored.game = resumeDeadlines(
                    restored.game,
                    Math.max(
                        0,
                        this.now() -
                            (restored.pausedAt ??
                                result.ownership.pausedAt ??
                                result.ownership.savedAt),
                    ),
                );
                const floor = this.now() + 100;
                if (restored.game.wordAt !== undefined)
                    restored.game.wordAt = Math.max(
                        floor,
                        restored.game.wordAt,
                    );
                if (restored.game.bombAt !== undefined)
                    restored.game.bombAt = Math.max(
                        floor,
                        restored.game.bombAt,
                    );
                for (const bomb of restored.game.room.bombs ?? [])
                    bomb.at = Math.max(floor, bomb.at);
                restored.resumeUntil = this.now() + GRACE_MS;
                restored.pausedAt = this.now();
                for (const session of Object.values(restored.sessions)) {
                    session.connected = false;
                    session.expires = restored.resumeUntil;
                }
                this.pauseAt = this.now();
                await this.save(restored, [], "migration");
            } else if (result.ownership.lifecycle === "CREATING") {
                await this.save(result.value, [], "create");
            } else if (result.value.resumeUntil) {
                this.pauseAt =
                    result.value.pausedAt ?? result.ownership.savedAt;
            }
        });
    }
    private assertActive() {
        if (this.halted || this.deleted)
            throw new Error("Room paused: authority unavailable");
    }
    private async save(
        value: DurableRoom,
        effects: GameResult["effects"],
        kind: string,
    ) {
        this.assertActive();
        const own = this.checkpoint.ownership;
        for (const effect of effects) {
            if (
                effect.type === "broadcast" &&
                effect.packet.event === "game:end" &&
                this.checkpoint.value?.game.room.gameId
            )
                value.outcome = {
                    gameId: this.checkpoint.value.game.room.gameId,
                    data: effect.packet.data,
                };
        }
        // revision is the durable commit sequence, including typing/session changes.
        value.game.revision = own.revision + 1;
        if (
            new TextEncoder().encode(JSON.stringify(value)).byteLength >
            MAX_SNAPSHOT_BYTES
        )
            throw new Error("Checkpoint too large");
        let result: ControlResult;
        try {
            result = await this.control.call("commit", {
                roomId: this.roomId,
                instance: own.instance,
                epoch: own.epoch,
                revision: own.revision,
                value,
                kind,
            });
        } catch (error) {
            this.halted = true;
            throw error;
        }
        this.checkpoint = result;
        this.lastConfirmation = this.now();
        // call(commit) returned only after the fixed voting suffix stored the
        // state and the tail's signed commit decision flowed back through it.
        this.publish(
            {
                state: this.state,
                effects: effects.map((effect) =>
                    effect.type === "broadcast" &&
                    effect.packet.event === "room:broadcast"
                        ? {
                              type: "broadcast",
                              packet: {
                                  event: "room:broadcast",
                                  data: roomSnapshot(
                                      this.state.room,
                                      this.state.revision,
                                  ),
                              },
                          }
                        : effect,
                ),
            },
            result,
        );
    }
    private reduce(value: DurableRoom, event: GameEvent) {
        return applyGameEvent(value.game, event, {
            now: this.now(),
            random: this.random,
            rules: GAME_RULES,
            chooseItemIndex: (id, room) => {
                const item = value.sessions[id]?.recommendation;
                const index = room.items.findIndex(
                    (entry) => entry.id === item,
                );
                return index < 0 ? undefined : index;
            },
        });
    }
    apply(event: GameEvent): Promise<void> {
        if (event.type === "currentInput" || event.type === "hint:update") {
            // Latest typing value wins, bounded to one commit per 100ms tick.
            this.inputs.set(`${event.type}:${event.playerId}`, event);
            this.inputFlushAt ??= this.now() + 100;
            return Promise.resolve();
        }
        return this.serial(async () => {
            this.assertActive();
            if (this.checkpoint.value!.resumeUntil) return;
            const value = structuredClone(this.checkpoint.value!);
            const result = this.reduce(value, event);
            if (result.state === value.game) return;
            value.game = result.state;
            await this.save(value, result.effects, "event");
        });
    }
    command(
        command: Command,
        playerId: string,
    ): Promise<"accepted" | "retry" | "rejected"> {
        return this.serial(async () => {
            this.assertActive();
            const own = this.checkpoint.ownership;
            const current = this.checkpoint.value!;
            if (current.events[command.id] !== undefined) return "accepted";
            if (
                command.instance !== own.instance ||
                !Number.isSafeInteger(command.originRevision) ||
                command.originRevision > own.revision ||
                command.originRevision < own.revision - 4096
            )
                return "rejected";
            if (
                command.epoch !== own.epoch ||
                command.revision !== own.revision ||
                current.resumeUntil
            )
                return "retry";
            if (!/^[0-9a-f-]{36}$/i.test(command.id))
                throw new Error("Invalid event ID");
            if (!current.sessions[playerId]?.connected)
                throw new Error("Session is not connected");
            const event = command.event;
            const heldBomb = current.game.room.bombs?.find(
                (bomb) => current.game.room.users[bomb.holder]?.id === playerId,
            );
            if (
                event.type === "word:success" &&
                (command.gameId !== current.game.room.gameId ||
                    command.bombId !== heldBomb?.id ||
                    command.turn !==
                        current.game.room.bombs?.find(
                            (bomb) =>
                                current.game.room.users[bomb.holder]?.id ===
                                playerId,
                        )?.turn)
            )
                return "rejected";
            // Ignore any client-provided player identity or game configuration.
            let verified: GameEvent;
            switch (event.type) {
                case "word:success":
                    verified = { type: event.type, playerId };
                    break;
                case "room:join":
                    verified = {
                        type: event.type,
                        player: {
                            id: playerId,
                            displayName:
                                typeof event.player?.displayName === "string"
                                    ? event.player.displayName.slice(0, 50)
                                    : undefined,
                        },
                    };
                    break;
                case "room:leave":
                    verified = {
                        type: event.type,
                        playerId,
                        reason: "room_leave",
                    };
                    break;
                case "game:start":
                    verified = {
                        type: event.type,
                        playerId,
                        gameId: crypto.randomUUID(),
                        gameDuration: current.game.room.gameDuration,
                    };
                    break;
                default:
                    throw new Error("Unsupported command");
            }
            const value = structuredClone(current);
            const result = this.reduce(value, verified);
            value.game = result.state;
            if (verified.type === "game:start" && value.game.room.isStart)
                delete value.outcome;
            value.events[command.id] = own.revision + 1;
            // Old IDs fall outside the accepted revision window and stay rejected.
            const ids = Object.keys(value.events);
            for (const id of ids.slice(0, Math.max(0, ids.length - 4096)))
                delete value.events[id];
            await this.save(value, result.effects, "event");
            return "accepted";
        });
    }
    connect(id: string): Promise<void> {
        return this.serial(async () => {
            this.assertActive();
            const value = structuredClone(this.checkpoint.value!);
            value.sessions[id] = {
                ...value.sessions[id],
                connected: true,
                expires: 0,
            };
            if (
                value.resumeUntil &&
                value.game.room.users.every(
                    (user) => value.sessions[user.id]?.connected,
                )
            ) {
                value.game = resumeDeadlines(
                    value.game,
                    Math.max(0, this.now() - (this.pauseAt ?? this.now())),
                );
                delete value.resumeUntil;
                delete value.pausedAt;
                this.pauseAt = undefined;
            }
            await this.save(value, [], "session");
        });
    }
    /** Explicit room exit must remove the player immediately, not wait for
     * the temporary-disconnect grace period. */
    leave(id: string): Promise<void> {
        return this.serial(async () => {
            if (this.halted || this.deleted) return;
            const value = structuredClone(this.checkpoint.value!);
            const present = value.game.room.users.some((user) => user.id === id);
            const session = value.sessions[id];
            if (!present && !session) return;
            // Keep the authenticated socket session while it remains connected:
            // a player may exit and rejoin the same room without reauthenticating.
            // Transport disconnect and its grace timer clean it up later.
            if (!present) return;
            const result = this.reduce(value, {
                type: "room:leave",
                playerId: id,
                reason: "room_leave",
            });
            value.game = result.state;
            await this.save(value, result.effects, "event");
        });
    }
    disconnect(id: string): Promise<void> {
        return this.serial(async () => {
            if (this.halted || this.deleted) return;
            const value = structuredClone(this.checkpoint.value!);
            if (!value.sessions[id]) return;
            value.sessions[id] = {
                ...value.sessions[id],
                connected: false,
                expires: this.now() + GRACE_MS,
            };
            await this.save(value, [], "session");
        });
    }
    recommend(id: string, itemId: string) {
        // Recommendation is included with the next durable game event.
        const value = this.checkpoint.value;
        if (
            value?.sessions[id] &&
            value.game.room.items.some((item) => item.id === itemId)
        )
            value.sessions[id].recommendation = itemId;
    }
    tick(): Promise<void> {
        if (this.ticking) return Promise.resolve();
        this.ticking = true;
        return this.serial(async () => {
            if (this.halted || this.deleted) return;
            const now = this.now();
            if (now - this.lastConfirmation >= 1_000) {
                const own = this.checkpoint.ownership;
                const confirmed = await this.control
                    .call("confirm", {
                        roomId: this.roomId,
                        instance: own.instance,
                        epoch: own.epoch,
                    })
                    .catch((error) => {
                        this.halted = true;
                        throw error;
                    });
                this.checkpoint.ownership = confirmed.ownership;
                this.lastConfirmation = now;
            }
            const value = structuredClone(this.checkpoint.value!);
            const effects: GameResult["effects"] = [];
            let changed = false;
            for (const [id, session] of Object.entries(value.sessions)) {
                if (session.connected || session.expires > now) continue;
                delete value.sessions[id];
                const result = this.reduce(value, {
                    type: "room:leave",
                    playerId: id,
                    reason: "disconnect",
                });
                value.game = result.state;
                effects.push(...result.effects);
                changed = true;
            }
            if (value.resumeUntil && value.resumeUntil <= now) {
                value.game = resumeDeadlines(
                    value.game,
                    Math.max(0, now - (this.pauseAt ?? now)),
                );
                delete value.resumeUntil;
                delete value.pausedAt;
                this.pauseAt = undefined;
                changed = true;
            }
            let kind = "event";
            if (!value.resumeUntil) {
                const deadline = nextGameDeadline(value.game);
                if (deadline !== undefined && deadline <= now) {
                    const result = this.reduce(value, { type: "deadline" });
                    value.game = result.state;
                    effects.push(...result.effects);
                    changed = true;
                }
                if (this.inputFlushAt !== undefined && now >= this.inputFlushAt)
                    for (const input of this.inputs.values()) {
                        const result = this.reduce(value, input);
                        if (
                            JSON.stringify(result.state) !==
                            JSON.stringify(value.game)
                        ) {
                            value.game = result.state;
                            effects.push(...result.effects);
                            if (!changed) kind = "input";
                            changed = true;
                        }
                    }
            }
            if (this.inputFlushAt !== undefined && now >= this.inputFlushAt) {
                this.inputs.clear();
                this.inputFlushAt = undefined;
            }
            if (changed) await this.save(value, effects, kind);
            if (
                !Object.keys(value.sessions).length &&
                !value.game.room.isStart
            ) {
                // A newly created room can have no sockets only until its first auth.
                if (
                    now - this.checkpoint.ownership.savedAt < GRACE_MS &&
                    !changed
                )
                    return;
                const own = this.checkpoint.ownership;
                const result = await this.control.call("delete", {
                    roomId: this.roomId,
                    instance: own.instance,
                    epoch: own.epoch,
                    revision: own.revision,
                });
                this.checkpoint = result;
                this.deleted = true;
                return;
            }
            if (
                Object.keys(value.sessions).length &&
                now - this.lastFull >= 5_000
            ) {
                await this.control.call("snapshot", { roomId: this.roomId });
                this.lastFull = now;
            }
        }).finally(() => {
            this.ticking = false;
        });
    }
    snapshot() {
        this.assertActive();
        return {
            ...roomSnapshot(this.state.room, this.state.revision),
            ...this.metadata(),
            outcome: this.checkpoint.value?.outcome,
        };
    }
    metadata() {
        const own = this.checkpoint.ownership;
        return {
            roomInstanceId: own.instance,
            ownerServerId: own.owner,
            epoch: own.epoch,
            revision: own.revision,
            migrating: !!this.checkpoint.value?.resumeUntil,
        };
    }
    dispose() {
        this.halted = true;
    }
}
