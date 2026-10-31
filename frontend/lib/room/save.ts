"use server";

import { createClient } from "@/lib/db/server";
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
    const userId = await getUser();
    if (!userId) {
        return { saved: false, error: "ログインが必要です。" };
    }

    const supabase = await createClient();
    const { data: existing, error: lookupError } = await supabase
        .from("ei_typebomb_saved_rooms")
        .select("room_id")
        .eq("user_id", userId)
        .eq("room_id", roomId)
        .maybeSingle();

    if (lookupError) {
        console.error("Failed to check saved room:", lookupError);
        return { saved: false, error: "保存状態を確認できませんでした。" };
    }

    if (existing) {
        const { error } = await supabase
            .from("ei_typebomb_saved_rooms")
            .delete()
            .eq("user_id", userId)
            .eq("room_id", roomId);

        if (error) {
            console.error("Failed to unsave room:", error);
            return { saved: true, error: "保存を解除できませんでした。" };
        }

        return { saved: false, error: null };
    }

    const { error } = await supabase
        .from("ei_typebomb_saved_rooms")
        .insert({ user_id: userId, room_id: roomId });

    if (error) {
        console.error("Failed to save room:", error);
        return { saved: false, error: "ルームを保存できませんでした。" };
    }

    return { saved: true, error: null };
};
