import {
    applyGameEvent,
    nextGameDeadline,
    type GameEvent,
    type GameResult,
    DEFAULT_GAME_RULES as NODE_GAME_RULES,
} from "../../../shared/game";
import type { GameState } from "../../../shared/types";

export { NODE_GAME_RULES };

// Socket.IO and logging are supplied by index.ts; timer handles never enter GameState.
export class NodeGameAdapter {
    private timer?: ReturnType<typeof setTimeout>;
    constructor(
        public state: GameState,
        private readonly onResult: (
            result: GameResult,
            previous: GameState,
            event: GameEvent,
        ) => void,
        private readonly now = Date.now,
        private readonly random = Math.random,
        private readonly trace: (
            message: string,
            metadata: Record<string, unknown>,
        ) => void = () => {},
        private readonly chooseItemIndex?: (
            playerId: string,
            room: GameState["room"],
        ) => number | undefined,
    ) {
        this.schedule();
    }
    apply(event: GameEvent): GameResult {
        const previous = this.state;
        const appliedAt = this.now();
        let result: GameResult;
        try {
            result = applyGameEvent(previous, event, {
                now: appliedAt,
                random: this.random,
                rules: NODE_GAME_RULES,
                chooseItemIndex: this.chooseItemIndex,
            });
        } catch (error) {
            if (event.type === "deadline") {
                this.trace("deadline_failed", {
                    gameId: previous.room.gameId,
                    bombStatus: previous.room.bombStatus,
                    bombAt: previous.bombAt,
                    wordAt: previous.wordAt,
                    revision: previous.revision,
                    error:
                        error instanceof Error ? error.message : String(error),
                });
            }
            throw error;
        }
        this.state = result.state;
        if (event.type === "deadline") {
            this.trace("deadline_applied", {
                gameId: previous.room.gameId,
                previousStatus: previous.room.bombStatus,
                nextStatus: result.state.room.bombStatus,
                previousBombAt: previous.bombAt,
                nextBombAt: result.state.bombAt,
                previousWordAt: previous.wordAt,
                nextWordAt: result.state.wordAt,
                previousRevision: previous.revision,
                nextRevision: result.state.revision,
                effectEvents: result.effects
                    .filter((effect) => effect.type === "broadcast")
                    .map((effect) => effect.packet.event),
            });
        }
        if (
            previous.wordAt !== result.state.wordAt ||
            previous.bombAt !== result.state.bombAt ||
            previous.room.gameId !== result.state.room.gameId
        )
            this.schedule();
        this.onResult(result, previous, event);
        return result;
    }
    private schedule() {
        this.dispose();
        const deadline = nextGameDeadline(this.state);
        if (deadline === undefined) return;
        const gameId = this.state.room.gameId;
        const delayMs = Math.max(1, Math.ceil(deadline - this.now()));
        this.trace("deadline_scheduled", {
            gameId,
            bombStatus: this.state.room.bombStatus,
            bombAt: this.state.bombAt,
            wordAt: this.state.wordAt,
            nextDeadline: deadline,
            delayMs,
            revision: this.state.revision,
        });
        this.timer = setTimeout(() => {
            this.timer = undefined;
            const firedAt = this.now();
            if (this.state.room.gameId !== gameId) {
                this.trace("deadline_skipped_stale_game", {
                    scheduledGameId: gameId,
                    currentGameId: this.state.room.gameId,
                    scheduledDeadline: deadline,
                    firedAt,
                });
                return;
            }
            this.trace("deadline_fired", {
                gameId,
                scheduledDeadline: deadline,
                firedAt,
                latenessMs: firedAt - deadline,
                bombStatus: this.state.room.bombStatus,
                bombAt: this.state.bombAt,
                wordAt: this.state.wordAt,
                revision: this.state.revision,
            });
            this.apply({ type: "deadline" });
        }, delayMs);
    }
    dispose() {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }
}
