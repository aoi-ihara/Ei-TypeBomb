"use server";

import { getUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/db/server";
import isUUID from "validator/es/lib/isUUID";

export type RoomPlayMode = "online" | "offline";

/**
 * Record a successful entry into a public room.
 * Private and unlisted rooms are intentionally excluded from recommendation data.
 */
export const recordRoomPlay = async (
    roomId: string,
    playMode: RoomPlayMode,
): Promise<void> => {
    if (
        !isUUID(roomId, 4) ||
        (playMode !== "online" && playMode !== "offline")
    ) {
        return;
    }

    try {
        const [userId, supabase] = await Promise.all([
            getUser(),
            createAdminClient(),
        ]);

        const { data: room, error: roomError } = await supabase
            .from("ei_typebomb_rooms")
            .select("visibility")
            .eq("id", roomId)
            .maybeSingle();

        if (roomError) {
            console.error(
                "Failed to check room visibility for play event:",
                roomError,
            );
            return;
        }

        if (room?.visibility !== "public") return;

        const { error } = await supabase
            .from("ei_typebomb_room_play_events")
            .insert({
                room_id: roomId,
                user_id: userId,
                play_mode: playMode,
            });

        if (error) {
            console.error("Failed to record room play:", error);
        }
    } catch (error) {
        // Analytics must never prevent a player from entering a room.
        console.error("Failed to record room play:", error);
    }
};
