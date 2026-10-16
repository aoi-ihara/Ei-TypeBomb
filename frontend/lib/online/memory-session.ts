import {
    applyRecallObservation,
    evaluateRecall,
    type ItemMemoryState,
    type RecallObservation,
} from "../playground/memory";
import {
    chooseNextUserItem,
    createScheduler,
    recordUserAnswer,
    type SchedulerState,
} from "../playground/scheduler";

export type OnlineMemorySession = {
    roomId: string;
    userId: string | null;
    memory: Record<string, ItemMemoryState>;
    scheduler: SchedulerState;
    pending: Map<string, ItemMemoryState>;
};

// Guest online play intentionally shares the exact same per-room storage as Playground.
const guestKey = (roomId: string) => `playground-memory:guest:${roomId}`;
const guestUserId = "playground-guest";
const pendingKey = (userId: string, roomId: string) =>
    `playground-pending:${userId}:${roomId}`;

// Recover unsent rows from either learning mode after navigation or reload.
export const loadOnlinePendingMemory = (
    roomId: string,
    userId: string,
    itemIds: string[],
): ItemMemoryState[] => {
    try {
        const data: unknown = JSON.parse(
            localStorage.getItem(pendingKey(userId, roomId)) ?? "[]",
        );
        if (!Array.isArray(data)) return [];
        const allowed = new Set(itemIds);
        return data.filter(
            (value): value is ItemMemoryState =>
                !!value &&
                typeof value === "object" &&
                value.userId === userId &&
                value.roomId === roomId &&
                allowed.has(value.itemId) &&
                Number.isFinite(value.stability) &&
                Number.isFinite(value.difficulty) &&
                Number.isInteger(value.reviewCount),
        );
    } catch {
        return [];
    }
};

export const cacheOnlinePendingMemory = (session: OnlineMemorySession) => {
    if (!session.userId) return;
    try {
        localStorage.setItem(
            pendingKey(session.userId, session.roomId),
            JSON.stringify([...session.pending.values()]),
        );
    } catch {
        // Supabase sync can still work when local storage is unavailable.
    }
};

export const loadOnlineGuestMemory = (
    roomId: string,
    itemIds: string[],
): Record<string, ItemMemoryState> => {
    try {
        const data: unknown = JSON.parse(
            localStorage.getItem(guestKey(roomId)) ?? "{}",
        );
        if (!data || typeof data !== "object" || Array.isArray(data)) return {};
        const allowed = new Set(itemIds);
        return Object.fromEntries(
            Object.entries(data).filter(([id, value]) => {
                if (!allowed.has(id) || !value || typeof value !== "object")
                    return false;
                const memory = value as Partial<ItemMemoryState>;
                return (
                    memory.itemId === id &&
                    memory.roomId === roomId &&
                    memory.userId === guestUserId &&
                    typeof memory.stability === "number" &&
                    typeof memory.difficulty === "number" &&
                    typeof memory.reviewCount === "number"
                );
            }),
        ) as Record<string, ItemMemoryState>;
    } catch {
        return {};
    }
};

export const saveOnlineGuestMemory = (session: OnlineMemorySession) => {
    if (session.userId !== null) return;
    try {
        const existing = loadOnlineGuestMemory(
            session.roomId,
            session.scheduler.itemIds,
        );
        const next = { ...existing };
        for (const [id, memory] of Object.entries(session.memory)) {
            const previous = next[id];
            if (
                !previous ||
                (Date.parse(memory.updatedAt ?? "") || 0) >=
                    (Date.parse(previous.updatedAt ?? "") || 0)
            ) {
                next[id] = memory;
            }
        }
        localStorage.setItem(guestKey(session.roomId), JSON.stringify(next));
        session.memory = next;
    } catch {
        // Private browsing/storage limits must not prevent online play.
    }
};

export const createOnlineMemorySession = (
    roomId: string,
    itemIds: string[],
    userId: string | null,
    memory: Record<string, ItemMemoryState>,
): OnlineMemorySession => ({
    roomId,
    userId,
    memory,
    scheduler: createScheduler(itemIds),
    pending: new Map(),
});

export const nextOnlineRecommendation = (session: OnlineMemorySession) =>
    chooseNextUserItem(session.scheduler, session.memory)?.itemId ?? null;

export const recordOnlineRecall = (
    session: OnlineMemorySession,
    itemId: string,
    observation: RecallObservation,
): ItemMemoryState | null => {
    if (!session.scheduler.itemIds.includes(itemId)) return null;
    const scheduler = session.scheduler;
    const selected = scheduler.current;
    if (selected?.itemId !== itemId) {
        // A server may have fallen back to random before the suggestion arrived.
        // Reconcile against the actual displayed item, rather than crediting
        // an unpresented recommendation.
        if (selected) {
            if (
                selected.advancesCycle &&
                !scheduler.cycleQueue.includes(selected.itemId)
            )
                scheduler.cycleQueue.unshift(selected.itemId);
            if (selected.retry)
                scheduler.retries[selected.itemId] = selected.retry;
        } else {
            scheduler.turn++;
        }
        const entry = scheduler.retries[itemId];
        const advancesCycle = scheduler.cycleQueue.includes(itemId);
        if (advancesCycle) {
            scheduler.cycleQueue = scheduler.cycleQueue.filter(
                (id) => id !== itemId,
            );
            if (scheduler.cycleQueue.length === 0) scheduler.completedCycles++;
        }
        delete scheduler.retries[itemId];
        scheduler.current = {
            itemId,
            turn: scheduler.turn,
            cycle: scheduler.cycle,
            reason: entry ? "retry" : "cycle",
            retry: entry,
            advancesCycle,
        };
    }

    const previous = session.memory[itemId];
    const exposureAt = previous?.lastPresentedAt;
    const elapsedSincePresentationMs = exposureAt
        ? Math.max(0, Date.now() - Date.parse(exposureAt))
        : null;
    const evidence: RecallObservation = {
        ...observation,
        incorrectInputCount:
            observation.incorrectInputCount ??
            Math.max(0, observation.attemptCount - 1),
        initialCueRatio: observation.initialCueRatio ?? 0,
        finalCueRatio:
            observation.finalCueRatio ??
            observation.revealedHintChars /
                Math.max(1, observation.answerLength),
        additionalHintCount:
            observation.additionalHintCount ?? observation.hintCount,
        answerWasFullyRevealed:
            observation.answerWasFullyRevealed ??
            observation.revealedHintChars >= observation.answerLength,
        elapsedSincePresentationMs,
        expectedTypingMs: observation.answerLength * 220,
        schedulerReason: scheduler.current?.reason ?? "cycle",
    };
    recordUserAnswer(scheduler, evaluateRecall(evidence));
    const updated = applyRecallObservation({
        memory: previous,
        observation: evidence,
        userId: session.userId ?? guestUserId,
        roomId: session.roomId,
        itemId,
    });
    session.memory = { ...session.memory, [itemId]: updated };
    if (session.userId) session.pending.set(itemId, updated);
    else saveOnlineGuestMemory(session);
    return updated;
};
