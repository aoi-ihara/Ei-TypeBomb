"use server";

import { cache } from "react";
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

type PublicRoomRpcRow = {
    id: string;
    title: string | null;
    explanation: string | null;
    max_players: number | null;
    bomb_count: number | null;
    created_at: string | null;
    updated_at: string | null;
    link: string | null;
    game_duration: number | null;
    item_count: number | null;
    play_count: number | string | null;
    recent_play_count: number | string | null;
    save_count: number | string | null;
};

export const getRoomRouteFromLink = async (link: string) => {
    if (!link) return null;

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("id, link")
        .eq("link", link)
        .maybeSingle();

    if (error) {
        serverError("failed to resolve room route from link", error, "DB");
        return null;
    }
    if (data) {
        return {
            id: data.id as string,
            link: (data.link as string | null) ?? data.id,
        };
    }

    // Keep previously shared /<ROOM ID> URLs working during the migration.
    if (!isUUID(link, 4)) return null;

    const { data: legacyRoom, error: legacyError } = await supabase
        .from("ei_typebomb_rooms")
        .select("id, link")
        .eq("id", link)
        .maybeSingle();

    if (legacyError) {
        serverError("failed to resolve legacy room URL", legacyError, "DB");
        return null;
    }
    if (!legacyRoom) return null;

    return {
        id: legacyRoom.id as string,
        link: (legacyRoom.link as string | null) ?? legacyRoom.id,
    };
};

const ROOM_PAGE_COLUMNS =
    "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, items, link, game_duration, visibility";

// React cache shares this result between generateMetadata and the page render.
const getCachedRoomPageDataFromLink = cache(async (link: string) => {
    if (!link) return null;

    const supabase = await createAdminClient();
    const [{ data: roomData, error }, userId] = await Promise.all([
        supabase
            .from("ei_typebomb_rooms")
            .select(ROOM_PAGE_COLUMNS)
            .eq("link", link)
            .maybeSingle(),
        getUser(),
    ]);

    if (error) {
        serverError("failed to fetch room page data", error, "DB");
        return null;
    }

    let data = roomData;
    if (!data && isUUID(link, 4)) {
        const { data: legacyRoom, error: legacyError } = await supabase
            .from("ei_typebomb_rooms")
            .select(ROOM_PAGE_COLUMNS)
            .eq("id", link)
            .maybeSingle();

        if (legacyError) {
            serverError("failed to fetch legacy room page data", legacyError, "DB");
            return null;
        }
        data = legacyRoom;
    }

    if (!data) return null;

    const isOwner = data.user_id === userId;
    const requiresPassword = data.visibility === "private";
    const authorized =
        isOwner || !requiresPassword || (await isRoomAuthorized(data.id));
    const canViewDetails = !requiresPassword || authorized;
    const items = Array.isArray(data.items) ? (data.items as Item[]) : [];

    const room: Room | null = canViewDetails
        ? {
              id: data.id,
              title: data.title,
              userId: data.user_id,
              explanation: data.explanation,
              maxPlayers: data.max_players,
              bombCount: data.bomb_count ?? null,
              gameDuration: data.game_duration ?? 20,
              createdAt: data.created_at,
              updatedAt: data.updated_at,
              items,
              itemCount: items.length,
              link: data.link ?? undefined,
              visibility: data.visibility,
          }
        : null;

    return {
        id: data.id,
        link: data.link ?? data.id,
        title: canViewDetails ? data.title : undefined,
        visibility: data.visibility,
        requiresPassword,
        authorized,
        isOwner,
        room,
        itemCount: canViewDetails ? items.length : 0,
    };
});

export const getRoomPageDataFromLink = async (link: string) =>
    getCachedRoomPageDataFromLink(link);

export const getRoomMetadataFromLink = async (link: string) => {
    const result = await getCachedRoomPageDataFromLink(link);
    if (!result) return null;

    return {
        // Private room details are never exposed through page or social metadata.
        title: result.title ?? null,
        explanation: result.room?.explanation ?? null,
        visibility: result.visibility,
    };
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
    const { data, error } = await supabase.rpc("get_ei_typebomb_public_rooms");

    if (error) {
        serverError("failed to fetch public rooms", error, "DB");
        return [];
    }

    const rows = Array.isArray(data)
        ? (data as unknown as PublicRoomRpcRow[])
        : [];
    const rooms: Room[] = rows.map((row) => ({
        id: row.id,
        title: row.title ?? undefined,
        explanation: row.explanation ?? undefined,
        maxPlayers: row.max_players ?? 2,
        bombCount: row.bomb_count ?? null,
        gameDuration: row.game_duration ?? 20,
        createdAt: row.created_at ?? undefined,
        updatedAt: row.updated_at ?? undefined,
        items: [],
        itemCount: Number(row.item_count ?? 0),
        link: row.link ?? undefined,
        visibility: "public",
    }));

    const statsByRoomId = new Map<string, RoomRecommendationStats>(
        rows.map((row) => [
            row.id,
            {
                playCount: Number(row.play_count ?? 0),
                recentPlayCount: Number(row.recent_play_count ?? 0),
                saveCount: Number(row.save_count ?? 0),
            },
        ]),
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
                "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, items, link, game_duration, visibility",
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
        link: data.link,
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
            .select("id, title, user_id, explanation, visibility, items, link")
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
        link: data.link,
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
    const [{ data, error }, userId] = await Promise.all([
        supabase
            .from("ei_typebomb_rooms")
            .select("title, explanation, visibility, user_id")
            .eq("id", id)
            .maybeSingle(),
        getUser(),
    ]);

    if (error) {
        serverError("failed to fetch room metadata", error, "DB");
        return null;
    }
    if (!data) return null;

    const isOwner = data.user_id === userId;
    const canViewDetails =
        data.visibility !== "private" ||
        isOwner ||
        (await isRoomAuthorized(id));

    return {
        // Never send private room details to an unauthenticated browser,
        // including through Next.js-generated page and social metadata.
        title: canViewDetails ? data.title : null,
        explanation: canViewDetails ? data.explanation : null,
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
    if (!userId) return null;

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, item_count, link, game_duration, visibility",
        )
        .eq("user_id", userId);

    if (error) {
        serverError("failed to fetch user's rooms", error, "DB");
        return null;
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
        itemCount: Number(room.item_count ?? 0),
        link: room.link ?? undefined,
        visibility: room.visibility,
    }));

    serverLog("DB", "rooms fetched", { count: rooms.length });
    return { userId, rooms };
};
