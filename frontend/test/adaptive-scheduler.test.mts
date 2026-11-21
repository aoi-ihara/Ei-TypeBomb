import assert from "node:assert/strict";
import test from "node:test";
import {
    createInitialMemory,
    evaluateRecall,
    type ItemMemoryState,
} from "../lib/playground/memory";
import {
    createScheduler,
    chooseNextUserItem,
    recordUserAnswer,
    saveSchedulerState,
    loadSchedulerState,
    nextAdaptiveReviewAt,
} from "../lib/playground/scheduler";

const time = Date.parse("2026-11-21T00:00:00.000Z");
const hour = 60 * 60_000;
const choose = (
    state: ReturnType<typeof createScheduler>,
    memories: Record<string, ItemMemoryState> = {},
    at = time,
    mode: "input" | "selection" = "input",
) => chooseNextUserItem(state, memories, () => 0.5, at, mode, undefined, "adaptive");

function reviewed(id: string, stability: number, ageHours: number): ItemMemoryState {
    const lastReviewedAt = new Date(time - ageHours * hour).toISOString();
    return {
        ...createInitialMemory("u", "r", id),
        stability,
        reviewCount: 2,
        lastReviewedAt,
        lastPresentedAt: lastReviewedAt,
    };
}

const success = evaluateRecall({
    success: true,
    answerLength: 4,
    firstAttemptCorrect: true,
    attemptCount: 1,
    hintCount: 0,
    revealedHintChars: 0,
    maxCorrectPrefixLength: 4,
    recallLatencyMs: 500,
    elapsedMs: 1200,
});

test("due long-term review with lower predicted recall comes first", () => {
    const state = createScheduler(["strong", "weak", "new"], () => 0.5);
    const memories = {
        strong: reviewed("strong", 3, 48),
        weak: reviewed("weak", 0.5, 48),
    };
    const first = choose(state, memories);
    assert.equal(first?.itemId, "weak");
    assert.equal(first?.reason, "long_term_due");
    recordUserAnswer(state, success, time);
    assert.equal(choose(state, memories)?.itemId, "strong");
});

test("due short retry has priority over due reviews and new words", () => {
    const state = createScheduler(["retry", "review", "new"], () => 0.5);
    state.turn = 4;
    state.retries.retry = {
        itemId: "retry",
        earliestTurn: 5,
        latestTurn: 8,
        reason: "failed_recall",
        successCount: 0,
    };
    const selected = choose(state, { review: reviewed("review", 0.2, 48) });
    assert.equal(selected?.itemId, "retry");
    assert.equal(selected?.reason, "retry");
});

test("at most eight unseen words are introduced in one offline session", () => {
    const state = createScheduler(Array.from({ length: 20 }, (_, i) => `w-${i}`), () => 0.5);
    const seen = new Set<string>();
    for (let index = 0; index < 8; index++) {
        const selected = choose(state);
        assert.equal(selected?.reason, "cycle");
        assert(selected?.itemId);
        seen.add(selected.itemId);
        recordUserAnswer(state, success, time);
    }
    assert.equal(seen.size, 8);
    assert.equal(state.introduced.length, 8);
    assert.equal(choose(state), null);
});

test("no review is scheduled early merely to fill the session", () => {
    const state = createScheduler(["known"], () => 0.5);
    const memory = reviewed("known", 8, 1);
    const memories = { known: memory };
    assert.equal(choose(state, memories), null);
    const next = nextAdaptiveReviewAt(state, memories, time, "input");
    assert(next !== null && next > time);
});

test("a recently shown overdue word supplies a future cooldown deadline", () => {
    const state = createScheduler(["recent"], () => 0.5);
    const memory = {
        ...reviewed("recent", 0.2, 48),
        lastPresentedAt: new Date(time - 30_000).toISOString(),
    };
    const memories = { recent: memory };
    assert.equal(choose(state, memories), null);
    assert.equal(
        nextAdaptiveReviewAt(state, memories, time, "input"),
        time + 90_000,
    );
});

test("mode-specific recognition history does not count as typed recall", () => {
    const state = createScheduler(["known", "unseen"], () => 0.5);
    const typed = reviewed("known", 0.2, 24);
    const selected = choose(state, { known: typed }, time, "selection");
    assert.equal(selected?.reason, "cycle");
});

test("no new word is introduced when four retries are still active", () => {
    const ids = ["one", "two", "three", "four", "new"];
    const state = createScheduler(ids, () => 0.5);
    for (const id of ids.slice(0, 4)) {
        state.retries[id] = {
            itemId: id,
            earliestTurn: 100,
            latestTurn: 103,
            reason: "failed_recall",
            successCount: 0,
        };
    }
    const selected = choose(state);
    assert.notEqual(selected?.itemId, "new");
    assert.equal(selected?.reason, "retry");
});

test("a previously selected unfinished question remains stable", () => {
    const state = createScheduler(["a", "b"], () => 0.5);
    const first = choose(state);
    const second = choose(state, {}, time + 1000);
    assert.deepEqual(second, first);
});

test("introduced-word count survives a reload", () => {
    const data = new Map<string, string>();
    const previousStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => { data.set(key, value); },
        },
    });
    try {
        const state = createScheduler(["a", "b"], () => 0.5);
        state.introduced = ["a"];
        saveSchedulerState("playground", "u", "r", state, time);
        const restored = loadSchedulerState(
            "playground", "u", "r", ["a", "b"], {}, time + 1000,
        );
        assert.deepEqual(restored?.introduced, ["a"]);
    } finally {
        Object.defineProperty(globalThis, "localStorage", {
            configurable: true,
            value: previousStorage,
        });
    }
});
