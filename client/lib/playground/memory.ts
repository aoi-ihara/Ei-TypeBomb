const DAY_MS = 86_400_000;
const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
export const MEMORY_MODEL_VERSION = "playground-v5-hints";
const INITIAL_ENCODING_STABILITY = 0.15;
// Product hypotheses, not calibrated measures of human memory.
export const RECENT_EXPOSURE_MS = 3_000;
export const HEAVY_CUE_RATIO = 0.4;
export const FAST_RECALL_LATENCY_MS = 2_500;
export const FAST_READING_ALLOWANCE_MS = 2_000;
export const SLOW_READING_ALLOWANCE_MS = 6_000;
export const DEFAULT_EXPECTED_CHAR_MS = 220;

export type SchedulerReason = "cycle" | "retry" | "long_term_due";
export type RecallProgress = {
    attemptCount: number;
    incorrectInputCount?: number;
    hintCount: number;
    revealedHintChars: number;
    assistedPositions?: number[];
    hintEvents?: {
        kind: "letter" | "answer";
        source: "manual";
        atMs: number;
        position: number | null;
        correctBefore: number;
    }[];
    answerWasFullyRevealed?: boolean;
    maxCorrectPrefixLength: number;
    recallLatencyMs: number | null;
    elapsedMs: number;
};
export type RecallOutcome =
    "encoding" | "free_recall" | "cued_recall" | "relearned";
export type RecallObservation = RecallProgress & {
    success: boolean;
    answerLength: number;
    firstAttemptCorrect: boolean;
    outcome?: RecallOutcome;
    finalCueRatio?: number;
    initialCueRatio?: number;
    additionalHintCount?: number;
    answerWasFullyRevealed?: boolean;
    elapsedSincePresentationMs?: number | null;
    expectedTypingMs?: number;
    schedulerReason?: SchedulerReason;
};
export type AttemptEvaluation = {
    memoryEvidence:
        "strong_recall" | "recall" | "weak_recall" | "insufficient_evidence";
    retryNeed: "none" | "confirm" | "short";
    reason: "failed_recall" | "heavy_hint" | "uncertain_recall" | null;
    independent: boolean;
};
// Read-only compatibility with existing JSON rows. Never used by the scheduler.
export type PersistedLearningState = {
    phase: "encoding" | "supported_recall" | "free_recall" | "graduated";
    freeRecallSuccesses: number;
    lastCueRatio: number;
    relearningSinceLastFreeRecall: boolean;
    cueSuccessStreak: number;
};
export type ItemMemoryState = {
    userId: string;
    roomId: string;
    itemId: string;
    stability: number;
    difficulty: number;
    reviewCount: number;
    lastReviewedAt: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    learningState?: PersistedLearningState | null;
    lastPresentedAt?: string | null;
};
export type LearningMode =
    "encoding" | "supported_recall" | "free_recall" | "relearning";
export type TurnPlan = {
    mode: LearningMode;
    retrievalWindowMs: number;
    retrievability: number;
    difficulty: number;
    initialCueRatio: number;
    cueSteps: number[];
    hintDelaysMs: number[] | null;
    bombPressure: "paused" | "low" | "normal";
    countsAsRecall: boolean;
};

export const evaluateRecall = (
    observation: RecallObservation,
): AttemptEvaluation => {
    const cue = Math.max(
        observation.initialCueRatio ?? 0,
        observation.finalCueRatio ??
            observation.revealedHintChars /
                Math.max(1, observation.answerLength),
    );
    const full = observation.answerWasFullyRevealed || cue >= 1;
    const independent =
        observation.elapsedSincePresentationMs == null ||
        observation.elapsedSincePresentationMs >= RECENT_EXPOSURE_MS;
    if (!observation.success || full)
        return {
            memoryEvidence: "insufficient_evidence",
            retryNeed: "short",
            reason: !observation.success ? "failed_recall" : "heavy_hint",
            independent,
        };
    if (cue >= HEAVY_CUE_RATIO)
        return {
            memoryEvidence: "weak_recall",
            retryNeed: "short",
            reason: "heavy_hint",
            independent,
        };
    if (!independent)
        return {
            memoryEvidence: "insufficient_evidence",
            retryNeed: "confirm",
            reason: "uncertain_recall",
            independent,
        };
    if (cue > 0 || (observation.additionalHintCount ?? 0) > 0)
        return {
            memoryEvidence: "weak_recall",
            retryNeed: "confirm",
            reason: "uncertain_recall",
            independent,
        };
    const expected =
        observation.expectedTypingMs ??
        observation.answerLength * DEFAULT_EXPECTED_CHAR_MS;
    const errors =
        observation.incorrectInputCount ??
        Math.max(0, observation.attemptCount - 1);
    const fast =
        observation.recallLatencyMs !== null &&
        observation.recallLatencyMs <= FAST_RECALL_LATENCY_MS &&
        observation.elapsedMs <= FAST_READING_ALLOWANCE_MS + expected * 1.5;
    if (errors === 0 && observation.firstAttemptCorrect && fast)
        return {
            memoryEvidence: "strong_recall",
            retryNeed: "none",
            reason: null,
            independent,
        };
    // One promptly corrected typo is not a recall failure.
    if (
        errors <= 1 &&
        observation.elapsedMs <= SLOW_READING_ALLOWANCE_MS + expected * 2
    )
        return {
            memoryEvidence: "recall",
            retryNeed: "none",
            reason: null,
            independent,
        };
    return {
        memoryEvidence: "weak_recall",
        retryNeed: "confirm",
        reason: "uncertain_recall",
        independent,
    };
};

export const toMemoryState = (row: {
    user_id: string;
    room_id: string;
    id: string;
    stability: number;
    difficulty: number;
    review_count: number;
    last_reviewed_at: string;
    created_at?: string | null;
    updated_at?: string | null;
    learning_state?: PersistedLearningState | null;
    last_presented_at?: string | null;
}): ItemMemoryState => ({
    userId: row.user_id,
    roomId: row.room_id,
    itemId: row.id,
    stability: Math.max(0.12, Number(row.stability) || 0.35),
    difficulty: clamp(Number(row.difficulty) || 5, 1, 10),
    reviewCount: Math.max(0, Number(row.review_count) || 0),
    lastReviewedAt: row.last_reviewed_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    learningState: row.learning_state ?? null,
    lastPresentedAt: row.last_presented_at ?? null,
});

export const createInitialMemory = (
    userId: string,
    roomId: string,
    itemId: string,
): ItemMemoryState => ({
    userId,
    roomId,
    itemId,
    stability: INITIAL_ENCODING_STABILITY,
    difficulty: 5,
    reviewCount: 0,
    lastReviewedAt: null,
});

export const getRetrievability = (
    memory: ItemMemoryState | undefined,
    now = Date.now(),
) => {
    if (!memory?.lastReviewedAt || memory.reviewCount === 0) return 0;

    const elapsedDays = Math.max(
        0,
        (now - new Date(memory.lastReviewedAt).getTime()) / DAY_MS,
    );
    const stability = Math.max(0.12, memory.stability);

    return clamp(Math.exp(-elapsedDays / stability), 0, 1);
};

export const applyRecallObservation = ({
    memory,
    observation,
    userId,
    roomId,
    itemId,
    now = new Date(),
}: {
    memory: ItemMemoryState | undefined;
    observation: RecallObservation;
    userId: string;
    roomId: string;
    itemId: string;
    now?: Date;
}): ItemMemoryState => {
    const current = memory ?? createInitialMemory(userId, roomId, itemId);
    const evaluation = evaluateRecall(observation);
    let stability = current.stability;
    let difficulty = current.difficulty;
    let lastReviewedAt = current.lastReviewedAt;
    const iso = now.toISOString();
    if (
        !observation.success ||
        observation.answerWasFullyRevealed ||
        (observation.finalCueRatio ?? 0) >= 1
    ) {
        stability = Math.max(0.12, stability * 0.8);
        difficulty = clamp(difficulty + 0.5, 1, 10);
        lastReviewedAt = iso;
    } else if (
        evaluation.independent &&
        evaluation.memoryEvidence !== "insufficient_evidence"
    ) {
        // Speed controls session repetition, not the magnitude of long-term gain.
        const weight = evaluation.memoryEvidence === "weak_recall" ? 0.2 : 1;
        const gain = current.lastReviewedAt
            ? (1 - getRetrievability(current, now.getTime())) * 0.5 * weight
            : 0;
        stability = Math.max(0.12, stability * (1 + gain));
        difficulty = clamp(difficulty + (weight === 1 ? -0.15 : 0.1), 1, 10);
        lastReviewedAt = iso;
    }
    return {
        ...current,
        userId,
        roomId,
        itemId,
        stability,
        difficulty,
        reviewCount: current.reviewCount + 1,
        lastReviewedAt,
        lastPresentedAt: iso,
        updatedAt: iso,
        learningState: null,
    };
};

export const recordAnswerExposure = (
    memory: ItemMemoryState,
    now = new Date(),
): ItemMemoryState => ({
    ...memory,
    lastPresentedAt: now.toISOString(),
    updatedAt: now.toISOString(),
});

// Every presentation starts without letter cues. Learning hints are requested manually.
export const createTurnPlan = (
    memory: ItemMemoryState | undefined,
): TurnPlan => ({
    mode: "free_recall",
    retrievalWindowMs: clamp(
        18_000 + ((memory?.difficulty ?? 5) - 5) * 600,
        12_000,
        26_000,
    ),
    retrievability: getRetrievability(memory),
    difficulty: memory?.difficulty ?? 5,
    initialCueRatio: 0,
    cueSteps: [0.2, 0.4, 0.7, 1],
    hintDelaysMs: null,
    bombPressure: "normal",
    countsAsRecall: true,
});

export const shouldRecommendStop = ({
    sessionStartedAt,
    now = Date.now(),
}: {
    sessionStartedAt: number;
    now?: number;
}) => now - sessionStartedAt >= 15 * 60_000;
