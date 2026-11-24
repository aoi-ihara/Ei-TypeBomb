import {
    applyRecallObservation,
    evaluateRecall,
    getExposureGap,
    recordAnswerModeResult,
    isValidAnswerModeStats,
    type AnswerModeResult,
    type ItemMemoryState,
    type RecallObservation,
    type RecallProgress,
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
    kind:
        | "recommendation"
        | "recall"
        | "selection"
        | "recall_started"
        | "unfinished";
    diagnosticVersion: "online-learning-v2";
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
    attemptKey?: string;
    endReason?: string;
    hintEvidenceVersion?: string;
    displayedHintCount?: number;
    preHintCorrectChars?: number;
    assistedHintChars?: number;
    displayedFullAnswer?: boolean;
    attemptCount?: number;
    incorrectInputCount?: number;
};

export const onlineSchedulerDiagnostic = (
    session: OnlineMemorySession,
    kind: OnlineLearningDiagnostic["kind"],
    itemId: string,
): OnlineLearningDiagnostic => ({
    diagnosticVersion: "online-learning-v2",
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

export const onlineRecallDiagnosticFields = (
    progress: RecallProgress,
    answerLength: number,
) => ({
    hintEvidenceVersion: progress.hintDiagnostics?.version,
    displayedHintCount: progress.hintDiagnostics?.displayedHintCount,
    preHintCorrectChars: progress.hintDiagnostics?.preHintCorrectChars,
    assistedHintChars: progress.hintDiagnostics?.assistedHintChars,
    displayedFullAnswer:
        answerLength > 0 && progress.revealedHintChars >= answerLength,
    hintCount: progress.hintCount,
    revealedHintChars: progress.revealedHintChars,
    attemptCount: progress.attemptCount,
    incorrectInputCount: progress.incorrectInputCount,
    elapsedMs: progress.elapsedMs,
});

export type OnlineMemorySession = {
    roomId: string;
    userId: string | null;
    memory: Record<string, ItemMemoryState>;
    modes?: Record<string, AnswerModeResult>;
    choiceCount?: number;
    scheduler: SchedulerState;
    enqueue?: (memory: ItemMemoryState) => void;
};

// Guest online play intentionally shares the exact same per-room storage as Playground.
const guestKey = (roomId: string) => `playground-memory:guest:${roomId}`;
const guestUserId = "playground-guest";
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
    modes?: Record<string, AnswerModeResult>,
    choiceCount = 4,
    enqueue?: OnlineMemorySession["enqueue"],
): OnlineMemorySession => ({
    modes,
    choiceCount,
    roomId,
    userId,
    memory,
    scheduler:
        loadSchedulerState(
            "online",
            userId ?? guestUserId,
            roomId,
            itemIds,
        ) ?? createScheduler(itemIds),
    enqueue,
});

export const nextOnlineRecommendation = (session: OnlineMemorySession) => {
    const selected = chooseNextUserItem(session.scheduler, session.memory, Math.random, Date.now(), "input", session.modes);
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
        )
            scheduler.cycleQueue.unshift(selected.itemId);
        if (selected.retry) scheduler.retries[selected.itemId] = selected.retry;
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
    hadMistake = false,
    responseMs: number | null = null,
    presentedAt = Date.now(),
): ItemMemoryState | null => {
    if (!session.scheduler.itemIds.includes(itemId)) return null;
    const selectedBefore = session.scheduler.current?.itemId ?? null;
    const retryCountBefore = Object.keys(session.scheduler.retries).length;
    if (mode === "selection" && (session.choiceCount ?? 4) < 2) {
        reconcileOnlineSchedulerItem(session.scheduler, itemId);
        session.scheduler.current = null;
        saveSchedulerState("online", session.userId ?? guestUserId, session.roomId, session.scheduler);
        return session.memory[itemId] ?? null;
    }
    const now = Date.now();
    const exposureGapMs = getExposureGap(session.memory[itemId], mode, presentedAt);
    const updated = recordAnswerModeResult({
        memory: session.memory[itemId],
        userId: session.userId ?? guestUserId,
        roomId: session.roomId,
        itemId,
        mode,
        success: success && !(mode === "selection" && hadMistake),
        responseMs,
        choiceCount: session.choiceCount,
        now: new Date(now),
        exposureGapMs,
    });
    if (mode === "selection" && success) {
        reconcileOnlineSchedulerItem(session.scheduler, itemId);
        recordRecognitionAnswer(session.scheduler, itemId, hadMistake, now, exposureGapMs);
    }
    session.memory = { ...session.memory, [itemId]: updated };
    if (session.userId) session.enqueue?.(updated);
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
        answerCorrect: success && !(mode === "selection" && hadMistake),
    });
    return updated;
};

export const recordOnlineRecall = (
    session: OnlineMemorySession,
    itemId: string,
    observation: RecallObservation,
    onDiagnostic?: (diagnostic: OnlineLearningDiagnostic) => void,
    presentedAt = Date.now(),
): ItemMemoryState | null => {
    if (!session.scheduler.itemIds.includes(itemId)) return null;
    const scheduler = session.scheduler;
    const selectedBefore = scheduler.current?.itemId ?? null;
    const reconciled = selectedBefore !== itemId;
    const retryCountBefore = Object.keys(scheduler.retries).length;
    reconcileOnlineSchedulerItem(scheduler, itemId);
    const schedulerReason = scheduler.current?.reason ?? null;

    const previous = session.memory[itemId];
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
        elapsedSincePresentationMs: getExposureGap(previous, "input", presentedAt),
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
        ...onlineRecallDiagnosticFields(evidence, evidence.answerLength),
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
    if (session.userId) session.enqueue?.(updated);
    else saveOnlineGuestMemory(session);
    saveSchedulerState(
        "online",
        session.userId ?? guestUserId,
        session.roomId,
        scheduler,
    );
    return updated;
};
