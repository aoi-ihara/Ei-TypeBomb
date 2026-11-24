import { parseAnswerModeStats, type ItemMemoryState } from "./memory";

export const MAX_MEMORY_BATCH = 500;
// Leave room under Next's action body limit, including serialization overhead.
export const MEMORY_BATCH_SIZE = 100;
export const MEMORY_SYNC_INTERVAL_MS = 30_000;
export const UUID = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

// Room items predate the UUID-only memory table. These IDs are kept verbatim
// in the room and mapped to UUIDs at the database boundary.
export const isMemoryItemId = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value) &&
    !/^legacy-wire-\d+$/.test(value); // Position-based transport placeholders lack a stable identity.

export type MemoryIssue =
    | "shape" | "owner" | "room_id" | "item_id" | "stability"
    | "difficulty" | "review_count" | "timestamp" | "answer_mode_stats" | "learning_state";

export type MemoryRejection = { index: number; reason: MemoryIssue | "database_error" };
export type MemorySyncResult = (
    | { type: "saved"; rejected: MemoryRejection[] }
    | { type: "auth_required" | "temporary" | "permanent"; databaseCode?: string }
) & { serverDurationMs?: number };

export const memoryTime = (value: string | null | undefined): number =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;

export function normalizeMemory(
    value: unknown,
    userId: string,
    roomId: string,
    legacy = false,
): { memory: ItemMemoryState } | { reason: MemoryIssue } {
    if (!value || typeof value !== "object") return { reason: "shape" };
    const item = value as ItemMemoryState;
    if (item.userId !== userId) return { reason: "owner" };
    if (!UUID.test(roomId) || item.roomId !== roomId) return { reason: "room_id" };
    if (!isMemoryItemId(item.itemId)) return { reason: "item_id" };
    if (!Number.isFinite(item.stability) || item.stability <= 0)
        return { reason: "stability" };
    if (!Number.isFinite(item.difficulty) || item.difficulty < 1 || item.difficulty > 10)
        return { reason: "difficulty" };
    if (!Number.isInteger(item.reviewCount) || item.reviewCount < 0 || item.reviewCount > 2_147_483_647)
        return { reason: "review_count" };

    let updatedAt = item.updatedAt;
    if (legacy && updatedAt == null) {
        const timestamps = [
            item.lastPresentedAt, item.lastReviewedAt, item.answerModeStats?.recognition?.lastAttemptAt,
            item.answerModeStats?.recall?.lastAttemptAt, item.createdAt,
        ].map(memoryTime).filter(Number.isFinite);
        if (timestamps.length) updatedAt = new Date(Math.max(...timestamps)).toISOString();
    }
    if (
        !Number.isFinite(memoryTime(updatedAt)) ||
        [item.lastReviewedAt, item.lastPresentedAt].some(
            timestamp => timestamp != null && !Number.isFinite(memoryTime(timestamp)),
        )
    ) return { reason: "timestamp" };

    const stats = parseAnswerModeStats(item.answerModeStats);
    // SQL NULL represented absent stats in older persisted snapshots.
    if (item.answerModeStats !== undefined && !(legacy && item.answerModeStats === null) && !stats)
        return { reason: "answer_mode_stats" };

    const state = item.learningState;
    if (state != null && (
        !["encoding", "supported_recall", "free_recall", "graduated"].includes(state.phase) ||
        !Number.isSafeInteger(state.freeRecallSuccesses) || state.freeRecallSuccesses < 0 ||
        !Number.isFinite(state.lastCueRatio) || state.lastCueRatio < 0 || state.lastCueRatio > 1 ||
        typeof state.relearningSinceLastFreeRecall !== "boolean" ||
        !Number.isSafeInteger(state.cueSuccessStreak) || state.cueSuccessStreak < 0
    )) return { reason: "learning_state" };

    const canonicalDate = (timestamp: string | null | undefined) =>
        timestamp == null ? null : new Date(memoryTime(timestamp)).toISOString();
    return {
        memory: {
            userId,
            roomId,
            itemId: item.itemId,
            stability: item.stability,
            difficulty: item.difficulty,
            reviewCount: item.reviewCount,
            updatedAt: canonicalDate(updatedAt),
            lastReviewedAt: canonicalDate(item.lastReviewedAt),
            lastPresentedAt: canonicalDate(item.lastPresentedAt),
            learningState: state == null ? null : {
                phase: state.phase,
                freeRecallSuccesses: state.freeRecallSuccesses,
                lastCueRatio: state.lastCueRatio,
                relearningSinceLastFreeRecall: state.relearningSinceLastFreeRecall,
                cueSuccessStreak: state.cueSuccessStreak,
            },
            answerModeStats: stats,
        },
    };
}
