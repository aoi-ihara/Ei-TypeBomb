import {
    applyRecallObservation,
    evaluateRecall,
    recordAnswerModeResult,
    isValidAnswerModeStats,
    type AnswerModeResult,
    type ItemMemoryState,
    type RecallObservation,
} from "../playground/memory";
import {
    chooseNextUserItem,
    createScheduler,
    loadSchedulerState,
    saveSchedulerState,
    recordUserAnswer,
    recordRecognitionAnswer,
    type SchedulerState,
} from "../playground/scheduler";

export type OnlineLearningDiagnostic = {
    kind: "recommendation" | "recall" | "selection";
    itemId: string;
    schedulerTurn: number;
    schedulerCycle: number;
    schedulerReason: string | null;
    cycleQueueRemaining: number;
    pendingRetryCount: number;
    suspendedWordCount: number;
    lastUserItemId: string | null;
    reconciled?: boolean;
    previousRecommendedItemId?: string | null;
    retryNeed?: "none" | "confirm" | "short";
    memoryEvidence?: string;
    independentRecall?: boolean;
    retryCountBefore?: number;
    hintCount?: number;
    revealedHintChars?: number;
    answerLength?: number;
    finalCueRatio?: number;
    answerWasFullyRevealed?: boolean;
    elapsedMs?: number;
    elapsedSincePresentationMs?: number | null;
    answerCorrect?: boolean;
};

export const onlineSchedulerDiagnostic = (
    session: OnlineMemorySession,
    kind: OnlineLearningDiagnostic["kind"],
    itemId: string,
): OnlineLearningDiagnostic => ({
    kind,
    itemId,
    schedulerTurn: session.scheduler.turn,
    schedulerCycle: session.scheduler.cycle,
    schedulerReason: session.scheduler.current?.reason ?? null,
    cycleQueueRemaining: session.scheduler.cycleQueue.length,
    pendingRetryCount: Object.keys(session.scheduler.retries).length,
    suspendedWordCount: Object.values(session.scheduler.struggles).filter(
        (entry) => entry.suspendedUntil !== null,
    ).length,
    lastUserItemId: session.scheduler.lastUserItem,
});

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
                Number.isInteger(value.reviewCount) &&
                (value.answerModeStats == null ||
                    isValidAnswerModeStats(value.answerModeStats)),
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
                    typeof memory.reviewCount === "number" &&
                    (memory.answerModeStats == null ||
                        isValidAnswerModeStats(memory.answerModeStats))
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
    scheduler:
        loadSchedulerState(
            "online",
            userId ?? guestUserId,
            roomId,
            itemIds,
            memory,
        ) ?? createScheduler(itemIds),
    pending: new Map(),
});

export const nextOnlineRecommendation = (session: OnlineMemorySession) => {
    const selected = chooseNextUserItem(session.scheduler, session.memory);
    saveSchedulerState(
        "online",
        session.userId ?? guestUserId,
        session.roomId,
        session.scheduler,
    );
    return selected?.itemId ?? null;
};

// Room snapshots may arrive several times for the same turn. Only a newly
// selected turn (or a fresh transport connection) needs to be recommended.
export const nextUnsentOnlineRecommendation = (
    session: OnlineMemorySession,
    last: { itemId: string; turn: number } | null,
): { itemId: string; turn: number } | null => {
    const itemId = nextOnlineRecommendation(session);
    if (!itemId) return null;
    const turn = session.scheduler.turn;
    if (last?.itemId === itemId && last.turn === turn) return null;
    return { itemId, turn };
};

const reconcileOnlineSchedulerItem = (
    scheduler: SchedulerState,
    itemId: string,
) => {
    if (scheduler.current?.itemId === itemId) return;
    const selected = scheduler.current;
    if (selected) {
        if (
            selected.advancesCycle &&
            !scheduler.cycleQueue.includes(selected.itemId)
        ) scheduler.cycleQueue.unshift(selected.itemId);
        if (selected.retry)
            scheduler.retries[selected.itemId] = selected.retry;
    } else {
        scheduler.turn++;
    }
    const retry = scheduler.retries[itemId];
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
        reason: retry ? "retry" : "cycle",
        retry,
        advancesCycle,
    };
};

export const recordOnlineAnswerModeResult = (
    session: OnlineMemorySession,
    itemId: string,
    mode: AnswerModeResult,
    success: boolean,
    onDiagnostic?: (diagnostic: OnlineLearningDiagnostic) => void,
): ItemMemoryState | null => {
    if (!session.scheduler.itemIds.includes(itemId)) return null;
    const selectedBefore = session.scheduler.current?.itemId ?? null;
    const retryCountBefore = Object.keys(session.scheduler.retries).length;
    const updated = recordAnswerModeResult({
        memory: session.memory[itemId],
        userId: session.userId ?? guestUserId,
        roomId: session.roomId,
        itemId,
        mode,
        success,
    });
    if (mode === "selection" && success) {
        reconcileOnlineSchedulerItem(session.scheduler, itemId);
        recordRecognitionAnswer(session.scheduler, itemId);
    }
    session.memory = { ...session.memory, [itemId]: updated };
    if (session.userId) session.pending.set(itemId, updated);
    else saveOnlineGuestMemory(session);
    saveSchedulerState(
        "online",
        session.userId ?? guestUserId,
        session.roomId,
        session.scheduler,
    );
    onDiagnostic?.({
        ...onlineSchedulerDiagnostic(session, "selection", itemId),
        reconciled: success && selectedBefore !== itemId,
        previousRecommendedItemId: selectedBefore,
        retryCountBefore,
        answerCorrect: success,
    });
    return updated;
};

export const recordOnlineRecall = (
    session: OnlineMemorySession,
    itemId: string,
    observation: RecallObservation,
    onDiagnostic?: (diagnostic: OnlineLearningDiagnostic) => void,
): ItemMemoryState | null => {
    if (!session.scheduler.itemIds.includes(itemId)) return null;
    const scheduler = session.scheduler;
    const selectedBefore = scheduler.current?.itemId ?? null;
    const reconciled = selectedBefore !== itemId;
    const retryCountBefore = Object.keys(scheduler.retries).length;
    reconcileOnlineSchedulerItem(scheduler, itemId);
    const schedulerReason = scheduler.current?.reason ?? null;

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
    const evaluation = evaluateRecall(evidence);
    recordUserAnswer(scheduler, evaluation);
    onDiagnostic?.({
        ...onlineSchedulerDiagnostic(session, "recall", itemId),
        schedulerReason,
        reconciled,
        previousRecommendedItemId: selectedBefore,
        retryCountBefore,
        retryNeed: evaluation.retryNeed,
        memoryEvidence: evaluation.memoryEvidence,
        independentRecall: evaluation.independent,
        hintCount: evidence.hintCount,
        revealedHintChars: evidence.revealedHintChars,
        answerLength: evidence.answerLength,
        finalCueRatio: evidence.finalCueRatio,
        answerWasFullyRevealed: evidence.answerWasFullyRevealed,
        elapsedMs: evidence.elapsedMs,
        elapsedSincePresentationMs: evidence.elapsedSincePresentationMs,
        answerCorrect: evidence.success,
    });
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
    saveSchedulerState(
        "online",
        session.userId ?? guestUserId,
        session.roomId,
        scheduler,
    );
    return updated;
};
