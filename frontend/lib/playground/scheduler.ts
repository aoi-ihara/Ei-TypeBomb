import { SCHEDULER_VERSION, type DecisionObserver } from "./decision-trace";
import {
    MASTERY_RETRIEVABILITY_THRESHOLD,
    getNextMemoryReviewAt,
    evaluateRecognition,
    getExposureGap,
    getRetrievability,
    getRecognitionRetrievability,
    getRecognitionSpeedAdjustment,
    getRecognitionFailureRate,
    recognitionMemory,
    type AttemptEvaluation,
    type ItemMemoryState,
    type SchedulerReason,
} from "./memory";

// Product hypotheses. Turns count USER questions only, never BOT presentations.
export const SHORT_RETRY_GAP = 2;
export const CONFIRM_RETRY_GAP = 5;
export const RETRY_WINDOW_WIDTH = 3;
export const CYCLE_STRIDE = 2;
export const REQUIRED_RETRY_SUCCESSES = 2;
// One corrected typo can start a confirmation halfway when recall is confident.
export const CONFIDENT_TYPO_QUALITY = 0.8;
export const BOT_LOOKAHEAD = 3;
// Do not introduce more words while this many still need recall practice.
export const MAX_ACTIVE_RELEARNING = 4;
// A soft introduction quota: keep learning new cards without missing retry deadlines.
export const INTRODUCTION_STRIDE = 6;

// Product hypotheses to calibrate with retention outcomes.
export const INITIAL_SUSPENSION_FAILURES = 4;
export const INITIAL_SUSPENSION_WINDOW_MS = 2 * 60_000;
export const REPEAT_SUSPENSION_FAILURES = 2;
export const SUSPENSION_DELAYS_MS = [
    10 * 60_000,
    30 * 60_000,
    3 * 60 * 60_000,
    12 * 60 * 60_000,
    24 * 60 * 60_000,
] as const;
export type StruggleEntry = {
    consecutiveFailures: number;
    firstFailureAt: number | null;
    // Hold count decreases gradually after independent recall.
    suspensionLevel: number;
    suspendedUntil: number | null;
};
export type RetryEntry = {
    itemId: string;
    earliestTurn: number;
    latestTurn: number;
    reason: "failed_recall" | "heavy_hint" | "uncertain_recall";
    successCount: number;
};
export type Selection = {
    itemId: string;
    turn: number;
    cycle: number;
    reason: SchedulerReason;
    advancesCycle: boolean;
    retry?: RetryEntry;
};
export type SchedulerState = {
    itemIds: string[];
    cycleQueue: string[];
    cycle: number;
    completedCycles: number;
    turn: number;
    retries: Record<string, RetryEntry>;
    struggles: Record<string, StruggleEntry>;
    userAnswered: Record<string, number>;
    botShown: Record<string, number>;
    lastBotItem: string | null;
    lastUserItem: string | null;
    current: Selection | null;
};
const shuffle = (ids: string[], random: () => number) => {
    const result = [...ids];
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
};
const hasRecognitionHistory = (memory: ItemMemoryState | undefined) => {
    const recognition = memory?.answerModeStats?.recognition;
    return Boolean(
        recognition &&
        recognition.attempts > 0 &&
        recognition.lastAttemptAt &&
        Number.isFinite(Date.parse(recognition.lastAttemptAt)),
    );
};
type SchedulerAnswerMode = "input" | "selection";
type ItemModes = Readonly<Record<string, SchedulerAnswerMode>>;
function reviewPriority(memory: ItemMemoryState | undefined, now: number, mode: SchedulerAnswerMode) {
    const choice = mode === "selection";
    const known = choice ? hasRecognitionHistory(memory) : Boolean(memory?.reviewCount);
    if (!known) return { group: 1, risk: 0, detail: 0, time: 0 };
    const retention = choice ? getRecognitionRetrievability(memory, now) : getRetrievability(memory, now);
    const stats = memory?.answerModeStats?.recognition;
    // Within five percentage points of recognition probability, use choice
    // accuracy and active response time to distinguish similarly urgent words.
    return {
        group: retention < MASTERY_RETRIEVABILITY_THRESHOLD ? 0 : 2,
        risk: Math.floor(retention * 20),
        detail: choice && stats ? -(getRecognitionFailureRate(stats) +
            getRecognitionSpeedAdjustment(stats.correctStreak ? stats.averageResponseMs : undefined)) : retention,
        time: choice && stats?.lastAttemptAt ? Date.parse(stats.lastAttemptAt) : -(memory?.difficulty ?? 5),
    };
}
function compareMemoryPriority(a: string, b: string, memories: Record<string, ItemMemoryState>,
    now: number, mode: SchedulerAnswerMode, modes?: ItemModes) {
    const left = reviewPriority(memories[a], now, modes?.[a] ?? mode);
    const right = reviewPriority(memories[b], now, modes?.[b] ?? mode);
    return left.group - right.group || left.risk - right.risk ||
        left.detail - right.detail || left.time - right.time;
}
export const createScheduler = (
    ids: string[],
    random = Math.random,
): SchedulerState => {
    const unique = [...new Set(ids)];
    return {
        itemIds: unique,
        cycleQueue: shuffle(unique, random),
        cycle: 1,
        completedCycles: 0,
        turn: 0,
        retries: {},
        struggles: {},
        userAnswered: {},
        botShown: {},
        lastBotItem: null,
        lastUserItem: null,
        current: null,
    };
};
// Reserve distinct even turns; odd turns remain available to advance the cycle.
// At most N entries exist, so latest <= answeredTurn + min(gap,N) + width + 2N.
export const retryWaitBound = (size: number, gap = CONFIRM_RETRY_GAP) =>
    Math.min(gap, size) + RETRY_WINDOW_WIDTH + CYCLE_STRIDE * size;
const enqueueRetry = (
    state: SchedulerState,
    itemId: string,
    reason: RetryEntry["reason"],
    successCount: number,
    gap: number,
) => {
    const earliestTurn = state.turn + Math.min(gap, state.itemIds.length);
    let latestTurn = earliestTurn + RETRY_WINDOW_WIDTH;
    if (latestTurn % CYCLE_STRIDE !== 0) latestTurn++;
    const reserved = new Set(
        Object.values(state.retries).map((entry) => entry.latestTurn),
    );
    while (reserved.has(latestTurn)) latestTurn += CYCLE_STRIDE;
    state.retries[itemId] = {
        itemId,
        earliestTurn,
        latestTurn,
        reason,
        successCount,
    };
};
const isOnHold = (state: SchedulerState, itemId: string) =>
    state.struggles[itemId]?.suspendedUntil != null;

/** Return a deadline only when every room word is on hold. */
export const nextSuspendedReviewAt = (state: SchedulerState): number | null => {
    if (
        state.itemIds.length === 0 ||
        state.itemIds.some((id) => !isOnHold(state, id))
    )
        return null;
    return Math.min(
        ...state.itemIds.map(
            (id) => state.struggles[id].suspendedUntil as number,
        ),
    );
};

// Count assisted/failed recalls, not typing mistakes or BOT-assisted attempts.
const trackStruggle = (
    state: SchedulerState,
    itemId: string,
    evaluation: AttemptEvaluation,
    now: number,
): boolean => {
    const previous = state.struggles[itemId] ?? {
        consecutiveFailures: 0,
        firstFailureAt: null,
        suspensionLevel: 0,
        suspendedUntil: null,
    };
    if (
        evaluation.retryNeed === "none" ||
        evaluation.memoryEvidence === "recall" ||
        evaluation.memoryEvidence === "strong_recall"
    ) {
        // A corrected typing error is still unaided recall. Confirm it again
        // in the short-term queue, but never count it as another failure.
        // One unaided recall unblocks the word, but repeated failures still
        // matter. Several successes are needed to fully erase its hold level.
        const level = Math.max(0, previous.suspensionLevel - 1);
        if (level === 0) delete state.struggles[itemId];
        else
            state.struggles[itemId] = {
                consecutiveFailures: 0,
                firstFailureAt: null,
                suspensionLevel: level,
                suspendedUntil: null,
            };
        return false;
    }
    if (!evaluation.independent) return false;

    const firstFailureAt = previous.firstFailureAt ?? now;
    const consecutiveFailures = previous.consecutiveFailures + 1;
    const required = previous.suspensionLevel
        ? REPEAT_SUSPENSION_FAILURES
        : INITIAL_SUSPENSION_FAILURES;
    const timeReady =
        previous.suspensionLevel > 0 ||
        now - firstFailureAt >= INITIAL_SUSPENSION_WINDOW_MS;
    if (consecutiveFailures < required || !timeReady) {
        state.struggles[itemId] = {
            ...previous,
            firstFailureAt,
            consecutiveFailures,
        };
        return false;
    }

    const level = Math.min(
        previous.suspensionLevel + 1,
        SUSPENSION_DELAYS_MS.length,
    );
    state.struggles[itemId] = {
        consecutiveFailures: 0,
        firstFailureAt: null,
        suspensionLevel: level,
        suspendedUntil: now + SUSPENSION_DELAYS_MS[level - 1],
    };
    // A held word must free its active relearning slot.
    delete state.retries[itemId];
    return true;
};

// A single independently corrected typo is still unaided retrieval. It can
// advance short-term confirmation without claiming a clean or spaced review.
const isMinorCorrectedRecall = (evaluation: AttemptEvaluation) =>
    evaluation.minorCorrection === true &&
    evaluation.independent &&
    evaluation.retryNeed === "confirm" &&
    evaluation.memoryEvidence === "recall";

export const recordUserAnswer = (
    state: SchedulerState,
    evaluation: AttemptEvaluation,
    now = Date.now(),
) => {
    const selected = state.current;
    if (!selected) return;
    state.userAnswered[selected.itemId] =
        (state.userAnswered[selected.itemId] ?? 0) + 1;
    // Holds protect repeatedly struggling words even when the room is too
    // small to supply other practice. Otherwise every answer updates the same
    // short-term retry state, independently of long-term memory evidence.
    if (
        selected.reason === "early_practice" &&
        state.struggles[selected.itemId]?.suspendedUntil != null
    ) {
        state.current = null;
        return;
    }
    if (trackStruggle(state, selected.itemId, evaluation, now)) {
        state.current = null;
        return;
    }
    const minorCorrection = isMinorCorrectedRecall(evaluation);
    const confidentCorrection = minorCorrection &&
        (evaluation.quality ?? 0) >= CONFIDENT_TYPO_QUALITY;
    if (
        !selected.retry &&
        evaluation.retryNeed !== "none" &&
        Object.keys(state.retries).length >= MAX_ACTIVE_RELEARNING
    ) {
        // Keep an unsuccessful filler available for ordinary review once a
        // slot opens, without displacing any of the active retries.
        if (!state.cycleQueue.includes(selected.itemId))
            state.cycleQueue.push(selected.itemId);
    } else if (evaluation.retryNeed === "short") {
        enqueueRetry(
            state,
            selected.itemId,
            evaluation.reason ?? "failed_recall",
            0,
            SHORT_RETRY_GAP,
        );
    } else if (selected.retry &&
        (evaluation.retryNeed === "none" || minorCorrection)) {
        const successes = selected.retry.successCount + 1;
        if (successes < REQUIRED_RETRY_SUCCESSES)
            enqueueRetry(
                state,
                selected.itemId,
                "uncertain_recall",
                successes,
                CONFIRM_RETRY_GAP,
            );
    } else if (evaluation.retryNeed === "confirm") {
        enqueueRetry(
            state,
            selected.itemId,
            "uncertain_recall",
            confidentCorrection ? 1 : 0,
            confidentCorrection ? CONFIRM_RETRY_GAP : SHORT_RETRY_GAP,
        );
    }
    state.current = null;
};

// Share the retry/struggle scheduler with typing; recognition updates its
// own stability within answer-mode stats, not free-recall stability.
export const recordRecognitionAnswer = (
    state: SchedulerState,
    itemId: string,
    hadMistake = false,
    now = Date.now(),
    exposureGapMs?: number | null,
): boolean => {
    const selected = state.current;
    if (!selected || selected.itemId !== itemId) return false;

    recordUserAnswer(
        state,
        evaluateRecognition(hadMistake, exposureGapMs),
        now,
    );
    return true;
};

/** One selection policy for offline practice and online learning prompts.
 * Retries are finite short-term tasks; ordinary turns consume a fair round.
 * Low predicted retention alone never inserts extra practice into that round.
 */
export const chooseNextUserItem = (
    state: SchedulerState,
    memories: Record<string, ItemMemoryState> = {},
    random = Math.random,
    now = Date.now(),
    mode: SchedulerAnswerMode = "input",
    modes?: ItemModes,
    observe?: DecisionObserver,
): Selection | null => {
    if (!state.itemIds.length) return null;
    if (state.current) return state.current;
    const schedulerBefore = observe ? structuredClone(state) : null;
    const randomDraws: number[] = [];
    const trackedRandom = observe ? () => { const value = random(); randomDraws.push(value); return value; } : random;
    let candidateOrder: string[] = [];
    const turn = state.turn + 1;
    const pending = Object.values(state.retries);
    const eligible = pending
        .filter(
            (entry) =>
                !isOnHold(state, entry.itemId) && entry.earliestTurn <= turn,
        )
        .sort((a, b) => a.latestTurn - b.latestTurn);
    if (observe) candidateOrder = eligible.map(entry => entry.itemId);
    let itemId = eligible[0]?.itemId;
    let reason: SchedulerReason = "retry";
    if (!itemId && pending.length < MAX_ACTIVE_RELEARNING) {
        const held = Object.entries(state.struggles)
            .filter(
                ([, entry]) =>
                    entry.suspendedUntil !== null &&
                    entry.suspendedUntil <= now,
            )
            .sort((a, b) => a[1].suspendedUntil! - b[1].suspendedUntil!)[0];
        if (held) {
            itemId = held[0];
            state.struggles[itemId].suspendedUntil = null;
            reason = "suspension_due";
        }
    }
    const known = (id: string) =>
        modes?.[id] === "selection" || (!modes?.[id] && mode === "selection")
            ? hasRecognitionHistory(memories[id])
            : Boolean(memories[id]?.reviewCount);
    // Active retries must not monopolize the entire session.
    // Introduce a new card at a bounded cadence (at most one in six turns),
    // even if difficult cards keep renewing their retry deadlines. The
    // preselected retry stays queued and will be considered on the next turn.
    // An expired suspension is never overwritten: its deadline and state
    // must be preserved until the suspended item is actually presented.
    if (pending.length > 0 &&
        turn % INTRODUCTION_STRIDE === 0 &&
        reason !== "suspension_due") {
        const nextUnseen = state.cycleQueue.find(id =>
            !known(id) && !state.retries[id] && !isOnHold(state, id));
        if (nextUnseen) {
            itemId = nextUnseen;
            reason = "cycle";
            if (observe) candidateOrder = [nextUnseen, ...candidateOrder];
        }
    }
    const due = (id: string) => {
        const at = getNextMemoryReviewAt(memories[id], modes?.[id] ?? mode);
        return known(id) && at !== null && at <= now;
    };
    // A word that has never demonstrated independent recall needs its first
    // *spaced* confirmation. Cycling it before that time repeatedly resets
    // the exposure interval, preventing its first anchor and keeping the
    // mastery graph below 100% even after many correct rehearsals.
    const awaitingFirstReview = (id: string) => {
        if (!known(id)) return false;
        const memory = memories[id];
        const effectiveMode = modes?.[id] ?? mode;
        const track = effectiveMode === "selection"
            ? memory?.answerModeStats?.recognition
            : memory?.answerModeStats?.recall;
        // A currently failed, not-yet-recovered word still needs ordinary
        // short-term relearning priority. Successful rehearsal without enough
        // spacing is the case we must protect from repeated cycle exposures.
        if (track?.attempts && track.correctStreak === 0) return false;
        return effectiveMode === "selection"
            ? !recognitionMemory(track).anchor
            : !memory?.lastReviewedAt;
    };
    const readyForRound = (id: string) =>
        !awaitingFirstReview(id) || due(id);
    if (!itemId) {
        if (!state.cycleQueue.length) {
            state.cycle++;
            state.cycleQueue = shuffle(state.itemIds, trackedRandom);
        }
        // A review that becomes genuinely due must remain eligible even if
        // its round entry was already consumed. The memory model uses the
        // latest exposure, so an immediate repeat cannot count as spaced.
        const pool = [...new Set([
            ...state.cycleQueue,
            ...state.itemIds.filter(due),
        ])];
        const candidates = pool.filter(
            (id) =>
                !state.retries[id] &&
                !isOnHold(state, id) &&
                readyForRound(id) &&
                (pending.length < MAX_ACTIVE_RELEARNING ||
                    known(id) ||
                    (state.userAnswered[id] ?? 0) > 0),
        );
        // Only useful spaced reviews precede new learning. Remaining practice
        // follows the saved round; ties never depend on a page reload.
        const group = (id: string) => (due(id) ? 0 : known(id) ? 2 : 1);
        const exposure = (id: string) =>
            Date.parse(
                memories[id]?.lastPresentedAt ??
                    memories[id]?.lastReviewedAt ??
                    "",
            ) || 0;
        candidates.sort(
            (a, b) =>
                group(a) - group(b) ||
                (group(a) === 2 ? exposure(a) - exposure(b) : 0) ||
                compareMemoryPriority(a, b, memories, now, mode, modes),
        );
        if (observe) candidateOrder = [...candidates];
        itemId = candidates[0];
        if (itemId === state.lastUserItem)
            itemId =
                candidates.find(
                    (id) =>
                        id !== state.lastUserItem &&
                        group(id) === group(itemId!),
                ) ?? itemId;
        if (itemId)
            reason = due(itemId)
                ? "long_term_due"
                : known(itemId)
                  ? "early_practice"
                  : "cycle";
    }
    if (!itemId) {
        // Bridge retry gaps without introducing more work. Least-practiced
        // fillers keep small rooms playable without a retention boost.
        const fillers = state.itemIds.filter(
            (id) =>
                !state.retries[id] &&
                !isOnHold(state, id) &&
                readyForRound(id) &&
                (known(id) || (state.userAnswered[id] ?? 0) > 0),
        );
        fillers.sort(
            (a, b) =>
                (state.userAnswered[a] ?? 0) - (state.userAnswered[b] ?? 0),
        );
        itemId = fillers.find((id) => id !== state.lastUserItem) ?? fillers[0];
        reason = "early_practice";
    }
    if (!itemId && pending.length) {
        itemId = [...pending].sort((a, b) => a.earliestTurn - b.earliestTurn)[0]
            .itemId;
        reason = "retry";
    }
    if (!itemId) {
        // No eligible spaced review or other filler exists (for example a
        // one-word room). Keep the session playable, without claiming that
        // the repeated exposure proves long-term retention. When multiple
        // waiting cards exist, rotate fairly rather than always taking the
        // first room item; prefer non-held and non-retry words if possible.
        const available = state.itemIds.filter(
            (id) => !state.retries[id] && !isOnHold(state, id),
        );
        const fallback = available.length ? available : [...state.itemIds];
        fallback.sort((a, b) =>
            (state.userAnswered[a] ?? 0) - (state.userAnswered[b] ?? 0) ||
            (Date.parse(memories[a]?.lastPresentedAt ?? "") || 0) -
                (Date.parse(memories[b]?.lastPresentedAt ?? "") || 0),
        );
        itemId =
            fallback.find((id) => id !== state.lastUserItem) ??
            fallback[0];
        reason = "early_practice";
    }
    const retry = state.retries[itemId];
    const advancesCycle = state.cycleQueue.includes(itemId);
    if (advancesCycle) {
        state.cycleQueue = state.cycleQueue.filter((id) => id !== itemId);
        if (!state.cycleQueue.length) state.completedCycles++;
    }
    delete state.retries[itemId];
    state.turn = turn;
    state.lastUserItem = itemId;
    state.current = {
        itemId,
        turn,
        cycle: state.cycle,
        reason,
        advancesCycle,
        ...(retry ? { retry } : {}),
    };
    if (observe && schedulerBefore) {
        try {
            const candidates = schedulerBefore.itemIds.map(id => {
                const effectiveMode = modes?.[id] ?? mode;
                const heldUntil = schedulerBefore.struggles[id]?.suspendedUntil ?? null;
                const pendingRetry = schedulerBefore.retries[id];
                const rank = candidateOrder.indexOf(id);
                const probability = effectiveMode === "selection"
                    ? getRecognitionRetrievability(memories[id], now)
                    : getRetrievability(memories[id], now);
                return { itemId: id, mode: effectiveMode,
                    introduced: (schedulerBefore.userAnswered[id] ?? 0) > 0,
                    stage: reason,
                    status: pendingRetry ? "pending_retry" : heldUntil !== null && heldUntil > now ? "held" :
                        candidateOrder.includes(id) ? "candidate" : "not_in_pool",
                    score: Number.isFinite(probability) ? probability : null,
                    ...(rank >= 0 ? { rank } : {}),
                    dueAt: getNextMemoryReviewAt(memories[id], effectiveMode),
                    exposureGapMs: getExposureGap(memories[id], effectiveMode, now) };
            });
            observe({ schemaVersion: 1, algorithmVersion: SCHEDULER_VERSION,
                selectedAt: now, schedulerBefore, candidates, randomDraws,
                selection: structuredClone(state.current) });
        } catch { /* Diagnostic failure must never change learning selection. */ }
    }
    return state.current;
};

/** Informational only; a future review never stops an active game. */
export const nextMemoryReviewAt = (
    state: SchedulerState,
    memories: Record<string, ItemMemoryState>,
    now: number,
    mode: SchedulerAnswerMode,
    modes?: ItemModes,
): number | null => {
    const times = state.itemIds
        .map(
            (id) =>
                state.struggles[id]?.suspendedUntil ??
                getNextMemoryReviewAt(memories[id], modes?.[id] ?? mode),
        )
        .filter((at): at is number => at !== null && at > now);
    return times.length ? Math.min(...times) : null;
};
export const chooseBotItem = (
    state: SchedulerState,
    random = Math.random,
): string | null => {
    // Skip held and pending-retry entries: neither can be the next cycle
    // question, so they must not consume one of the protected lookahead slots.
    const upcomingCycleItems = state.cycleQueue.filter(
        (id) => !isOnHold(state, id) && !state.retries[id],
    );
    const protectedIds = new Set(upcomingCycleItems.slice(0, BOT_LOOKAHEAD));
    for (const id of Object.keys(state.retries)) protectedIds.add(id);

    // Prefer words the user has already answered, while still avoiding upcoming
    // cycle/retry targets. This keeps BOT exposure from helping the next recall.
    const candidates = state.itemIds.filter(
        (id) =>
            (state.userAnswered[id] ?? 0) > 0 &&
            !protectedIds.has(id) &&
            !isOnHold(state, id),
    );
    const varied = candidates.filter((id) => id !== state.lastBotItem);
    const pool = varied.length ? varied : candidates;
    if (pool.length) {
        const least = Math.min(...pool.map((id) => state.botShown[id] ?? 0));
        const ties = pool.filter((id) => (state.botShown[id] ?? 0) === least);
        return ties[Math.floor(random() * ties.length)];
    }

    // Before the user has answered anything, keep the old behavior: skip the
    // BOT turn rather than reveal a learning target at session start.
    const hasUserHistory = Object.values(state.userAnswered).some(
        (count) => count > 0,
    );
    if (!hasUserHistory) return null;

    // Never let BOT reveal a previously unseen answer: this would silently
    // introduce a new word while the learner's relearning pool is full.
    // Tiny rooms can have every word protected. In that case reuse a random
    // word the user has already answered, so no new answer is revealed.
    const answeredFallback = state.itemIds.filter(
        (id) => (state.userAnswered[id] ?? 0) > 0 && !isOnHold(state, id),
    );
    const answeredVaried = answeredFallback.filter(
        (id) => id !== state.lastBotItem,
    );
    const answeredPool = answeredVaried.length
        ? answeredVaried
        : answeredFallback;
    return answeredPool.length
        ? answeredPool[Math.floor(random() * answeredPool.length)]
        : null;
};
export const recordBotPresentation = (
    state: SchedulerState,
    itemId: string,
) => {
    state.botShown[itemId] = (state.botShown[itemId] ?? 0) + 1;
    state.lastBotItem = itemId;
};

// The scheduler is a learning session, not a page lifecycle. Keep its cycle and
// pending reviews across reloads; memory rows remain the source of recall scores.
export type SchedulerMode = "playground" | "online";
const SCHEDULER_CACHE_VERSION = 1;
const INTERRUPTED_PROMPT_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const SCHEDULER_CACHE_MAX_AGE_MS = 30 * 86_400_000;

const schedulerKey = (mode: SchedulerMode, userId: string, roomId: string) =>
    `playground-scheduler:v1:${mode}:${userId}:${roomId}`;

const isNonNegativeInteger = (value: unknown): value is number =>
    Number.isSafeInteger(value) && typeof value === "number" && value >= 0;

const validStruggle = (value: unknown): StruggleEntry | null => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const entry = value as Partial<StruggleEntry>;
    const validTimestamp = (stamp: unknown) =>
        stamp === null ||
        (typeof stamp === "number" &&
            Number.isSafeInteger(stamp) &&
            stamp >= 0);
    if (
        !isNonNegativeInteger(entry.consecutiveFailures) ||
        !validTimestamp(entry.firstFailureAt) ||
        !isNonNegativeInteger(entry.suspensionLevel) ||
        entry.suspensionLevel > SUSPENSION_DELAYS_MS.length ||
        !validTimestamp(entry.suspendedUntil) ||
        (entry.suspensionLevel === 0 && entry.suspendedUntil !== null)
    )
        return null;
    return entry as StruggleEntry;
};

const validRetry = (value: unknown, id: string): RetryEntry | null => {
    if (!value || typeof value !== "object") return null;
    const entry = value as Partial<RetryEntry>;
    if (
        entry.itemId !== id ||
        !isNonNegativeInteger(entry.earliestTurn) ||
        !isNonNegativeInteger(entry.latestTurn) ||
        entry.latestTurn < entry.earliestTurn ||
        !isNonNegativeInteger(entry.successCount) ||
        entry.successCount >= REQUIRED_RETRY_SUCCESSES ||
        !["failed_recall", "heavy_hint", "uncertain_recall"].includes(
            entry.reason ?? "",
        )
    )
        return null;
    return entry as RetryEntry;
};

/** A failed storage write must never prevent someone from practicing. */
export const saveSchedulerState = (
    mode: SchedulerMode,
    userId: string,
    roomId: string,
    state: SchedulerState,
    now = Date.now(),
): void => {
    try {
        localStorage.setItem(
            schedulerKey(mode, userId, roomId),
            JSON.stringify({
                version: SCHEDULER_CACHE_VERSION,
                updatedAt: now,
                state,
            }),
        );
    } catch {
        // Private browsing, quota limits, etc. leave an in-memory scheduler.
    }
};

/**
 * Restore the remaining cycle and retry windows. After a long break,
 * release an unfinished prompt without crediting it. Selection re-evaluates
 * the remaining round against current memory without changing its saved order.
 * New room words join the queue; deleted words and invalid entries are discarded.
 */
export const loadSchedulerState = (
    mode: SchedulerMode,
    userId: string,
    roomId: string,
    itemIds: string[],
    now = Date.now(),
): SchedulerState | null => {
    try {
        const raw: unknown = JSON.parse(
            localStorage.getItem(schedulerKey(mode, userId, roomId)) ?? "null",
        );
        if (!raw || typeof raw !== "object") return null;
        const cache = raw as {
            version?: unknown;
            updatedAt?: unknown;
            state?: unknown;
        };
        if (
            cache.version !== SCHEDULER_CACHE_VERSION ||
            typeof cache.updatedAt !== "number" ||
            !Number.isFinite(cache.updatedAt) ||
            cache.updatedAt > now + 60_000 ||
            now - cache.updatedAt > SCHEDULER_CACHE_MAX_AGE_MS ||
            !cache.state ||
            typeof cache.state !== "object"
        )
            return null;

        const saved = cache.state as Partial<SchedulerState>;
        if (
            !Array.isArray(saved.itemIds) ||
            !Array.isArray(saved.cycleQueue) ||
            !isNonNegativeInteger(saved.turn) ||
            !isNonNegativeInteger(saved.cycle) ||
            saved.cycle < 1 ||
            !isNonNegativeInteger(saved.completedCycles) ||
            !saved.retries ||
            typeof saved.retries !== "object" ||
            Array.isArray(saved.retries)
        )
            return null;

        const ids = [...new Set(itemIds)];
        const allowed = new Set(ids);
        const previousIds = new Set(
            saved.itemIds.filter((id): id is string => typeof id === "string"),
        );
        const queue = new Set<string>();
        for (const id of saved.cycleQueue) {
            if (typeof id === "string" && allowed.has(id)) queue.add(id);
        }
        // Only newly added words are appended: old words already reviewed in
        // this cycle must not be reintroduced by the reconciliation.
        for (const id of ids) {
            if (!previousIds.has(id)) queue.add(id);
        }

        const retries: Record<string, RetryEntry> = {};
        for (const [id, entry] of Object.entries(saved.retries)) {
            if (!allowed.has(id)) continue;
            const valid = validRetry(entry, id);
            if (valid) retries[id] = valid;
        }

        // Version 1 snapshots predate word suspensions; they remain readable.
        const struggles: Record<string, StruggleEntry> = {};
        if (
            saved.struggles &&
            typeof saved.struggles === "object" &&
            !Array.isArray(saved.struggles)
        ) {
            for (const [id, entry] of Object.entries(saved.struggles)) {
                if (!allowed.has(id)) continue;
                const valid = validStruggle(entry);
                if (!valid) continue;
                struggles[id] = valid;
                if (valid.suspendedUntil !== null) delete retries[id];
            }
        }

        const readCounters = (source: unknown) => {
            const result: Record<string, number> = {};
            if (!source || typeof source !== "object" || Array.isArray(source))
                return result;
            for (const [id, value] of Object.entries(source)) {
                if (allowed.has(id) && isNonNegativeInteger(value))
                    result[id] = value;
            }
            return result;
        };

        let current: Selection | null = null;
        const selected = saved.current;
        if (
            selected &&
            typeof selected === "object" &&
            typeof selected.itemId === "string" &&
            allowed.has(selected.itemId) &&
            isNonNegativeInteger(selected.turn) &&
            selected.turn === saved.turn &&
            isNonNegativeInteger(selected.cycle) &&
            selected.cycle >= 1 &&
            typeof selected.advancesCycle === "boolean" &&
            [
                "cycle",
                "retry",
                "long_term_due",
                "suspension_due",
                "spaced_review",
                "early_practice",
            ].includes(selected.reason) &&
            (struggles[selected.itemId]?.suspendedUntil == null ||
                selected.reason === "early_practice")
        ) {
            const retry = selected.retry
                ? validRetry(selected.retry, selected.itemId)
                : null;
            // Never silently lose a pending retry from a damaged snapshot.
            if (!selected.retry || retry) {
                current = {
                    itemId: selected.itemId,
                    turn: selected.turn,
                    cycle: selected.cycle,
                    reason: selected.reason,
                    advancesCycle: selected.advancesCycle,
                    ...(retry ? { retry } : {}),
                };
                queue.delete(current.itemId);
                delete retries[current.itemId];
            }
        }

        const age = Math.max(0, now - cache.updatedAt);
        if (age >= INTERRUPTED_PROMPT_MAX_AGE_MS) {
            // A prompt interrupted hours ago is not a completed recall.
            if (current) {
                if (current.retry) retries[current.itemId] = current.retry;
                else queue.add(current.itemId);
                current = null;
            }
        }

        const cycleQueue = [...queue];
        return {
            itemIds: ids,
            cycleQueue,
            cycle: saved.cycle,
            completedCycles: saved.completedCycles,
            turn: saved.turn,
            retries,
            struggles,
            userAnswered: readCounters(saved.userAnswered),
            botShown: readCounters(saved.botShown),
            lastBotItem:
                typeof saved.lastBotItem === "string" &&
                allowed.has(saved.lastBotItem)
                    ? saved.lastBotItem
                    : null,
            lastUserItem:
                typeof saved.lastUserItem === "string" &&
                allowed.has(saved.lastUserItem)
                    ? saved.lastUserItem
                    : null,
            current,
        };
    } catch {
        // Ignore corrupted/inaccessible state and start a normal session.
        return null;
    }
};
