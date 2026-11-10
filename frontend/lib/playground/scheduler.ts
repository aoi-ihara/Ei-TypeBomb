import {
    getRetrievability,
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
export const BOT_LOOKAHEAD = 3;
// Do not introduce more words while this many still need recall practice.
export const MAX_ACTIVE_RELEARNING = 4;
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
    lastUserItem: string | null;
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
        lastUserItem: null,
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
    if (state.current) return state.current;

    if (!state.initialPriorityApplied) {
        state.cycleQueue = state.cycleQueue.sort((a, b) =>
            compareMemoryPriority(a, b, memories, now),
        );
        state.initialPriorityApplied = true;
    }

    const turn = state.turn + 1;
    const pending = Object.values(state.retries);
    const eligible = pending
        .filter((entry) => entry.earliestTurn <= turn)
        .sort((a, b) => a.latestTurn - b.latestTurn);

    // A due relearning item always beats an unseen item. The old alternating
    // cycle/retry schedule introduced new words even when learners struggled.
    let itemId: string | undefined = eligible[0]?.itemId;

    const pickFromCycle = () => {
        if (state.cycleQueue.length === 0) {
            state.cycle++;
            state.cycleQueue = shuffle(state.itemIds, random).sort((a, b) =>
                compareMemoryPriority(a, b, memories, now),
            );
        }
        return state.cycleQueue.find((id) => !state.retries[id]);
    };

    if (!itemId && pending.length < Math.min(MAX_ACTIVE_RELEARNING, state.itemIds.length)) {
        itemId = pickFromCycle();
        // If the new cycle contains only pending words, choose a previously
        // answered filler instead of breaking the earliest-retry boundary.
    }

    // When the active pool is full, any unanswered filler can fail and add
    // a fifth pending retry. Stay inside the pool until a slot clears.
    if (!itemId && pending.length >= Math.min(MAX_ACTIVE_RELEARNING, state.itemIds.length)) {
        itemId = [...pending].sort((a, b) =>
            a.earliestTurn - b.earliestTurn
        )[0]?.itemId;
    }

    if (!itemId) {
        const fillers = state.itemIds.filter(
            (id) => (state.userAnswered[id] ?? 0) > 0 && !state.retries[id],
        );
        const varied = fillers.filter((id) => id !== state.lastUserItem);
        const pool = varied.length ? varied : fillers;
        if (pool.length) {
            const least = Math.min(...pool.map((id) => state.userAnswered[id] ?? 0));
            const ties = pool.filter((id) => (state.userAnswered[id] ?? 0) === least);
            itemId = ties[Math.floor(random() * ties.length)];
        }
    }

    // Tiny rooms can have every word protected. Reuse the earliest pending
    // word instead of failing to schedule a question.
    if (!itemId && pending.length) {
        itemId = [...pending].sort(
            (a, b) => a.earliestTurn - b.earliestTurn,
        )[0]?.itemId;
    }
    if (!itemId) itemId = pickFromCycle();
    if (!itemId) throw new Error("Scheduler has no feasible question");

    const entry = state.retries[itemId];
    const advancesCycle = state.cycleQueue.includes(itemId);
    if (advancesCycle) {
        state.cycleQueue = state.cycleQueue.filter((id) => id !== itemId);
        if (state.cycleQueue.length === 0) state.completedCycles++;
    }
    delete state.retries[itemId];
    state.turn = turn;
    state.lastUserItem = itemId;
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

    // Never let BOT reveal a previously unseen answer: this would silently
    // introduce a new word while the learner's relearning pool is full.
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


// The scheduler is a learning session, not a page lifecycle. Keep its cycle and
// pending reviews across reloads; memory rows remain the source of recall scores.
export type SchedulerMode = "playground" | "online";
const SCHEDULER_CACHE_VERSION = 1;
const PRIORITY_REFRESH_MS = 6 * 60 * 60 * 1000;
const SCHEDULER_CACHE_MAX_AGE_MS = 30 * 86_400_000;

const schedulerKey = (mode: SchedulerMode, userId: string, roomId: string) =>
    `playground-scheduler:v1:${mode}:${userId}:${roomId}`;

const isNonNegativeInteger = (value: unknown): value is number =>
    Number.isSafeInteger(value) && typeof value === "number" && value >= 0;

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
 * Restore the exact upcoming order and retry windows. After a long break,
 * release an unfinished prompt (without crediting it) and re-rank remaining
 * cycle items by current retrievability. New room words join the queue while
 * deleted words and invalid cached entries are discarded.
 */
export const loadSchedulerState = (
    mode: SchedulerMode,
    userId: string,
    roomId: string,
    itemIds: string[],
    memories: Record<string, ItemMemoryState> = {},
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
            saved.itemIds.filter(
                (id): id is string => typeof id === "string",
            ),
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
            ["cycle", "retry", "long_term_due"].includes(selected.reason)
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
        if (age >= PRIORITY_REFRESH_MS) {
            // A prompt interrupted hours ago is not a completed recall.
            if (current) {
                if (current.retry) retries[current.itemId] = current.retry;
                else queue.add(current.itemId);
                current = null;
            }
        }

        const cycleQueue = [...queue];
        if (age >= PRIORITY_REFRESH_MS) {
            cycleQueue.sort((a, b) =>
                compareMemoryPriority(a, b, memories, now),
            );
        }

        return {
            itemIds: ids,
            cycleQueue,
            cycle: saved.cycle,
            completedCycles: saved.completedCycles,
            turn: saved.turn,
            retries,
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
            initialPriorityApplied:
                age >= PRIORITY_REFRESH_MS
                    ? true
                    : saved.initialPriorityApplied === true,
            current,
        };
    } catch {
        // Ignore corrupted/inaccessible state and start a normal session.
        return null;
    }
};
