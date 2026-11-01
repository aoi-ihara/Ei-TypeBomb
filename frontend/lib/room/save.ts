"use server";

import { createAdminClient, createClient } from "@/lib/db/server";
import { getUser } from "@/lib/auth/session";

export const getSavedRoomIds = async (): Promise<string[]> => {
    const userId = await getUser();
    if (!userId) return [];

    const supabase = await createClient();
    const { data, error } = await supabase
        .from("ei_typebomb_saved_rooms")
        .select("room_id")
        .eq("user_id", userId);

    if (error) {
        console.error("Failed to load saved rooms:", error);
        return [];
    }

    return data.map((row) => row.room_id);
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

    return { saved: data, error: null };
};
