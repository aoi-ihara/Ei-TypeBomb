"use server";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import type { Room } from "@/type";
import isUUID from "validator/es/lib/isUUID";
import { redirect } from "next/navigation";
import { serverError, serverLog } from "../server-console";

export const getRoomFromLink = async (link: string) => {
    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("link", link)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch room from link", error, "DB");
        return null;
    }
    if (!data) return null;
    return (data.id as string) ?? null;
};

export const getRoomStatusFromId = async (id: string) => {
    if (!isUUID(id, 4)) return null;

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch room status", error, "DB");
        return null;
    }
    if (!data) return null;

    return Boolean(data.password);
};

export const getRoomFromId = async (id: string) => {
    const userId = await getUser();
    if (!userId) redirect(process.env.NEXT_PUBLIC_SIGN_IN_URL!);

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch room", error, "DB");
        return null;
    }

    if (!data || data.user_id !== userId) {
        serverError("room access denied", undefined, "AUTH");
        return null;
    }

    serverLog("DB", "room fetched");
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
        link: data.link,
    } as Room;
};

export const getMyRooms = async () => {
    const userId = await getUser();
    if (!userId) redirect(process.env.NEXT_PUBLIC_SIGN_IN_URL!);

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("user_id", userId);

    if (error) {
        serverError("failed to fetch user's rooms", error, "DB");
        return;
    }

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
        link: room.link,
    }));

    serverLog("DB", "rooms fetched", { count: rooms.length });
    return { userId: userId, rooms: rooms };
};
