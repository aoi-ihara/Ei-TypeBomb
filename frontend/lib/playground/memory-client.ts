"use client";

import { createClient } from "@/lib/db/client";
import type { ItemMemoryState } from "@/lib/playground/memory";
import { toMemoryState } from "@/lib/playground/memory";

const MEMORY_COLUMNS =
    "user_id, room_id, id, stability, difficulty, review_count, last_reviewed_at, created_at, updated_at, learning_state, last_presented_at";

export const loadPlaygroundMemory = async (roomId: string) => {
    const supabase = createClient();
    const {
        data: { user },
        error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
        return {
            userId: null,
            memoryByItem: {} as Record<string, ItemMemoryState>,
            error: userError ?? new Error("No authenticated user"),
        };
    }

    const { data, error } = await supabase
        .from("ei_typebomb_item_memory")
        .select(MEMORY_COLUMNS)
        .eq("room_id", roomId);

    if (error) {
        return {
            userId: user.id,
            memoryByItem: {} as Record<string, ItemMemoryState>,
            error,
        };
    }

    const memoryByItem = Object.fromEntries(
        (data ?? []).map((row) => {
            const memory = toMemoryState(row);
            return [memory.itemId, memory];
        }),
    );

    return {
        userId: user.id,
        memoryByItem,
        error: null,
    };
};

export const syncPlaygroundMemory = async (memory: ItemMemoryState[]) => {
    if (memory.length === 0) return null;

    const supabase = createClient();
    const rows = memory.map((item) => ({
        user_id: item.userId,
        room_id: item.roomId,
        id: item.itemId,
        stability: item.stability,
        difficulty: item.difficulty,
        review_count: item.reviewCount,
        last_reviewed_at: item.lastReviewedAt,
        updated_at: item.updatedAt ?? new Date().toISOString(),
        learning_state: item.learningState ?? null,
        last_presented_at: item.lastPresentedAt ?? null,
    }));

    const { error } = await supabase
        .from("ei_typebomb_item_memory")
        .upsert(rows, {
            onConflict: "user_id,room_id,id",
        });

    return error;
};
