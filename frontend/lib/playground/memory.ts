const DAY_MS = 86_400_000;
const clamp = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
export const MEMORY_MODEL_VERSION = "playground-v13-typing-confirmation";
const INITIAL_ENCODING_STABILITY = 0.15;
// Uncalibrated hypotheses, measured in days.
export const INITIAL_CLEAR_RECALL_STABILITY = 0.3;
export const RETENTION_GAIN_FACTOR = 0.5;
// Product hypotheses, not calibrated measures of human memory.
export const RECENT_EXPOSURE_MS = 3_000;
// Only a genuinely spaced observation should strengthen a previously
// encountered word. Independent input merely means "not a fresh exposure".
export const MIN_SPACED_EVIDENCE_MS = 2 * 60_000;
export const isIndependentExposure = (gapMs: number | null | undefined) =>
    gapMs == null || gapMs >= RECENT_EXPOSURE_MS;

export const HEAVY_CUE_RATIO = 0.4;
export const FAST_RECALL_LATENCY_MS = 2_500;
export const FAST_READING_ALLOWANCE_MS = 2_000;
export const DEFAULT_EXPECTED_CHAR_MS = 220;

// Recognition speed only adjusts ordering, never correctness, retries or
// long-term recall. The 30s cutoff and bounded score prevent idle reading from
// imposing a large penalty. These are uncalibrated product hypotheses.
export const CHOICE_SPEED_IGNORE_AFTER_MS = 30_000;
const CHOICE_SPEED_NEUTRAL_MS = 8_000;
const CHOICE_SPEED_FAST_MS = 2_000;
const CHOICE_SPEED_FAST_BONUS = 0.30;
const CHOICE_SPEED_SLOW_PENALTY = 0.18;
const CHOICE_SPEED_EMA_ALPHA = 0.35;
// A manual "I don't know" reveal is slightly stronger evidence of difficulty
// than a wrong choice; the bonus affects selection ordering only.
export const CHOICE_UNKNOWN_FAILURE_WEIGHT = 1.3;
// Negative is a strong, quick first-try recognition (less priority); positive
// is slower but still correct (slightly more priority). Neither speed alone
// nor a single error determines whether a short-term retry is due.
export const getRecognitionSpeedAdjustment = (averageResponseMs?: number): number => {
    if (
        typeof averageResponseMs !== "number" ||
        !Number.isFinite(averageResponseMs) ||
        averageResponseMs < 0 ||
        averageResponseMs >= CHOICE_SPEED_IGNORE_AFTER_MS
    ) return 0;
    if (averageResponseMs === CHOICE_SPEED_NEUTRAL_MS) return 0;
    if (averageResponseMs < CHOICE_SPEED_NEUTRAL_MS)
        return -CHOICE_SPEED_FAST_BONUS *
            clamp(
                (CHOICE_SPEED_NEUTRAL_MS - averageResponseMs) /
                    (CHOICE_SPEED_NEUTRAL_MS - CHOICE_SPEED_FAST_MS),
                0,
                1,
            );
    return CHOICE_SPEED_SLOW_PENALTY *
        clamp(
            (averageResponseMs - CHOICE_SPEED_NEUTRAL_MS) /
                (CHOICE_SPEED_IGNORE_AFTER_MS - CHOICE_SPEED_NEUTRAL_MS),
            0,
            1,
        );
};

export type SchedulerReason =
    "cycle" | "retry" | "long_term_due" | "suspension_due" | "spaced_review" | "early_practice";
export type RecallProgress = {
    attemptCount: number;
    incorrectInputCount?: number;
    hintCount: number;
    revealedHintChars: number;
    assistedPositions?: number[];
    hintDiagnostics?: {
        version: string;
        displayedHintCount: number;
        preHintCorrectChars: number;
        assistedHintChars: number;
    };
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
    /** An independent, unaided answer recovered after exactly one corrected typo. */
    minorCorrection?: boolean;
    /** Continuous 0–1 recall evidence, distinct from predicted retention. */
    quality?: number;
};
/** Recognition evidence is shared by the UI, retry policy and simulator. */
export function evaluateRecognition(hadMistake: boolean, exposureGapMs?: number | null): AttemptEvaluation {
    return {
        memoryEvidence: hadMistake ? "insufficient_evidence" : "recall",
        retryNeed: hadMistake ? "short" : "none",
        reason: hadMistake ? "failed_recall" : null,
        independent: isIndependentExposure(exposureGapMs),
    };
}
// Read-only compatibility with existing JSON rows. Never used by the scheduler.
export type PersistedLearningState = {
    phase: "encoding" | "supported_recall" | "free_recall" | "graduated";
    freeRecallSuccesses: number;
    lastCueRatio: number;
    relearningSinceLastFreeRecall: boolean;
    cueSuccessStreak: number;
};
export type AnswerModeTrack = {
    attempts: number;
    correct: number;
    correctStreak: number;
    lastAttemptAt: string | null;
    // Exponential average of active first-choice response times (only clean
    // correct turns). Optional for old saved recognition history.
    averageResponseMs?: number;
    // Number of assisted selection turns, already counted among failures.
    unknownCount?: number;
    // Recognition has its own time-decayed stability; it is weaker evidence
    // than independent typed recall and must not overwrite recall stability.
    stability?: number;
    // Timestamp of the last clean recognition, not the last revealed answer.
    lastReviewedAt?: string | null;
};
export const getRecognitionFailureRate = (track: AnswerModeTrack): number => {
    const failures = Math.max(0, track.attempts - track.correct);
    const unknown = Math.min(failures, Math.max(0, track.unknownCount ?? 0));
    return (
        (failures + (CHOICE_UNKNOWN_FAILURE_WEIGHT - 1) * unknown) /
        (track.attempts + 1)
    );
};

export type AnswerModeStats = {
    recognition: AnswerModeTrack;
    recall: AnswerModeTrack;
};
export type AnswerModeResult = "selection" | "input";

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
    answerModeStats?: AnswerModeStats;
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

/** Continuous recall evidence; typing length is intentionally not a penalty. */
export function getRecallQuality(observation: RecallObservation): number {
    if (!observation.success || observation.answerWasFullyRevealed) return 0;
    const cue = clamp(Math.max(
        observation.initialCueRatio ?? 0,
        observation.finalCueRatio ??
            observation.revealedHintChars / Math.max(1, observation.answerLength),
    ), 0, 1);
    if (cue >= 1) return 0;
    const errors = Math.max(0, observation.incorrectInputCount ??
        Math.max(0, observation.attemptCount - 1));
    const latency = observation.recallLatencyMs;
    // First key latency is a length-independent proxy, not proof of full recall.
    const speed = latency === null ? 0.75 :
        0.65 + 0.35 * Math.exp(-Math.max(0, latency) / 6_000);
    return clamp(speed * Math.exp(-0.12 * errors) *
        Math.pow(1 - cue, 1.5) *
        Math.exp(-0.12 * (observation.additionalHintCount ?? 0)), 0, 1);
}

export const evaluateRecall = (
    observation: RecallObservation,
): AttemptEvaluation => {
    const quality = getRecallQuality(observation);
    const cue = Math.max(
        observation.initialCueRatio ?? 0,
        observation.finalCueRatio ??
            observation.revealedHintChars /
                Math.max(1, observation.answerLength),
    );
    const full = observation.answerWasFullyRevealed || cue >= 1;
    const independent = isIndependentExposure(
        observation.elapsedSincePresentationMs,
    );
    if (!observation.success || full)
        return {
            memoryEvidence: "insufficient_evidence",
            retryNeed: "short",
            reason: !observation.success ? "failed_recall" : "heavy_hint",
            independent,
        quality,
        };
    if (cue >= HEAVY_CUE_RATIO)
        return {
            memoryEvidence: "weak_recall",
            retryNeed: "short",
            reason: "heavy_hint",
            independent,
        quality,
        };
    if (cue > 0 || (observation.additionalHintCount ?? 0) > 0)
        return {
            memoryEvidence: "weak_recall",
            retryNeed: "confirm",
            reason: "uncertain_recall",
            independent,
        quality,
        };
    const errors =
        observation.incorrectInputCount ??
        Math.max(0, observation.attemptCount - 1);
    const correctedMistake = errors > 0 || !observation.firstAttemptCorrect;
    if (!independent)
        return {
            memoryEvidence: "insufficient_evidence",
            retryNeed: correctedMistake ? "confirm" : "none",
            reason: correctedMistake ? "uncertain_recall" : null,
            independent,
        quality,
        };
    const expected =
        observation.expectedTypingMs ??
        observation.answerLength * DEFAULT_EXPECTED_CHAR_MS;
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
        quality,
        };

    // A corrected typing error is still unaided recall, so it should not
    // reduce long-term memory stability or count as a failed retrieval. It
    // does warrant a bounded short-term confirmation, however; otherwise the
    // learner may never see the troublesome spelling again in this session.
    return {
        memoryEvidence: "recall",
        retryNeed: correctedMistake ? "confirm" : "none",
        reason: correctedMistake ? "uncertain_recall" : null,
        independent,
        ...(errors === 1 && !observation.firstAttemptCorrect
            ? { minorCorrection: true }
            : {}),
        quality,
    };
};

export const parseAnswerModeStats = (
    value: unknown,
): AnswerModeStats | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const source = value as Partial<AnswerModeStats>;
    const parseTrack = (track: unknown): AnswerModeTrack | undefined => {
        if (!track || typeof track !== "object") return undefined;
        const candidate = track as Partial<AnswerModeTrack>;
        if (
            !Number.isSafeInteger(candidate.attempts) ||
            (candidate.attempts ?? -1) < 0 ||
            !Number.isSafeInteger(candidate.correct) ||
            (candidate.correct ?? -1) < 0 ||
            (candidate.correct ?? 0) > (candidate.attempts ?? 0) ||
            !Number.isSafeInteger(candidate.correctStreak) ||
            (candidate.correctStreak ?? -1) < 0 ||
            (candidate.correctStreak ?? 0) > (candidate.correct ?? 0) ||
            (candidate.lastAttemptAt !== null &&
                (typeof candidate.lastAttemptAt !== "string" ||
                    !Number.isFinite(Date.parse(candidate.lastAttemptAt))))
        )
            return undefined;
        return {
            attempts: candidate.attempts as number,
            correct: candidate.correct as number,
            correctStreak: candidate.correctStreak as number,
            lastAttemptAt: candidate.lastAttemptAt ?? null,
            ...(typeof candidate.averageResponseMs === "number" &&
            Number.isFinite(candidate.averageResponseMs) &&
            candidate.averageResponseMs >= 0 &&
            candidate.averageResponseMs < CHOICE_SPEED_IGNORE_AFTER_MS
                ? { averageResponseMs: candidate.averageResponseMs }
                : {}),
            ...(Number.isSafeInteger(candidate.unknownCount) &&
            (candidate.unknownCount ?? -1) >= 0 &&
            (candidate.unknownCount ?? 0) <=
                (candidate.attempts ?? 0) - (candidate.correct ?? 0)
                ? { unknownCount: candidate.unknownCount }
                : {}),
            ...(typeof candidate.stability === "number" &&
            Number.isFinite(candidate.stability) &&
            candidate.stability > 0
                ? { stability: candidate.stability }
                : {}),
            ...(candidate.lastReviewedAt === null || (typeof candidate.lastReviewedAt === "string" &&
            Number.isFinite(Date.parse(candidate.lastReviewedAt)))
                ? { lastReviewedAt: candidate.lastReviewedAt }
                : {}),
        };
    };
    const recognition = parseTrack(source.recognition);
    const recall = parseTrack(source.recall);
    return recognition && recall ? { recognition, recall } : undefined;
};

export const isValidAnswerModeStats = (
    value: unknown,
): value is AnswerModeStats => parseAnswerModeStats(value) !== undefined;

export const toMemoryState = (row: {
    user_id: string;
    room_id: string;
    id: string;
    stability: number;
    difficulty: number;
    review_count: number;
    last_reviewed_at: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    learning_state?: PersistedLearningState | null;
    last_presented_at?: string | null;
    answer_mode_stats?: unknown;
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
    answerModeStats: parseAnswerModeStats(row.answer_mode_stats),
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

// A successful independent review provides evidence over the interval since
// the last exposure. Cap extrapolation from a single observation.
export function getExposureGap(
    memory: ItemMemoryState | undefined,
    mode: AnswerModeResult,
    presentedAt: number,
): number | null {
    const previous = memory?.lastPresentedAt ??
        (mode === "selection"
            ? memory?.answerModeStats?.recognition.lastAttemptAt
            : memory?.lastReviewedAt);
    return previous ? Math.max(0, presentedAt - Date.parse(previous)) : null;
}

/** Minimum answer-free interval required for a new retention observation. */
export function getReviewIntervalMs(
    stability: number,
    hasAnchor: boolean,
): number {
    return hasAnchor
        ? Math.max(
              MIN_SPACED_EVIDENCE_MS,
              -Math.max(0.12, stability) *
                  Math.log(MASTERY_RETRIEVABILITY_THRESHOLD) *
                  DAY_MS,
          )
        : MIN_SPACED_EVIDENCE_MS;
}

// One interpretation of legacy recognition rows for prediction, scheduling
// and updates. Missing stability must not silently change on the first write.
export function recognitionMemory(track: AnswerModeTrack | undefined) {
    const anchor =
        track?.lastReviewedAt !== undefined
            ? track.lastReviewedAt
            : track?.correctStreak
              ? track.lastAttemptAt
              : null;
    return {
        anchor,
        stability: Math.max(
            0.12,
            track?.stability ??
                (anchor
                    ? INITIAL_CLEAR_RECALL_STABILITY
                    : INITIAL_ENCODING_STABILITY),
        ),
    };
}

/** Earliest useful long-term review, including all intervening answer exposures. */
export function getNextMemoryReviewAt(
    memory: ItemMemoryState | undefined,
    mode: AnswerModeResult,
): number | null {
    if (!memory) return null;
    const track = memory.answerModeStats?.recognition;
    const recognition = recognitionMemory(track);
    const anchor =
        mode === "input" ? memory.lastReviewedAt : recognition.anchor;
    const stability =
        mode === "input" ? memory.stability : recognition.stability;
    const exposure =
        memory.lastPresentedAt ??
        (mode === "selection" ? track?.lastAttemptAt : memory.lastReviewedAt) ??
        anchor;
    if (!exposure) return null;
    const at = Date.parse(exposure);
    if (!Number.isFinite(at)) return null;
    return (
        Math.max(at, anchor ? Date.parse(anchor) : at) +
        getReviewIntervalMs(stability, Boolean(anchor))
    );
}

// Short rehearsals carry a small, continuous amount of evidence. The gain is
// bounded by actual answer-free time (rather than attempt count), so answering
// every few seconds cannot manufacture days of retention. We deliberately do
// not move the long-term review anchor for this weaker evidence.
const EARLY_PRACTICE_GAIN_DAYS_PER_DAY = 0.25;
function earlyPracticeStability(stability: number, gapMs: number | null) {
    if (gapMs === null || !Number.isFinite(gapMs) || gapMs < RECENT_EXPOSURE_MS)
        return stability;
    return stability + Math.max(0, gapMs) / DAY_MS * EARLY_PRACTICE_GAIN_DAYS_PER_DAY;
}

function spacedStability(stability: number, gapMs: number, quality = 1) {
    const days = gapMs / DAY_MS;
    if (!Number.isFinite(days)) return stability;
    const gain = stability * (1 - Math.exp(-days / stability)) * RETENTION_GAIN_FACTOR * quality;
    const demonstrated = 1.25 * days / -Math.log(MASTERY_RETRIEVABILITY_THRESHOLD) * quality;
    return Math.min(stability * 3, Math.max(stability + gain, demonstrated));
}

// Evidence eligibility belongs to memory, never to a scheduler reason label.
function hasSpacedEvidence(
    stability: number,
    anchor: string | null,
    gapMs: number | null,
    firstExposure: boolean,
    now: number,
): boolean {
    const interval = getReviewIntervalMs(stability, Boolean(anchor));
    return (
        (firstExposure ||
            (gapMs !== null && Number.isFinite(gapMs) && gapMs >= interval)) &&
        (!anchor || now - Date.parse(anchor) >= interval)
    );
}

const updateAnswerModeStats = (
    current: AnswerModeStats | undefined,
    mode: AnswerModeResult,
    success: boolean,
    now: Date,
    responseMs: number | null = null,
    usedHint = false,
    exposureGapMs: number | null = null,
    choiceCount = 4,
): AnswerModeStats => {
    const emptyTrack = (): AnswerModeTrack => ({
        attempts: 0,
        correct: 0,
        correctStreak: 0,
        lastAttemptAt: null,
    });
    const stats = current ?? {
        recognition: emptyTrack(),
        recall: emptyTrack(),
    };
    const key = mode === "selection" ? "recognition" : "recall";
    const previous = stats[key];
    const nextTrack: AnswerModeTrack = {
        ...previous,
        attempts: previous.attempts + 1,
        correct: previous.correct + Number(success),
        correctStreak: success ? previous.correctStreak + 1 : 0,
        lastAttemptAt: now.toISOString(),
        ...(mode === "selection" && !success && usedHint
            ? { unknownCount: (previous.unknownCount ?? 0) + 1 }
            : {}),
    };
    if (mode === "selection") {
        // Reuse the recall model's exponential decay and stability gain, but
        // track recognition separately to avoid awarding free-recall mastery.
        // A failed/revealed choice weakens stability without creating a new
        // successful-review timestamp (which would falsely raise mastery).
        const { anchor: lastCleanAt, stability: previousStability } =
            recognitionMemory(previous);
        const creditsMemory = hasSpacedEvidence(
            previousStability,
            lastCleanAt,
            exposureGapMs,
            previous.attempts === 0 && exposureGapMs === null,
            now.getTime(),
        );
        if (!success && creditsMemory) {
            nextTrack.stability = Math.max(
                0.12,
                previousStability * (usedHint ? 0.75 : 0.8),
            );
        } else if (success && creditsMemory) {
            // Discount successful guesses when fewer distractors were available.
            const weight =
                (1 - 1 / Math.max(2, Math.min(4, choiceCount))) / 0.75;
            nextTrack.stability =
                lastCleanAt && exposureGapMs !== null
                    ? previousStability +
                      weight *
                          (spacedStability(previousStability, exposureGapMs) -
                              previousStability)
                    : INITIAL_CLEAR_RECALL_STABILITY * weight;
        } else if (success && lastCleanAt) {
            // Sub-due successful recognition is useful practice, but does not
            // reset the clean spaced-review anchor.
            nextTrack.stability = earlyPracticeStability(
                previousStability, exposureGapMs,
            );
        } else {
            nextTrack.stability = previousStability;
        }
        nextTrack.lastReviewedAt =
            success && creditsMemory ? now.toISOString() : lastCleanAt;
    }

    if (
        mode === "selection" &&
        success &&
        responseMs !== null &&
        Number.isFinite(responseMs) &&
        responseMs >= 0 &&
        responseMs < CHOICE_SPEED_IGNORE_AFTER_MS
    ) {
        const sample = responseMs;
        nextTrack.averageResponseMs =
            previous.averageResponseMs === undefined
                ? sample
                : previous.averageResponseMs * (1 - CHOICE_SPEED_EMA_ALPHA) +
                  sample * CHOICE_SPEED_EMA_ALPHA;
    }
    return {
        ...stats,
        [key]: nextTrack,
        ...(mode === "input" && !success
            ? {
                  recognition: {
                      ...stats.recognition,
                      correctStreak: 0,
                  },
              }
            : {}),
    };
};

// Preserve the order of two answers recorded within the same millisecond.
const nextMemoryTimestamp = (memory: ItemMemoryState, now: Date): string =>
    new Date(Math.max(now.getTime(), (Date.parse(memory.updatedAt ?? "") || 0) + 1)).toISOString();

export const recordAnswerModeResult = ({
    memory,
    userId,
    roomId,
    itemId,
    mode,
    success,
    now = new Date(),
    responseMs = null,
    usedHint = false,
    choiceCount = 4,
    exposureGapMs,
}: {
    memory: ItemMemoryState | undefined;
    userId: string;
    roomId: string;
    itemId: string;
    mode: AnswerModeResult;
    success: boolean;
    now?: Date;
    responseMs?: number | null;
    usedHint?: boolean;
    choiceCount?: number;
    exposureGapMs?: number | null;
}): ItemMemoryState => {
    const current = memory ?? createInitialMemory(userId, roomId, itemId);
    const iso = now.toISOString();
    // With no distractor there is no recognition test, only answer exposure.
    if (mode === "selection" && choiceCount < 2)
        return recordAnswerExposure(current, now);
    return {
        ...current,
        userId,
        roomId,
        itemId,
        answerModeStats: updateAnswerModeStats(
            current.answerModeStats,
            mode,
            success,
            now,
            responseMs,
            usedHint,
            exposureGapMs === undefined
                ? getExposureGap(current, mode, now.getTime())
                : exposureGapMs,
            choiceCount,
        ),
        // A typing failure is an intermediate attempt within the current
        // presentation, not a new exposure. Preserve the previous timestamp
        // so the eventual successful recall uses the original exposure gap.
        lastPresentedAt:
            mode === "input" && !success
                ? (current.lastPresentedAt ?? null)
                : iso,
        updatedAt: nextMemoryTimestamp(current, now),
    };
};

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

// Recognition prediction uses the same forgetting curve, but a separate
// stability so choosing an answer never overwrites free-recall confidence.
export const getRecognitionRetrievability = (
    memory: Pick<ItemMemoryState, "answerModeStats"> | undefined,
    now = Date.now(),
): number => {
    const track = memory?.answerModeStats?.recognition;
    if (!track || track.attempts === 0) return 0;
    const { anchor, stability } = recognitionMemory(track);
    if (!anchor) return 0;
    const lastReviewedMs = Date.parse(anchor);
    if (!Number.isFinite(lastReviewedMs)) return 0;
    const elapsedDays = Math.max(0, (now - lastReviewedMs) / DAY_MS);
    return clamp(Math.exp(-elapsedDays / stability), 0, 1);
};

// Mastery counts words exceeding the current answer mode's time-decayed prediction.
export const MASTERY_RETRIEVABILITY_THRESHOLD = 0.8;
export const MASTERY_FORECAST_HORIZON_MS = DAY_MS;
export const MASTERY_THREE_HOUR_HORIZON_MS = 3 * 60 * 60 * 1000;

export type MasteryProgress = {
    total: number;
    masteredNow: number;
    masteredAfter3Hours: number;
    masteredAfter24Hours: number;
};

export type MasteryItemPrediction = {
    itemId: string;
    mode: AnswerModeResult;
    probabilities: number[];
    aboveThreshold: boolean[];
    included: true;
    reason: "prediction" | "missing_memory" | "invalid_memory";
};

export const getMasteryProgress = (
    itemIds: readonly string[],
    memoryByItem: Readonly<Record<string, ItemMemoryState>>,
    now = Date.now(),
    threshold = MASTERY_RETRIEVABILITY_THRESHOLD,
    mode: AnswerModeResult = "input",
    modeByItem?: Readonly<Record<string, AnswerModeResult>>,
    observe?: (item: MasteryItemPrediction) => void,
): MasteryProgress => {
    const uniqueItemIds = new Set(itemIds);
    let masteredNow = 0;
    let masteredAfter3Hours = 0;
    let masteredAfter24Hours = 0;
    for (const itemId of uniqueItemIds) {
        const memory = memoryByItem[itemId];
        const effectiveMode = modeByItem?.[itemId] ?? mode;
        const recognition = effectiveMode === "selection";
        const predict = recognition ? getRecognitionRetrievability : getRetrievability;
        const stability = recognition ? memory?.answerModeStats?.recognition.stability : memory?.stability;
        const valid = stability === undefined || (Number.isFinite(stability) && stability >= 0);
        const probabilities = [0, MASTERY_THREE_HOUR_HORIZON_MS, MASTERY_FORECAST_HORIZON_MS]
            .map(offset => {
                const value = valid ? predict(memory, now + offset) : 0;
                return Number.isFinite(value) ? value : 0;
            });
        const aboveThreshold = probabilities.map(value => value >= threshold);
        observe?.({ itemId, mode: effectiveMode, probabilities, aboveThreshold, included: true,
            reason: !memory ? "missing_memory" : !valid ? "invalid_memory" : "prediction" });
        if (!aboveThreshold[0]) continue;
        masteredNow++;
        if (aboveThreshold[1]) masteredAfter3Hours++;
        if (aboveThreshold[2]) masteredAfter24Hours++;
    }
    return { total: uniqueItemIds.size, masteredNow, masteredAfter3Hours, masteredAfter24Hours };
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
    const unaidedInputSuccess =
        observation.success &&
        (evaluation.memoryEvidence === "recall" ||
            evaluation.memoryEvidence === "strong_recall") &&
        !observation.answerWasFullyRevealed &&
        (observation.initialCueRatio ?? 0) === 0 &&
        (observation.finalCueRatio ?? 0) === 0 &&
        (observation.hintCount ?? 0) === 0 &&
        (observation.additionalHintCount ?? 0) === 0;
    let stability = current.stability;
    let difficulty = current.difficulty;
    let lastReviewedAt = current.lastReviewedAt;
    const iso = now.toISOString();
    const gapMs =
        observation.elapsedSincePresentationMs === undefined
            ? getExposureGap(current, "input", now.getTime())
            : observation.elapsedSincePresentationMs;
    const previouslyExposed =
        current.reviewCount > 0 ||
        Boolean(current.lastPresentedAt) ||
        (current.answerModeStats?.recognition.attempts ?? 0) > 0;
    const spacedEvidence = hasSpacedEvidence(
        current.stability,
        current.lastReviewedAt,
        gapMs,
        !previouslyExposed,
        now.getTime(),
    );
    if (
        !observation.success ||
        observation.answerWasFullyRevealed ||
        (observation.finalCueRatio ?? 0) >= 1
    ) {
        if (spacedEvidence) {
            stability = Math.max(0.12, stability * 0.8);
            difficulty = clamp(difficulty + 0.5, 1, 10);
        }
    } else if (
        evaluation.independent &&
        evaluation.memoryEvidence !== "insufficient_evidence"
    ) {
        // Speed controls session repetition, not the magnitude of long-term gain.
        const weak = evaluation.memoryEvidence === "weak_recall";
        if (unaidedInputSuccess && spacedEvidence) {
            stability = current.lastReviewedAt
                ? spacedStability(stability, gapMs ?? 0, evaluation.quality ?? 1)
                : Math.max(stability, INITIAL_CLEAR_RECALL_STABILITY);
            lastReviewedAt = iso;
        } else if (unaidedInputSuccess && current.lastReviewedAt) {
            stability = earlyPracticeStability(stability, gapMs);
        }
        // Early practice is useful for fluency, but not independent evidence
        // that the card survives the intended spaced interval.
        if (spacedEvidence)
            difficulty = clamp(difficulty + (weak ? 0.1 : -0.15), 1, 10);
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
        updatedAt: nextMemoryTimestamp(current, now),
        learningState: null,
        answerModeStats: updateAnswerModeStats(
            current.answerModeStats,
            "input",
            unaidedInputSuccess,
            now,
        ),
    };
};

export const recordAnswerExposure = (
    memory: ItemMemoryState,
    now = new Date(),
): ItemMemoryState => ({
    ...memory,
    lastPresentedAt: now.toISOString(),
    updatedAt: nextMemoryTimestamp(memory, now),
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
