import { supabaseAdmin } from "./db";
import type { Room } from "../type";

export const getRoomFromId = async (id: string) => {
    const { data, error } = await supabaseAdmin
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        console.error(error.message);
        return;
    }
    if (!data) {
        return;
    }

    return {
        id: data.id,
    } as Room;
};
