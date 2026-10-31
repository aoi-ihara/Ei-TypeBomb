"use server";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { isRoomAuthorized } from "./auth";
import type { Room } from "@/type";
import isUUID from "validator/es/lib/isUUID";
import { redirect } from "next/navigation";
import { serverError, serverLog } from "../server-console";

export const getRoomFromLink = async (link: string) => {
    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("id")
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
        .select("id, password")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch room status", error, "DB");
        return null;
    }
    if (!data) return null;

    return Boolean(data.password);
};

export const getPublicRooms = async (): Promise<Room[]> => {
    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, explanation, max_players, bomb_count, created_at, updated_at, items, game_duration, is_public",
        )
        .eq("is_public", true)
        .order("updated_at", { ascending: false });

    if (error) {
        serverError("failed to fetch public rooms", error, "DB");
        return [];
    }

    return data.map((room) => ({
        id: room.id,
        title: room.title,
        explanation: room.explanation,
        maxPlayers: room.max_players,
        bombCount: room.bomb_count ?? null,
        gameDuration: room.game_duration ?? 20,
        createdAt: room.created_at,
        updatedAt: room.updated_at,
        items: [],
        itemCount: Array.isArray(room.items) ? room.items.length : 0,
        isPublic: room.is_public,
    }));
};

export const getRoomSummaryFromId = async (id: string) => {
    if (!isUUID(id, 4)) return null;

    const supabase = await createAdminClient();
    const [{ data, error }, userId] = await Promise.all([
        supabase
            .from("ei_typebomb_rooms")
            .select(
                "id, title, user_id, explanation, max_players, bomb_count, password, created_at, updated_at, items, game_duration, is_public",
            )
            .eq("id", id)
            .maybeSingle(),
        getUser(),
    ]);

    if (error) {
        serverError("failed to fetch room summary", error, "DB");
        return null;
    }
    if (!data) return null;

    const isOwner = data.user_id === userId;
    const authorized =
        isOwner || !data.password || (await isRoomAuthorized(id));
    if (!authorized) return null;

    const room: Room = {
        id: data.id,
        title: data.title,
        explanation: data.explanation,
        maxPlayers: data.max_players,
        bombCount: data.bomb_count ?? null,
        gameDuration: data.game_duration ?? 20,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        items: [],
        itemCount: Array.isArray(data.items) ? data.items.length : 0,
        isPublic: data.is_public,
    };

    return {
        room,
        itemCount: Array.isArray(data.items) ? data.items.length : 0,
        isOwner,
    };
};

export const getRoomPlayInfoFromId = async (id: string) => {
    if (!isUUID(id, 4)) return null;

    const supabase = await createAdminClient();
    const [{ data, error }, userId] = await Promise.all([
        supabase
            .from("ei_typebomb_rooms")
            .select("id, title, user_id, password, explanation, is_public, items")
            .eq("id", id)
            .maybeSingle(),
        getUser(),
    ]);

    if (error) {
        serverError("failed to fetch room play info", error, "DB");
        return null;
    }
    if (!data) {
        return {
            exists: false,
            requiresPassword: false,
            authorized: false,
        };
    }

    const requiresPassword = Boolean(data.password);
    const isOwner = data.user_id === userId;
    const authorized =
        isOwner || !requiresPassword || (await isRoomAuthorized(id));
    const canViewDetails = !requiresPassword || authorized;

    return {
        exists: true,
        requiresPassword,
        authorized,
        title: canViewDetails ? data.title : undefined,
        explanation: canViewDetails ? data.explanation : undefined,
        isPublic: data.is_public,
        itemCount: canViewDetails
            ? Array.isArray(data.items)
                ? data.items.length
                : 0
            : 0,
    };
};

export const getRoomMetadataFromId = async (id: string) => {
    if (!isUUID(id, 4)) return null;

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("title, explanation, is_public, password")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch room metadata", error, "DB");
        return null;
    }
    if (!data) return null;

    return {
        title: data.title,
        explanation: data.explanation,
        isPublic: data.is_public,
        hasPassword: Boolean(data.password),
    };
};

export const getRoomFromId = async (id: string) => {
    const supabase = await createAdminClient();

    const [{ data, error }, userId] = await Promise.all([
        supabase
            .from("ei_typebomb_rooms")
            .select(
                "id, title, user_id, explanation, max_players, bomb_count, password, created_at, updated_at, items, link, game_duration, is_public",
            )
            .eq("id", id)
            .maybeSingle(),
        getUser(),
    ]);

    if (!userId) redirect(getSignInUrl());

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
        bombCount: data.bomb_count ?? null,
        gameDuration: data.game_duration ?? 20,
        password: data.password,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        items: data.items,
        itemCount: Array.isArray(data.items) ? data.items.length : 0,
        link: data.link,
        isPublic: data.is_public,
    } as Room;
};

export const getMyRooms = async () => {
    const userId = await getUser();
    if (!userId) redirect(getSignInUrl());

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, items, game_duration, is_public",
        )
        .eq("user_id", userId);

    if (error) {
        serverError("failed to fetch user's rooms", error, "DB");
        return;
    }

    const rooms: Room[] = data.map((room) => ({
        id: room.id,
        title: room.title,
        explanation: room.explanation,
        maxPlayers: room.max_players,
        bombCount: room.bomb_count ?? null,
        gameDuration: room.game_duration ?? 20,
        createdAt: room.created_at,
        updatedAt: room.updated_at,
        items: [],
        itemCount: Array.isArray(room.items) ? room.items.length : 0,
        isPublic: room.is_public,
    }));

    serverLog("DB", "rooms fetched", { count: rooms.length });
    return { userId: userId, rooms: rooms };
};
