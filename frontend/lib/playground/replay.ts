import { z } from "zod";
import { MEMORY_MODEL_VERSION, type ItemMemoryState } from "./memory";
import { SCHEDULER_VERSION } from "./decision-trace";
import type { SchedulerState } from "./scheduler";

const count = z.number().int().nonnegative();
// Supabase may return RFC 3339 timestamps with a timezone offset (e.g. +00:00).
// Keep the original value for replay while validating its timestamp format.
const stamp = z.string().datetime({ offset: true }).nullable();
const timestamp = z.number().int().nonnegative().nullable();
const id = z.string().min(1).max(128).refine(value => !["__proto__", "constructor", "prototype"].includes(value));
const track = z.object({ attempts: count, correct: count, correctStreak: count, lastAttemptAt: stamp,
    averageResponseMs: z.number().nonnegative().optional(), unknownCount: count.optional(),
    stability: z.number().nonnegative().optional(), lastReviewedAt: stamp.optional() });
export const memorySchema = z.object({ userId: z.string(), roomId: z.string(), itemId: id,
    stability: z.number().nonnegative(), difficulty: z.number(), reviewCount: count,
    lastReviewedAt: stamp, lastPresentedAt: stamp.optional(), createdAt: stamp.optional(), updatedAt: stamp.optional(),
    answerModeStats: z.object({ recognition: track, recall: track }).optional(),
    learningState: z.object({ phase: z.enum(["encoding", "supported_recall", "free_recall", "graduated"]),
        freeRecallSuccesses: count, lastCueRatio: z.number(), relearningSinceLastFreeRecall: z.boolean(), cueSuccessStreak: count }).nullable().optional() });
const retry = z.object({ itemId: id, earliestTurn: count, latestTurn: count,
    reason: z.enum(["failed_recall", "heavy_hint", "uncertain_recall"]), successCount: count });
const selection = z.object({ itemId: id, turn: count, cycle: count, advancesCycle: z.boolean(),
    reason: z.enum(["cycle", "retry", "long_term_due", "suspension_due", "spaced_review", "early_practice"]), retry: retry.optional() });
const schedulerSchema = z.object({ itemIds: z.array(id), cycleQueue: z.array(id), cycle: count,
    completedCycles: count, turn: count, retries: z.record(id, retry),
    struggles: z.record(id, z.object({ consecutiveFailures: count, firstFailureAt: timestamp,
        suspensionLevel: count, suspendedUntil: timestamp })),
    userAnswered: z.record(id, count), botShown: z.record(id, count),
    lastBotItem: id.nullable(), lastUserItem: id.nullable(), current: selection.nullable() });
export const replaySchema = z.object({ schemaVersion: z.literal(1),
    algorithmVersion: z.literal(SCHEDULER_VERSION), memoryVersion: z.literal(MEMORY_MODEL_VERSION),
    now: z.number().int().nonnegative(), rngState: z.number().int().min(0).max(0xffffffff),
    scheduler: schedulerSchema, memories: z.record(id, memorySchema),
    modes: z.record(id, z.enum(["input", "selection"])),
    randomDraws: z.array(z.number().min(0).lt(1)).optional() });
export type ReplaySnapshot = z.infer<typeof replaySchema>;
export function snapshot(scheduler: SchedulerState, memories: Record<string, ItemMemoryState>,
    modes: Record<string, "input" | "selection">, now: number, rngState: number): ReplaySnapshot {
    return replaySchema.parse(JSON.parse(JSON.stringify({ schemaVersion: 1, algorithmVersion: SCHEDULER_VERSION,
        memoryVersion: MEMORY_MODEL_VERSION, scheduler, memories, modes, now, rngState })));
}
/** Explicit allowlist: do not serialize account identity or unknown row fields. */
export function anonymousMemory(memory: ItemMemoryState | undefined, itemId: string) {
    if (!memory) return null;
    return memorySchema.parse({ ...memory, userId: "anonymous", roomId: "local", itemId });
}
export function anonymizeReplay(value: ReplaySnapshot) {
    const clean = replaySchema.parse(value);
    const ids = new Map(clean.scheduler.itemIds.map((id, index) => [id, `item-${index + 1}`]));
    const map = (id: string) => { const mapped = ids.get(id); if (!mapped) throw new Error("Unknown snapshot item"); return mapped; };
    const dict = <T,>(record: Record<string, T>, transform: (entry: T) => T = x => x) =>
        Object.fromEntries(Object.entries(record).map(([id, entry]) => [map(id), transform(entry)]));
    const current = clean.scheduler.current;
    clean.scheduler = { ...clean.scheduler, itemIds: clean.scheduler.itemIds.map(map),
        cycleQueue: clean.scheduler.cycleQueue.map(map),
        retries: dict(clean.scheduler.retries, entry => ({ ...entry, itemId: map(entry.itemId) })),
        struggles: dict(clean.scheduler.struggles), userAnswered: dict(clean.scheduler.userAnswered),
        botShown: dict(clean.scheduler.botShown), lastBotItem: clean.scheduler.lastBotItem ? map(clean.scheduler.lastBotItem) : null,
        lastUserItem: clean.scheduler.lastUserItem ? map(clean.scheduler.lastUserItem) : null,
        current: current ? { ...current, itemId: map(current.itemId),
            ...(current.retry ? { retry: { ...current.retry, itemId: map(current.retry.itemId) } } : {}) } : null };
    clean.memories = Object.fromEntries(Object.entries(clean.memories).filter(([id]) => ids.has(id))
        .map(([id, memory]) => [map(id), anonymousMemory(memory, map(id))!]));
    clean.modes = dict(clean.modes);
    return { replay: clean, map };
}
