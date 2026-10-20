import type { GameState } from "../types";
import type { GameEvent } from "../game";

export type Lifecycle =
    | "CREATING"
    | "ACTIVE"
    | "MIGRATING"
    | "DELETING"
    | "DELETED";
export type ServerInfo = {
    id: string;
    parent: string | null;
    depth: number;
    transport: "socket.io" | "websocket";
    seen: number | null;
};
export type DurableRoom = {
    game: GameState;
    // Connected spectators count too. A transport disconnect starts a grace period.
    sessions: Record<
        string,
        { connected: boolean; expires: number; recommendation?: string; connectionId?: string }
    >;
    events: Record<string, number>;
    /** A player has joined this room at least once; used to clean up empty rooms. */
    hadPlayers?: boolean;
    /** Legacy checkpoint field. No longer permits deleting a room with live sessions. */
    emptiedByLeave?: boolean;
    resumeUntil?: number;
    pausedAt?: number;
    outcome?: {
        gameId: string;
        data: import("../protocol").ServerPayloads["game:end"];
    };
};
export type Ownership = {
    roomId: string;
    instance: string;
    owner: string;
    epoch: number;
    revision: number;
    lifecycle: Lifecycle;
    savedAt: number;
    pausedAt?: number;
};
export type Checkpoint = {
    ownership: Ownership;
    value: DurableRoom | null;
};
export type ControlResult = Checkpoint & {
    servers: ServerInfo[];
};
export interface Control {
    call(op: string, args?: Record<string, unknown>): Promise<ControlResult>;
}
export type Command = {
    originRevision: number;
    gameId?: string;
    turn?: number;
    bombId?: string;
    id: string;
    instance: string;
    epoch: number;
    revision: number;
    event: GameEvent;
};
export const GRACE_MS = 20_000;
// Lobby expiry is short; active-match disconnects use at least GRACE_MS.
// A transient loss keeps the seat, but an expired grace must remove it.
export const NODE_DISCONNECT_GRACE_MS = 8_000;
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
export const GAME_RULES = {
    allowSpectatorStart: true,
    allowCountdownPass: true,
    clearInputOnStop: false,
};
