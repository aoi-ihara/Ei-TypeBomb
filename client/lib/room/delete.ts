"use server";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";

export const deleteRoom = async (roomId: string) => {
    const userId = await getUser();
    if (!userId) redirect(process.env.NEXT_PUBLIC_SIGN_IN_URL!);

    const supabase = await createAdminClient();

    const { data, error: selectError } = await supabase
        .from("ei_typebomb_rooms")
        .select("user_id")
        .eq("id", roomId)
        .maybeSingle();

    if (selectError) {
        return selectError.message;
    }

    if (!data) {
        return "Could not find this room.";
    }

    if (data.user_id !== userId) {
        return "You do not have access to this room.";
    }

    const { error } = await supabase
        .from("ei_typebomb_rooms")
        .delete()
        .eq("id", roomId);

    if (error) {
        return error.message;
    }

    return null;
};
