/** Epoch orders ownership/incarnations; revision only orders commits in it. */
export type RoomVersion = { epoch: number; revision: number };
export function compareRoomVersion(left: RoomVersion, right: RoomVersion): number {
    return left.epoch - right.epoch || left.revision - right.revision;
}

/** A new incarnation must have a strictly greater epoch. An out-of-order
 * snapshot from an old incarnation must not reset the client's version fence. */
export function acceptsRoomSnapshot(
    previous: RoomVersion & { roomInstanceId: string },
    incoming: RoomVersion & { roomInstanceId: string },
): boolean {
    return incoming.epoch > previous.epoch ||
        (incoming.roomInstanceId === previous.roomInstanceId &&
            compareRoomVersion(incoming, previous) >= 0);
}

export function acceptsRoomRoute(
    previous: RoomVersion & { roomInstanceId: string },
    incoming: (RoomVersion & { instance: string; lifecycle: string }) | null,
): boolean {
    if (!incoming) return false;
    // An active route can lag a few commits without clearing the snapshot
    // fence. A tombstone, however, retires that fence and needs a fresh version.
    return acceptsRoomSnapshot(previous, { ...incoming, roomInstanceId: incoming.instance }) ||
        (incoming.lifecycle !== "DELETED" && incoming.instance === previous.roomInstanceId &&
            incoming.epoch === previous.epoch);
}
