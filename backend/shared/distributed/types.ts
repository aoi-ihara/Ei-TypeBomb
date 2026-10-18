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
        { connected: boolean; expires: number; recommendation?: string }
    >;
    events: Record<string, number>;
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
    leaseUntil: number;
    savedAt: number;
    pausedAt?: number;
};
export type Checkpoint = {
    ownership: Ownership;
    value: DurableRoom | null;
    receipt: string;
};
export type ControlResult = Checkpoint & {
    servers: ServerInfo[];
    duplicate?: boolean;
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
export const LEASE_MS = 3_000;
export const GRACE_MS = 20_000;
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
export const GAME_RULES = {
    allowSpectatorStart: true,
    allowCountdownPass: true,
    clearInputOnStop: false,
};
