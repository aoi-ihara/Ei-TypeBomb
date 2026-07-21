"use server";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import type { Room } from "@/type";
import { redirect } from "next/navigation";

export const getRoomFromId = async (id: string) => {
    const userId = await getUser();
    if (!userId) redirect("/sign-in");

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        console.error(error);
        return null;
    }

    if (data.user_id !== userId) {
        console.error(
            "You do not have access to this room.",
            `${data.user_id} != ${userId}`,
        );
        return null;
    }

    console.log("Success!!");
    return {
        id: data.id,
        title: data.title,
        userId: data.user_id,
        explanation: data.explanation,
        maxPlayers: data.max_players,
        password: data.password,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        words: data.words,
    } as Room;
};

export const getMyRooms = async () => {
    const userId = await getUser();
    if (!userId) redirect("/sign-in");

    console.log("User ID", userId);

    const supabase = await createAdminClient();

    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("user_id", userId);

    if (error) return;

    const rooms: Room[] = data.map((room) => ({
        id: room.id,
        title: room.title,
        userId: room.user_id,
        explanation: room.explanation,
        maxPlayers: room.max_players,
        password: room.password,
        createdAt: room.created_at,
        updatedAt: room.updated_at,
        words: room.words,
    }));

    console.log(rooms);

    return { userId: userId, rooms: rooms };
};
