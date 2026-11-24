"use server";

import { createClient } from "@/lib/db/server";
import { getMemoryAuthStatus } from "@/lib/auth/memory-session";
import type { ItemMemoryState } from "@/lib/playground/memory";
import { toMemoryState } from "@/lib/playground/memory";
import { memoryStorageId } from "./memory-storage-id";
import {
    isMemoryItemId, MAX_MEMORY_BATCH, memoryTime, normalizeMemory, UUID,
    type MemoryRejection, type MemorySyncResult,
} from "./memory-sync-format";

const LEGACY_MEMORY_COLUMNS =
    "user_id, room_id, id, stability, difficulty, review_count, last_reviewed_at, created_at, updated_at, learning_state, last_presented_at";

const MEMORY_COLUMNS =
    "user_id, room_id, id, stability, difficulty, review_count, last_reviewed_at, created_at, updated_at, learning_state, last_presented_at, answer_mode_stats";

export const loadPlaygroundMemory = async (roomId: string, itemIds: string[] = []) => {
    const supabase = await createClient();
    const { userId, error: authError } = await getMemoryAuthStatus(supabase);
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

    if (typeof roomId !== "string" || !UUID.test(roomId)) {
        return {
            userId,
            memoryByItem: {} as Record<string, ItemMemoryState>,
            error: { message: "Invalid room ID" },
        };
    }

    const { data, error } = await supabase
        .from("ei_typebomb_item_memory")
        .select(MEMORY_COLUMNS)
        .eq("room_id", roomId)
        .eq("user_id", userId);

    // Older databases may not have the answer-mode column yet. Read existing
    // memory without it, but prevent writes until the migration is applied.
    const missingAnswerModeStats =
        Boolean(error) &&
        /answer_mode_stats/i.test(error!.message) &&
        (/does not exist/i.test(error!.message) ||
            /schema cache/i.test(error!.message));
    const legacyResult = missingAnswerModeStats
        ? await supabase
              .from("ei_typebomb_item_memory")
              .select(LEGACY_MEMORY_COLUMNS)
              .eq("room_id", roomId)
              .eq("user_id", userId)
        : null;
    const readError =
        legacyResult?.error ?? (missingAnswerModeStats ? null : error);
    if (readError) {
        return {
            userId,
            memoryByItem: {} as Record<string, ItemMemoryState>,
            error: { message: readError.message },
            persistenceDisabled: true,
        };
    }

    const itemAliases = new Map(
        (Array.isArray(itemIds) ? itemIds.slice(0, 512) : [])
            .filter(isMemoryItemId)
            .map(id => [memoryStorageId(roomId, id), id]),
    );
    return {
        userId,
        persistenceDisabled: missingAnswerModeStats,
        memoryByItem: Object.fromEntries(
            (legacyResult?.data ?? data ?? []).map((row) => {
                const memory = toMemoryState(row);
                memory.itemId = itemAliases.get(memory.itemId) ?? memory.itemId;
                return [memory.itemId, memory];
            }),
        ) as Record<string, ItemMemoryState>,
        error: null,
    };
};

const syncMemoryBatch = async (
    roomId: string,
    expectedUserId: string,
    memory: unknown[],
): Promise<MemorySyncResult> => {
    if (!Array.isArray(memory) || memory.length > MAX_MEMORY_BATCH ||
        typeof roomId !== "string" || !UUID.test(roomId))
        return { type: "permanent" };
    if (memory.length === 0) return { type: "saved", rejected: [] };

    const supabase = await createClient();
    const { userId, error } = await getMemoryAuthStatus(supabase);
    if (error) return { type: error.retryable ? "temporary" : "auth_required" };
    if (!userId || userId !== expectedUserId) return { type: "auth_required" };

    const rejected: MemoryRejection[] = [];
    const latestAllowed = Date.now() + 5 * 60_000;
    type Entry = {
        index: number;
        row: {
            user_id: string;
            room_id: string;
            id: string;
            stability: number;
            difficulty: number;
            review_count: number;
            last_reviewed_at: string | null;
            updated_at: string;
            learning_state: ItemMemoryState["learningState"];
            last_presented_at: ItemMemoryState["lastPresentedAt"];
            answer_mode_stats: ItemMemoryState["answerModeStats"] | null;
        };
    };
    const rows = new Map<string, Entry>();
    for (const [index, value] of memory.entries()) {
        const parsed = normalizeMemory(value, userId, roomId);
        if ("reason" in parsed) {
            rejected.push({ index, reason: parsed.reason });
            continue;
        }
        const item = parsed.memory;
        const updatedAt = item.updatedAt!;
        if (memoryTime(updatedAt) > latestAllowed) {
            rejected.push({ index, reason: "timestamp" });
            continue;
        }
        const id = memoryStorageId(roomId, item.itemId);
        const previous = rows.get(id);
        if (previous && previous.row.updated_at >= updatedAt) continue;
        rows.set(id, { index, row: {
            user_id: userId,
            room_id: roomId,
            id,
            stability: item.stability,
            difficulty: item.difficulty,
            review_count: item.reviewCount,
            last_reviewed_at: item.lastReviewedAt,
            updated_at: updatedAt,
            learning_state: item.learningState,
            last_presented_at: item.lastPresentedAt,
            answer_mode_stats: item.answerModeStats ?? null,
        } });
    }

    const write = async (batch: Entry[]):
        Promise<Exclude<MemorySyncResult, { type: "saved" }> | null> => {
        if (batch.length === 0) return null;
        const { error, status } = await supabase
            .from("ei_typebomb_item_memory")
            .upsert(batch.map(({ row }) => row), { onConflict: "user_id,room_id,id" });
        if (!error) return null;
        const code = error.code ?? "";
        const databaseCode = /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code) ? code : undefined;
        if (status === 401 || code === "PGRST301")
            return { type: "auth_required", databaseCode };
        // FK failures apply to the entire batch (one user and one room).
        // Data and check errors may be specific to a single row.
        if (/^(22|23514)/.test(code)) {
            if (batch.length === 1) {
                rejected.push({ index: batch[0].index, reason: "database_error" });
                return null;
            }
            const middle = Math.floor(batch.length / 2);
            return await write(batch.slice(0, middle)) ?? await write(batch.slice(middle));
        }
        const retryable = status === 0 || status === 408 || status === 429 ||
            status >= 500 || /^(08|40|53|55P03|57P0)/.test(code);
        return { type: retryable ? "temporary" : "permanent", databaseCode };
    };
    return await write([...rows.values()]) ?? { type: "saved", rejected };
};

export async function syncPlaygroundMemory(
    roomId: string,
    expectedUserId: string,
    memory: unknown[],
): Promise<MemorySyncResult> {
    const start = performance.now();
    const result = await syncMemoryBatch(roomId, expectedUserId, memory);
    return { ...result, serverDurationMs: Math.round(performance.now() - start) };
}
