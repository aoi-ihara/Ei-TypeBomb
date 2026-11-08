import "server-only";

import { createAdminClient } from "@/lib/db/server";
import { serverError, serverLog } from "@/lib/server-console";
import type { Room } from "@/type";

/**
 * Read-only room-list queries with an explicit, already-verified user ID.
 * Keep these out of "use server" files: accepting an arbitrary user ID through
 * a client-callable server action would bypass the caller's ownership boundary.
 */
export const getOwnedRoomsForUser = async (
    userId: string,
): Promise<Room[] | null> => {
    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, item_count, link, game_duration, visibility",
        )
        .eq("user_id", userId);

    if (error || !data) {
        serverError("failed to fetch user's rooms", error, "DB");
        return null;
    }

    const rooms: Room[] = data.map((room) => ({
        id: room.id,
        title: room.title,
        userId: room.user_id,
        explanation: room.explanation,
        maxPlayers: room.max_players,
        bombCount: room.bomb_count ?? null,
        gameDuration: room.game_duration ?? 20,
        createdAt: room.created_at,
        updatedAt: room.updated_at,
        items: [],
        itemCount: Number(room.item_count ?? 0),
        link: room.link ?? undefined,
        visibility: room.visibility,
    }));

    serverLog("DB", "rooms fetched", { count: rooms.length });
    return rooms;
};

export const getSavedRoomIdsForUser = async (
    userId: string,
): Promise<string[] | null> => {
    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_saved_rooms")
        .select("room_id")
        .eq("user_id", userId);

    if (error || !data) {
        serverError("failed to load saved rooms", error, "DB");
        return null;
    }

    return data.map((row) => row.room_id);
};
