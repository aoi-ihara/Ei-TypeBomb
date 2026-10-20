import type { Room } from "./types";

/** Absolute wall-clock deadlines are serializable across Node and Workers. */
export const RECONNECT_GRACE_MS = 20_000;
export const NODE_SESSION_GRACE_MS = 8_000;

export type PlayerSession = {
    connected: boolean;
    expires: number;
    recommendation?: string;
    connectionId?: string;
};

/** A transport retry/error/close must never restart an existing grace period. */
export function disconnectDeadline(
    room: Room,
    playerId: string,
    now: number,
    graceMs = RECONNECT_GRACE_MS,
    pendingDeadline?: number,
): number {
    const participant = room.isStart && room.users.some(player => player.id === playerId);
    return pendingDeadline ?? now + (participant ? Math.max(graceMs, RECONNECT_GRACE_MS) : graceMs);
}

/** Connected spectators and reconnect reservations also own room lifetime. */
export function canDeleteRoom(room: Room, sessionCount: number): boolean {
    return !room.isStart && room.users.length === 0 && sessionCount === 0;
}
