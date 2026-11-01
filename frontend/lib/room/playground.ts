"use server";

import { cookies } from "next/headers";
import { importJWK, jwtVerify, type JWK } from "jose";
import isUUID from "validator/es/lib/isUUID";
import type { Room } from "@/type";
import { createAdminClient } from "@/lib/db/server";
import { serverError } from "@/lib/server-console";

const getPlaygroundRoomId = async (): Promise<string | null> => {
    const cookieStore = await cookies();
    const token = cookieStore.get("jwt_token")?.value;
    if (!token) return null;

    try {
        const jwk = JSON.parse(process.env.JWT_PUBLIC_KEY!) as JWK;
        const publicKey = await importJWK(jwk, "ES256");
        const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
            algorithms: ["ES256"],
        });

        if (
            protectedHeader.kid !== process.env.JWT_KEY_ID ||
            typeof payload.id !== "string" ||
            !isUUID(payload.id, 4)
        ) {
            return null;
        }

        return payload.id;
    } catch {
        return null;
    }
};

/**
 * Resolve the current playground route without downloading its word list.
 * Online play loads the canonical room snapshot from its game server.
 */
export const getPlaygroundRoomRoute = async (): Promise<
    Pick<Room, "id" | "link"> | null
> => {
    const roomId = await getPlaygroundRoomId();
    if (!roomId) return null;

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("id, link, item_count")
        .eq("id", roomId)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch playground room route", error, "DB");
        return null;
    }

    if (!data || Number(data.item_count ?? 0) === 0) return null;

    return {
        id: data.id,
        link: data.link ?? data.id,
    };
};

export const getPlaygroundRoom = async (): Promise<Room | null> => {
    const roomId = await getPlaygroundRoomId();
    if (!roomId) return null;

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, user_id, explanation, max_players, bomb_count, created_at, updated_at, items, link, game_duration",
        )
        .eq("id", roomId)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch playground room", error, "DB");
        return null;
    }

    if (!data || !Array.isArray(data.items) || data.items.length === 0) {
        return null;
    }

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
        link: data.link,
    } as Room;
};
