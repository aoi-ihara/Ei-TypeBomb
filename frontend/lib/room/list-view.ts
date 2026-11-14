import type { Room, View } from "@/type";

type RoomListViewInput = {
    view: View;
    publicRooms: Room[];
    myRooms: Room[];
    savedRoomIds: readonly string[];
    currentUserId: string | null;
};

/**
 * Shared selection/ordering rules for the website and MCP.
 * Only public rooms and rooms owned by the authenticated user may enter this
 * list. A saved ID alone never grants access to a private room.
 */
export const selectRoomsForView = ({
    view,
    publicRooms,
    myRooms,
    savedRoomIds,
    currentUserId,
}: RoomListViewInput): Room[] => {
    if (view === "latest") {
        return publicRooms
            .filter((room) => room.visibility === "public")
            .sort((a, b) =>
                new Date(b.createdAt ?? 0).getTime() -
                new Date(a.createdAt ?? 0).getTime(),
            );
    }

    if (view === "mine") {
        return [...myRooms].sort(
            (a, b) =>
                new Date(b.updatedAt ?? 0).getTime() -
                new Date(a.updatedAt ?? 0).getTime(),
        );
    }

    const roomsById = new Map<string, Room>();
    for (const room of publicRooms) {
        if (room.visibility === "public") roomsById.set(room.id, room);
    }
    for (const room of myRooms) {
        roomsById.set(room.id, {
            ...room,
            userId: room.userId ?? currentUserId ?? undefined,
        });
    }

    const rooms = [...roomsById.values()];
    if (view === "saved") {
        const ids = new Set(savedRoomIds);
        return rooms.filter((room) => ids.has(room.id));
    }
    return rooms.filter((room) => room.visibility === "public");
};
