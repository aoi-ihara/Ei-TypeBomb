"use server";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";
import type { Room } from "@/type";

export const updateRoomFromId = async (room: Room) => {
    const userId = await getUser();
    if (!userId) redirect("/sign-in");

    const supabase = await createAdminClient();

    const { data, error: selectError } = await supabase
        .from("ei_typebomb_rooms")
        .select("user_id")
        .eq("id", room.id)
        .maybeSingle();

    if (selectError) {
        console.error(selectError.message);
        return;
    }

    if (!data) {
        console.error("Counld not find this room.");
        return;
    }

    if (data.user_id !== userId) {
        console.error("You do not have access to this room.");
        return;
    }

    const { error: updateError } = await supabase
        .from("ei_typebomb_rooms")
        .update({
            id: room.id,
            ...(room.title !== undefined && {
                title: room.title,
            }),
            ...(room.explanation !== undefined && {
                explanation: room.explanation,
            }),
            ...(room.maxPlayers !== undefined && {
                max_players: room.maxPlayers,
            }),
            ...(room.words !== undefined && {
                words: room.words,
            }),
            ...(room.userId !== undefined && {
                user_id: room.userId,
            }),
            ...(room.password !== undefined && {
                password: room.password,
            }),
            updated_at: Date.now(),
        })
        .eq("id", room.id);

    if (updateError) {
        console.error(updateError.message);
    }
};
