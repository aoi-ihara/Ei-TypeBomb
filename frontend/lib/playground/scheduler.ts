import {
    getRetrievability,
    type AttemptEvaluation,
    type ItemMemoryState,
    type SchedulerReason,
} from "./memory";

// Product hypotheses. Turns count USER questions only, never BOT presentations.
export const SHORT_RETRY_GAP = 5;
export const CONFIRM_RETRY_GAP = 8;
export const RETRY_WINDOW_WIDTH = 3;
export const CYCLE_STRIDE = 2;
export const REQUIRED_RETRY_SUCCESSES = 2;
export const BOT_LOOKAHEAD = 3;
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
    userAnswered: Record<string, number>;
    botShown: Record<string, number>;
    lastBotItem: string | null;
    initialPriorityApplied: boolean;
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
const hasRecallHistory = (memory: ItemMemoryState | undefined) =>
    Boolean(
        memory &&
        memory.reviewCount > 0 &&
        memory.lastReviewedAt &&
        Number.isFinite(Date.parse(memory.lastReviewedAt)),
    );
const compareMemoryPriority = (
    a: string,
    b: string,
    memories: Record<string, ItemMemoryState>,
    now: number,
) => {
    const aMemory = memories[a];
    const bMemory = memories[b];
    const aHasHistory = hasRecallHistory(aMemory);
    const bHasHistory = hasRecallHistory(bMemory);

    // A never-reviewed word has no meaningful retrievability prediction.
    // Review known words first, then introduce untouched words in shuffled order.
    if (aHasHistory !== bHasHistory) return aHasHistory ? -1 : 1;
    if (!aHasHistory || !bHasHistory) return 0;

    const retrievabilityDifference =
        getRetrievability(aMemory, now) - getRetrievability(bMemory, now);
    if (retrievabilityDifference !== 0) return retrievabilityDifference;
    return (bMemory?.difficulty ?? 5) - (aMemory?.difficulty ?? 5);
};
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
        userAnswered: {},
        botShown: {},
        lastBotItem: null,
        initialPriorityApplied: false,
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
export const recordUserAnswer = (
    state: SchedulerState,
    evaluation: AttemptEvaluation,
) => {
    const selected = state.current;
    if (!selected) return;
    state.userAnswered[selected.itemId] =
        (state.userAnswered[selected.itemId] ?? 0) + 1;
    if (evaluation.retryNeed === "short") {
        enqueueRetry(
            state,
            selected.itemId,
            evaluation.reason ?? "failed_recall",
            0,
            SHORT_RETRY_GAP,
        );
    } else if (
        selected.retry &&
        evaluation.retryNeed === "none" &&
        evaluation.independent
    ) {
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
            0,
            SHORT_RETRY_GAP,
        );
    }
    state.current = null;
};

export const chooseNextUserItem = (
    state: SchedulerState,
    memories: Record<string, ItemMemoryState> = {},
    random = Math.random,
    now = Date.now(),
): Selection | null => {
    if (state.itemIds.length === 0) return null;
    if (state.current) return state.current; // Idempotent until the answer is recorded.
    if (!state.initialPriorityApplied) {
        // The initial queue is already Fisher–Yates shuffled. A stable sort
        // preserves that randomness for ties while bringing reviewed, due
        // words forward on returning sessions.
        state.cycleQueue = state.cycleQueue.sort((a, b) =>
            compareMemoryPriority(a, b, memories, now),
        );
        state.initialPriorityApplied = true;
    }
    if (state.cycleQueue.length === 0) {
        state.cycle++;
        // Every cycle still includes every room item. Randomized ties prevent
        // equal-priority words from becoming a fixed sequence.
        state.cycleQueue = shuffle(state.itemIds, random).sort((a, b) =>
            compareMemoryPriority(a, b, memories, now),
        );
    }
    const turn = state.turn + 1;
    const eligible = Object.values(state.retries)
        .filter((entry) => entry.earliestTurn <= turn)
        .sort((a, b) => a.latestTurn - b.latestTurn);
    const forced = eligible.find((entry) => entry.latestTurn <= turn);
    const cycleId = state.cycleQueue.find(
        (id) => !state.retries[id] || state.retries[id].earliestTurn <= turn,
    );
    const retry =
        forced ?? (turn % CYCLE_STRIDE === 0 ? eligible[0] : undefined);
    const itemId = retry?.itemId ?? cycleId ?? eligible[0]?.itemId;
    if (!itemId) throw new Error("Scheduler has no feasible question");
    const entry = state.retries[itemId];
    const advancesCycle = state.cycleQueue.includes(itemId);
    if (advancesCycle) {
        state.cycleQueue = state.cycleQueue.filter((id) => id !== itemId);
        if (state.cycleQueue.length === 0) state.completedCycles++;
    }
    delete state.retries[itemId];
    state.turn = turn;
    state.current = {
        itemId,
        turn,
        cycle: state.cycle,
        advancesCycle,
        retry: entry,
        reason: entry
            ? "retry"
            : hasRecallHistory(memories[itemId]) &&
                getRetrievability(memories[itemId], now) < 0.8
              ? "long_term_due"
              : "cycle",
    };
    return state.current;
};
export const chooseBotItem = (
    state: SchedulerState,
    random = Math.random,
): string | null => {
    const protectedIds = new Set(state.cycleQueue.slice(0, BOT_LOOKAHEAD));
    for (const id of Object.keys(state.retries)) protectedIds.add(id);

    // Prefer words the user has already answered, while still avoiding upcoming
    // cycle/retry targets. This keeps BOT exposure from helping the next recall.
    const candidates = state.itemIds.filter(
        (id) => (state.userAnswered[id] ?? 0) > 0 && !protectedIds.has(id),
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

    // If the strict pool is empty, keep the turn handoff alive by choosing a
    // random non-protected word. It may be unseen, but it is outside the
    // immediate lookahead/retry set.
    const safeFallback = state.itemIds.filter(
        (id) => !protectedIds.has(id) && id !== state.lastBotItem,
    );
    const safePool = safeFallback.length
        ? safeFallback
        : state.itemIds.filter((id) => !protectedIds.has(id));
    if (safePool.length)
        return safePool[Math.floor(random() * safePool.length)];

    // Tiny rooms can have every word protected. In that case reuse a random
    // word the user has already answered, so no new answer is revealed.
    const answeredFallback = state.itemIds.filter(
        (id) => (state.userAnswered[id] ?? 0) > 0,
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
