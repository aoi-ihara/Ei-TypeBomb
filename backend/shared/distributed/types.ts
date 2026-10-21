import type { GameState } from "../types";
import type { GameEvent } from "../game";
import type { PlayerSession } from "../session";
export { RECONNECT_GRACE_MS as GRACE_MS, NODE_SESSION_GRACE_MS as NODE_DISCONNECT_GRACE_MS } from "../session";

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
    sessions: Record<string, PlayerSession>;
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
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
export { DEFAULT_GAME_RULES as GAME_RULES } from "../game";
