"use server";

import { createClient } from "@/lib/db/server";
import { getMemoryAuthStatus } from "@/lib/auth/session";
import type { ItemMemoryState } from "@/lib/playground/memory";
import { toMemoryState } from "@/lib/playground/memory";

const MEMORY_COLUMNS =
    "user_id, room_id, id, stability, difficulty, review_count, last_reviewed_at, created_at, updated_at, learning_state, last_presented_at";

export const loadPlaygroundMemory = async (roomId: string) => {
    const { userId, error: authError } = await getMemoryAuthStatus();
    if (authError) {
        return {
            userId: null,
            memoryByItem: {} as Record<string, ItemMemoryState>,
            error: authError,
        };
    }
    if (!userId) {
        return {
            userId: null,
            memoryByItem: {} as Record<string, ItemMemoryState>,
            error: null,
        };
    }

    if (!/^[a-f0-9-]{36}$/i.test(roomId)) {
        return {
            userId,
            memoryByItem: {} as Record<string, ItemMemoryState>,
            error: { message: "Invalid room ID" },
        };
    }

    const supabase = await createClient();
    const { data, error } = await supabase
        .from("ei_typebomb_item_memory")
        .select(MEMORY_COLUMNS)
        .eq("room_id", roomId)
        .eq("user_id", userId);

    if (error) {
        return {
            userId,
            memoryByItem: {} as Record<string, ItemMemoryState>,
            error: { message: error.message },
        };
    }

    return {
        userId,
        memoryByItem: Object.fromEntries(
            (data ?? []).map((row) => {
                const memory = toMemoryState(row);
                return [memory.itemId, memory];
            }),
        ) as Record<string, ItemMemoryState>,
        error: null,
    };
};

export const syncPlaygroundMemory = async (memory: ItemMemoryState[]) => {
    if (memory.length === 0) return null;
    if (memory.length > 500) return { message: "Too many memory updates" };

    const { userId, error: authError } = await getMemoryAuthStatus();
    if (authError) return authError;
    if (!userId) return { message: "Authentication required" };

    if (
        memory.some((item) =>
            item.userId !== userId ||
            !/^[a-f0-9-]{36}$/i.test(item.roomId) ||
            !/^[a-f0-9-]{36}$/i.test(item.itemId) ||
            !Number.isFinite(item.stability) ||
            item.stability <= 0 ||
            !Number.isFinite(item.difficulty) ||
            item.difficulty < 1 ||
            item.difficulty > 10 ||
            !Number.isSafeInteger(item.reviewCount) ||
            item.reviewCount < 0
        )
    ) {
        return { message: "Invalid memory update" };
    }

    const supabase = await createClient();
    const rows = memory.map((item) => ({
        user_id: userId,
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
        .upsert(rows, { onConflict: "user_id,room_id,id" });
    return error ? { message: error.message } : null;
};
