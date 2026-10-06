"use server";

import { jwtVerify } from "jose";
import { cookies } from "next/headers";
import isUUID from "validator/es/lib/isUUID";
import type { Item, Room } from "@/type";
import { createAdminClient } from "@/lib/db/server";
import { serverError } from "@/lib/server-console";

const isItem = (value: unknown): value is Item => {
    if (!value || typeof value !== "object") return false;

    const item = value as Record<string, unknown>;
    return (
        typeof item.id === "string" &&
        item.type === "typed_recall" &&
        typeof item.prompt === "string" &&
        typeof item.answer === "string"
    );
};

export const getPlaygroundRoom = async (): Promise<Room | null> => {
    const token = (await cookies()).get("jwt_token")?.value;
    if (!token) return null;

    let roomId: string;

    try {
        const secret = new TextEncoder().encode(process.env.JWT_SECRET!);
        const { payload } = await jwtVerify(token, secret, {
            algorithms: ["HS256"],
        });

        if (typeof payload.id !== "string" || !isUUID(payload.id, 4)) {
            return null;
        }

        roomId = payload.id;
    } catch {
        return null;
    }

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select(
            "id, title, user_id, explanation, max_players, created_at, updated_at, items, link, game_duration",
        )
        .eq("id", roomId)
        .maybeSingle();

    if (error) {
        serverError("failed to fetch playground room", error, "DB");
        return null;
    }

    if (!data) return null;

    const items = Array.isArray(data.items)
        ? data.items.filter(isItem)
        : [];

    return {
        id: data.id,
        title: data.title,
        userId: data.user_id,
        explanation: data.explanation,
        maxPlayers: data.max_players,
        gameDuration: data.game_duration ?? 20,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        items,
        link: data.link,
    };
};
