"use server";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { isRoomAuthorized } from "./auth";
import type { Item, Room } from "@/type";
import {
    rankPublicRooms,
    type RoomRecommendationStats,
} from "./recommendation";
import isUUID from "validator/es/lib/isUUID";
import { redirect } from "next/navigation";
import { serverError, serverLog } from "../server-console";

type PublicRoomRecommendationRow = {
    room_id: string;
    play_count: number | string | null;
    recent_play_count: number | string | null;
    save_count: number | string | null;
};

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
        .select("id, visibility")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch room status", error, "DB");
        return null;
    }
    if (!data) return null;

    return data.visibility === "private";
};

export const getPublicRooms = async (): Promise<Room[]> => {
    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, explanation, max_players, bomb_count, created_at, updated_at, items, game_duration, visibility",
        )
        .eq("visibility", "public")
        .order("updated_at", { ascending: false });

    if (error) {
        serverError("failed to fetch public rooms", error, "DB");
        return [];
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
        visibility: room.visibility,
    }));

    if (rooms.length === 0) return rooms;

    const { data: recommendationRows, error: recommendationError } =
        await supabase.rpc(
            "get_ei_typebomb_public_room_recommendation_stats",
            { p_room_ids: rooms.map((room) => room.id) },
        );

    if (recommendationError) {
        // Keep the room list usable before the recommendation migration is applied.
        serverError(
            "failed to fetch public room recommendation stats",
            recommendationError,
            "DB",
        );
    }

    const statsByRoomId = new Map<string, RoomRecommendationStats>(
        (recommendationRows ?? []).map(
            (row: PublicRoomRecommendationRow) =>
                [
                    row.room_id,
                    {
                        playCount: Number(row.play_count ?? 0),
                        recentPlayCount: Number(row.recent_play_count ?? 0),
                        saveCount: Number(row.save_count ?? 0),
                    },
                ] as const,
        ),
    );

    return rankPublicRooms(rooms, statsByRoomId);
};

export const getRoomSummaryFromId = async (id: string) => {
    if (!isUUID(id, 4)) return null;

    const supabase = await createAdminClient();
    const [{ data, error }, userId] = await Promise.all([
        supabase
            .from("ei_typebomb_rooms")
            .select(
                "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, items, game_duration, visibility",
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
        isOwner ||
        data.visibility !== "private" ||
        (await isRoomAuthorized(id));
    if (!authorized) return null;

    const items = Array.isArray(data.items) ? (data.items as Item[]) : [];

    const room: Room = {
        id: data.id,
        title: data.title,
        explanation: data.explanation,
        maxPlayers: data.max_players,
        bombCount: data.bomb_count ?? null,
        gameDuration: data.game_duration ?? 20,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        items,
        itemCount: items.length,
        visibility: data.visibility,
    };

    return {
        room,
        itemCount: items.length,
        isOwner,
    };
};

export const getRoomPlayInfoFromId = async (id: string) => {
    if (!isUUID(id, 4)) return null;

    const supabase = await createAdminClient();
    const [{ data, error }, userId] = await Promise.all([
        supabase
            .from("ei_typebomb_rooms")
            .select("id, title, user_id, explanation, visibility, items")
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

    const requiresPassword = data.visibility === "private";
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
        visibility: data.visibility,
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
        .select("title, explanation, visibility")
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
        visibility: data.visibility,
    };
};

export const getRoomFromId = async (id: string) => {
    const supabase = await createAdminClient();

    const [{ data, error }, userId] = await Promise.all([
        supabase
            .from("ei_typebomb_rooms")
            .select(
                "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, items, link, game_duration, visibility",
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
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        items: data.items,
        itemCount: Array.isArray(data.items) ? data.items.length : 0,
        link: data.link,
        visibility: data.visibility,
    } as Room;
};

export const getMyRooms = async () => {
    const userId = await getUser();
    if (!userId) redirect(getSignInUrl());

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, items, game_duration, visibility",
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
        visibility: room.visibility,
    }));

    serverLog("DB", "rooms fetched", { count: rooms.length });
    return { userId: userId, rooms: rooms };
};
