"use server";

import { after } from "next/server";
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

    after(async () => {
        try {
            const [userId, supabase] = await Promise.all([
                getUser(),
                createAdminClient(),
            ]);

            const { error } = await supabase.rpc(
                "record_ei_typebomb_room_play",
                {
                    p_room_id: roomId,
                    p_user_id: userId,
                    p_play_mode: playMode,
                },
            );

            if (error) {
                console.error("Failed to record room play:", error);
            }
        } catch (error) {
            // Analytics must never prevent a player from entering a room.
            console.error("Failed to record room play:", error);
        }
    });
};
