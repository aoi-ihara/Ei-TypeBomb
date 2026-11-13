"use server";
import { revalidateRoomLists } from "./revalidate";

import { createAdminClient } from "@/lib/db/server";
import { getSavedRoomIdsForUser } from "./list-queries";
import { getUser } from "@/lib/auth/session";

export const getSavedRoomIds = async (): Promise<string[]> => {
    const userId = await getUser();
    if (!userId) return [];
    return (await getSavedRoomIdsForUser(userId)) ?? [];
};

export const toggleSavedRoom = async (
    roomId: string,
): Promise<{ saved: boolean; error: string | null }> => {
    const [userId, supabase] = await Promise.all([
        getUser(),
        createAdminClient(),
    ]);
    if (!userId) {
        return { saved: false, error: "ログインが必要です。" };
    }

    const { data, error } = await supabase.rpc(
        "toggle_ei_typebomb_saved_room",
        {
            p_user_id: userId,
            p_room_id: roomId,
        },
    );

    if (error || typeof data !== "boolean") {
        console.error("Failed to toggle saved room:", error);
        return {
            saved: false,
            error: "ルームの保存状態を更新できませんでした。",
        };
    }

    revalidateRoomLists();
    return { saved: data, error: null };
};
