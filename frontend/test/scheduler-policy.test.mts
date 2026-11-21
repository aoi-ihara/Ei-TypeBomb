import assert from "node:assert/strict";
import test from "node:test";
import {
    createInitialMemory,
    getReviewIntervalMs,
    recordAnswerExposure,
    recordAnswerModeResult,
    applyRecallObservation,
    evaluateRecall,
    getRecallQuality,
    type ItemMemoryState,
} from "../lib/playground/memory";
import {
    createScheduler,
    chooseNextUserItem,
    recordUserAnswer,
    saveSchedulerState,
    loadSchedulerState,
    nextMemoryReviewAt,
} from "../lib/playground/scheduler";

const time = Date.parse("2026-11-21T00:00:00.000Z");
const hour = 60 * 60_000;
const choose = (
    state: ReturnType<typeof createScheduler>,
    memories: Record<string, ItemMemoryState> = {},
    at = time,
    mode: "input" | "selection" = "input",
) => chooseNextUserItem(state, memories, () => 0.5, at, mode);

function reviewed(
    id: string,
    stability: number,
    ageHours: number,
): ItemMemoryState {
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

test("successful new learning continues beyond eight words without restarting", () => {
    const state = createScheduler(
        Array.from({ length: 20 }, (_, i) => `w-${i}`),
        () => 0.5,
    );
    const seen = new Set<string>();
    for (let index = 0; index < 20; index++) {
        const selected = choose(state);
        assert.equal(selected?.reason, "cycle");
        assert(selected?.itemId);
        assert(!seen.has(selected.itemId));
        seen.add(selected.itemId);
        recordUserAnswer(state, success, time);
    }
    assert.equal(seen.size, 20);
    assert.equal(state.completedCycles, 1);
    assert(choose(state));
});

test("early practice chooses the least recently exposed word without pausing", () => {
    const state = createScheduler(["strong", "weak"], () => 0.5);
    const memories = {
        strong: reviewed("strong", 8, 1),
        weak: reviewed("weak", 8, 2),
    };
    const selection = choose(state, memories);
    assert.equal(selection?.itemId, "weak");
    assert.equal(selection?.reason, "early_practice");
    const next = nextMemoryReviewAt(state, memories, time, "input");
    assert(next !== null && next > time);
});

test("a recently shown overdue word supplies a future cooldown deadline", () => {
    const state = createScheduler(["recent"], () => 0.5);
    const memory = {
        ...reviewed("recent", 0.2, 48),
        lastPresentedAt: new Date(time - 30_000).toISOString(),
    };
    const memories = { recent: memory };
    assert.equal(choose(state, memories)?.reason, "early_practice");
    assert.equal(
        nextMemoryReviewAt(state, memories, time, "input"),
        time - 30_000 + getReviewIntervalMs(memory.stability, true),
    );
});

test("recent exposures are deprioritized when older alternatives exist", () => {
    const state = createScheduler(["older", "recent"], () => 0.5);
    const memories = {
        older: reviewed("older", 8, 1),
        recent: {
            ...reviewed("recent", 8, 2),
            lastPresentedAt: new Date(time - 5_000).toISOString(),
        },
    };
    assert.equal(choose(state, memories)?.itemId, "older");
});

test("a held word is practiced only as last resort without clearing its hold", () => {
    const state = createScheduler(["held"], () => 0.5);
    state.struggles.held = {
        consecutiveFailures: 0,
        firstFailureAt: null,
        suspensionLevel: 2,
        suspendedUntil: time + hour,
    };
    const memory = reviewed("held", 8, 1);
    const selection = choose(state, { held: memory });
    assert.equal(selection?.reason, "early_practice");
    assert.equal(selection?.itemId, "held");
    recordUserAnswer(state, success, time);
    assert.equal(state.struggles.held.suspendedUntil, time + hour);
    assert.equal(state.struggles.held.suspensionLevel, 2);
});

test("early recalled typing never resets the spaced memory anchor", () => {
    const previous = reviewed("typed", 8, 1);
    const updated = applyRecallObservation({
        memory: previous,
        observation: {
            success: true,
            answerLength: 5,
            firstAttemptCorrect: true,
            attemptCount: 1,
            hintCount: 0,
            revealedHintChars: 0,
            maxCorrectPrefixLength: 5,
            recallLatencyMs: 700,
            elapsedMs: 1200,
            elapsedSincePresentationMs: hour,
            schedulerReason: "early_practice",
        },
        userId: "u", roomId: "r", itemId: "typed", now: new Date(time),
    });
    assert(updated.stability > previous.stability);
    assert(updated.stability - previous.stability < 0.02);
    assert.equal(updated.lastReviewedAt, previous.lastReviewedAt);
    assert.equal(updated.difficulty, previous.difficulty);
    assert.equal(updated.reviewCount, previous.reviewCount + 1);
});

test("even normal correct recalls cannot strengthen an unduly recent anchor", () => {
    const previous = reviewed("typed", 8, 1);
    const updated = applyRecallObservation({
        memory: previous,
        observation: {
            success: true,
            answerLength: 5,
            firstAttemptCorrect: true,
            attemptCount: 1,
            hintCount: 0,
            revealedHintChars: 0,
            maxCorrectPrefixLength: 5,
            recallLatencyMs: 700,
            elapsedMs: 1200,
            elapsedSincePresentationMs: hour,
            schedulerReason: "long_term_due",
        },
        userId: "u", roomId: "r", itemId: "typed", now: new Date(time),
    });
    assert(updated.stability > previous.stability);
    assert(updated.stability - previous.stability < 0.02);
    assert.equal(updated.lastReviewedAt, previous.lastReviewedAt);
});

test("early recognition success does not move the long-term reference date", () => {
    const first = recordAnswerModeResult({
        memory: undefined,
        userId: "u",
        roomId: "r",
        itemId: "choice",
        mode: "selection",
        success: true,
        now: new Date(time - hour),
    });
    const early = recordAnswerModeResult({
        memory: first,
        userId: "u",
        roomId: "r",
        itemId: "choice",
        mode: "selection",
        success: true,
        exposureGapMs: hour,
        now: new Date(time),
    });
    const previous = first.answerModeStats!.recognition;
    const after = early.answerModeStats!.recognition;
    assert(after.stability! > previous.stability!);
    assert(after.stability! - previous.stability! < 0.02);
    assert.equal(after.lastReviewedAt, previous.lastReviewedAt);
    assert.equal(after.attempts, previous.attempts + 1);
    const younger = recordAnswerModeResult({
        memory: undefined,
        userId: "u",
        roomId: "r",
        itemId: "choice",
        mode: "selection",
        success: true,
        now: new Date(time - hour),
    });
    const undue = recordAnswerModeResult({
        memory: younger,
        userId: "u",
        roomId: "r",
        itemId: "choice",
        mode: "selection",
        success: true,
        exposureGapMs: hour,
        now: new Date(time),
    });
    assert.equal(
        undue.answerModeStats!.recognition.lastReviewedAt,
        younger.answerModeStats!.recognition.lastReviewedAt,
    );
});

test("an actually due typing recall can strengthen memory when spaced", () => {
    const previous = reviewed("due", 0.3, 4);
    const updated = applyRecallObservation({
        memory: previous,
        observation: {
            success: true,
            answerLength: 3,
            firstAttemptCorrect: true,
            attemptCount: 1,
            hintCount: 0,
            revealedHintChars: 0,
            maxCorrectPrefixLength: 3,
            recallLatencyMs: 700,
            elapsedMs: 1300,
            elapsedSincePresentationMs: 4 * hour,
            schedulerReason: "long_term_due",
        },
        userId: "u", roomId: "r", itemId: "due", now: new Date(time),
    });
    assert(updated.stability > previous.stability);
    assert.equal(updated.lastReviewedAt, new Date(time).toISOString());
});

test("an overdue card cannot gain stability after very recent extra practice", () => {
    const previous = {
        ...reviewed("overdue", 0.3, 72),
        lastPresentedAt: new Date(time - 5 * 60_000).toISOString(),
    };
    const updated = applyRecallObservation({
        memory: previous,
        observation: {
            success: true,
            answerLength: 4,
            firstAttemptCorrect: true,
            attemptCount: 1,
            hintCount: 0,
            revealedHintChars: 0,
            maxCorrectPrefixLength: 4,
            recallLatencyMs: 600,
            elapsedMs: 1100,
            elapsedSincePresentationMs: 5 * 60_000,
            schedulerReason: "long_term_due",
        },
        userId: "u", roomId: "r", itemId: "overdue", now: new Date(time),
    });
    assert(updated.stability > previous.stability);
    assert(updated.stability - previous.stability < 0.002);
    assert.equal(updated.lastReviewedAt, previous.lastReviewedAt);
});

test("overdue recognition does not gain stability from a recent exposure", () => {
    const first = recordAnswerModeResult({
        memory: undefined,
        userId: "u",
        roomId: "r",
        itemId: "choice",
        mode: "selection",
        success: true,
        now: new Date(time - 72 * hour),
    });
    const practiced = recordAnswerExposure(first, new Date(time - 5 * 60_000));
    const updated = recordAnswerModeResult({
        memory: practiced,
        userId: "u",
        roomId: "r",
        itemId: "choice",
        mode: "selection",
        success: true,
        exposureGapMs: 5 * 60_000,
        now: new Date(time),
    });
    assert.equal(
        updated.answerModeStats?.recognition.lastReviewedAt,
        first.answerModeStats?.recognition.lastReviewedAt,
    );
    assert(
        updated.answerModeStats!.recognition.stability! >
        first.answerModeStats!.recognition.stability!,
    );
    assert(
        updated.answerModeStats!.recognition.stability! -
        first.answerModeStats!.recognition.stability! < 0.002,
    );
});

test("switching modes immediately never creates a new recall memory anchor", () => {
    const recognized = recordAnswerModeResult({
        memory: undefined, userId: "u", roomId: "r", itemId: "switch",
        mode: "selection", success: true,
        now: new Date(time - 5_000),
    });
    const typed = applyRecallObservation({
        memory: recognized,
        observation: {
            success: true,
            answerLength: 3,
            firstAttemptCorrect: true,
            attemptCount: 1,
            hintCount: 0,
            revealedHintChars: 0,
            maxCorrectPrefixLength: 3,
            recallLatencyMs: 700,
            elapsedMs: 1300,
            elapsedSincePresentationMs: 5_000,
            schedulerReason: "cycle",
        },
        userId: "u", roomId: "r", itemId: "switch", now: new Date(time),
    });
    assert.equal(typed.lastReviewedAt, null);
    assert.equal(typed.stability, recognized.stability);

    const initial = applyRecallObservation({
        memory: undefined,
        observation: {
            success: true, answerLength: 3, firstAttemptCorrect: true,
            attemptCount: 1, hintCount: 0, revealedHintChars: 0,
            maxCorrectPrefixLength: 3, recallLatencyMs: 700,
            elapsedMs: 1300, schedulerReason: "cycle",
        },
        userId: "u", roomId: "r", itemId: "typed", now: new Date(time - 5_000),
    });
    const chosen = recordAnswerModeResult({
        memory: initial, userId: "u", roomId: "r", itemId: "typed",
        mode: "selection", success: true, now: new Date(time),
        exposureGapMs: 5_000,
    });
    assert.equal(chosen.answerModeStats?.recognition.lastReviewedAt, null);
});

test("mode-specific recognition history does not count as typed recall", () => {
    const state = createScheduler(["known", "unseen"], () => 0.5);
    const typed = reviewed("known", 0.2, 24);
    const selected = choose(state, { known: typed }, time, "selection");
    assert.equal(selected?.reason, "cycle");
});

test("a recognized word stays eligible when switching to typed recall", () => {
    const selectedMemory = recordAnswerModeResult({
        memory: undefined,
        userId: "u",
        roomId: "r",
        itemId: "switched",
        mode: "selection",
        success: true,
        now: new Date(time - hour),
        exposureGapMs: hour,
    });
    const state = createScheduler(["switched"], () => 0.5);
    state.userAnswered.switched = 1; // Shared with the other answer mode.
    state.cycleQueue = []; // A prior session already consumed this word.
    const selected = choose(state, { switched: selectedMemory }, time, "input");
    assert.equal(selected?.itemId, "switched");
    assert.equal(selected?.reason, "cycle");
});

test("a recalled word stays eligible when switching to recognition", () => {
    const state = createScheduler(["switched"], () => 0.5);
    state.userAnswered.switched = 2;
    state.cycleQueue = [];
    const selected = choose(
        state, { switched: reviewed("switched", 3, 1) }, time, "selection",
    );
    assert.equal(selected?.itemId, "switched");
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

test("legacy introduction budget is discarded while queue and progress survive a reload", () => {
    const data = new Map<string, string>();
    const previousStorage = Object.getOwnPropertyDescriptor(
        globalThis,
        "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => {
                data.set(key, value);
            },
        },
    });
    try {
        const state = createScheduler(["a", "b"], () => 0.5);
        Object.assign(state, { introduced: ["a"] });
        state.userAnswered.a = 2;
        state.cycleQueue = ["b"];
        saveSchedulerState("playground", "u", "r", state, time);
        const restored = loadSchedulerState(
            "playground",
            "u",
            "r",
            ["a", "b"],
            time + 1000,
        );
        assert.deepEqual(restored?.cycleQueue, ["b"]);
        assert.equal(restored?.userAnswered.a, 2);
        assert.equal("introduced" in restored!, false);
    } finally {
        if (previousStorage)
            Object.defineProperty(globalThis, "localStorage", previousStorage);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
});

test("unfinished early rehearsal survives legacy cache migration, including held words", () => {
    const data = new Map<string, string>();
    const descriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => data.set(key, value),
        },
    });
    try {
        const state = createScheduler(["held"], () => 0.5);
        state.struggles.held = {
            consecutiveFailures: 0,
            firstFailureAt: null,
            suspensionLevel: 2,
            suspendedUntil: time + hour,
        };
        const current = choose(state, { held: reviewed("held", 8, 1) })!;
        assert.equal(current.reason, "early_practice");
        Object.assign(state, {
            introduced: ["held"],
            initialPriorityApplied: true,
            priorityAnswerMode: "input",
        });
        saveSchedulerState("playground", "u", "r", state, time);
        const restored = loadSchedulerState(
            "playground",
            "u",
            "r",
            ["held"],
            time + 1000,
        )!;
        assert.deepEqual(restored.current, current);
        assert.deepEqual(restored.struggles, state.struggles);
        assert.equal(choose(restored), restored.current);
        recordUserAnswer(restored, success, time + 1000);
        assert.equal(restored.struggles.held.suspendedUntil, time + hour);
    } finally {
        if (descriptor)
            Object.defineProperty(globalThis, "localStorage", descriptor);
        else Reflect.deleteProperty(globalThis, "localStorage");
    }
});

test("legacy recognition stability is interpreted consistently on the first new write", () => {
    const memory = createInitialMemory("u", "r", "legacy");
    const at = new Date(time - 60_000).toISOString();
    memory.lastPresentedAt = at;
    memory.answerModeStats = {
        recognition: {
            attempts: 5,
            correct: 4,
            correctStreak: 2,
            lastAttemptAt: at,
        },
        recall: {
            attempts: 0,
            correct: 0,
            correctStreak: 0,
            lastAttemptAt: null,
        },
    };
    const dueBefore = nextMemoryReviewAt(
        createScheduler(["legacy"]),
        { legacy: memory },
        time,
        "selection",
    );
    const updated = recordAnswerModeResult({
        memory,
        userId: "u",
        roomId: "r",
        itemId: "legacy",
        mode: "selection",
        success: true,
        now: new Date(time),
    });
    assert(updated.answerModeStats!.recognition.stability! > 0.3);
    assert(updated.answerModeStats!.recognition.stability! < 0.301);
    assert.equal(updated.answerModeStats!.recognition.lastReviewedAt, at);
    assert.equal(updated.answerModeStats!.recognition.attempts, 6);
    assert.equal(updated.answerModeStats!.recognition.correct, 5);
    assert(
        nextMemoryReviewAt(
            createScheduler(["legacy"]),
            { legacy: updated },
            time,
            "selection",
        )! > dueBefore! + 60_000,
    );
});

test("overdue reviews outside the remaining round outrank new introductions", () => {
    const state = createScheduler(["due", "new"], () => 0.5);
    state.cycleQueue = ["new"];
    state.userAnswered.due = 1;
    const memory = reviewed("due", 0.2, 2);
    const chosen = choose(state, { due: memory });
    assert.equal(chosen?.itemId, "due");
    assert.equal(chosen?.reason, "long_term_due");
    assert.equal(chosen?.advancesCycle, false);
    assert.deepEqual(state.cycleQueue, ["new"]);

    // Recording an exposure prevents the same overdue word from taking over
    // every subsequent turn, even when its memory stability is unchanged.
    const practiced = recordAnswerExposure(memory, new Date(time));
    recordUserAnswer(state, success, time);
    assert.equal(choose(state, { due: practiced })?.itemId, "new");
});

test("recovered selection mistakes earn stability at the first genuine spaced review", () => {
    const state = createScheduler(["relearn", "new"], () => 0.5);
    state.cycleQueue = ["new"];
    state.userAnswered.relearn = 3;
    const starting = new Date(time - 90_000);
    const failed = recordAnswerModeResult({
        memory: undefined, userId: "u", roomId: "r", itemId: "relearn",
        mode: "selection", success: false, usedHint: true, now: starting,
    });
    const first = recordAnswerModeResult({
        memory: failed, userId: "u", roomId: "r", itemId: "relearn",
        mode: "selection", success: true, now: new Date(time - 60_000),
    });
    const second = recordAnswerModeResult({
        memory: first, userId: "u", roomId: "r", itemId: "relearn",
        mode: "selection", success: true, now: new Date(time - 30_000),
    });
    assert.equal(second.answerModeStats?.recognition.correctStreak, 2);
    assert.equal(second.answerModeStats?.recognition.lastReviewedAt, null);
    assert.equal(second.answerModeStats?.recognition.stability, 0.12);
    const reviewAt = time + 90_000;
    const selected = choose(state, { relearn: second }, reviewAt, "selection");
    assert.equal(selected?.itemId, "relearn");
    assert.equal(selected?.reason, "long_term_due");
    const reviewedMemory = recordAnswerModeResult({
        memory: second, userId: "u", roomId: "r", itemId: "relearn",
        mode: "selection", success: true, now: new Date(reviewAt),
    });
    assert.equal(reviewedMemory.answerModeStats?.recognition.lastReviewedAt, new Date(reviewAt).toISOString());
    assert.ok(reviewedMemory.answerModeStats!.recognition.stability! > 0.12);
});

test("recall evidence is continuous and answer-length independent", () => {
    const base = { success: true, firstAttemptCorrect: true, attemptCount: 1,
        hintCount: 0, revealedHintChars: 0, maxCorrectPrefixLength: 4,
        recallLatencyMs: 700, elapsedMs: 4000 };
    const fast = getRecallQuality({ ...base, answerLength: 4 });
    const long = getRecallQuality({ ...base, answerLength: 14 });
    const slower = getRecallQuality({ ...base, answerLength: 4, recallLatencyMs: 2700 });
    const hinted = getRecallQuality({ ...base, answerLength: 14, finalCueRatio: 0.2 });
    assert.equal(fast, long);
    assert(fast > slower && slower > 0);
    assert(fast > hinted && hinted > 0);
});

test("a saturated retry queue reserves a periodic new-word slot", () => {
    const state = createScheduler(["a", "b", "c", "d", "new"], () => 0.5);
    state.turn = 5;
    for (const id of ["a", "b", "c", "d"])
        state.retries[id] = { itemId: id, earliestTurn: 6, latestTurn: 8,
            reason: "failed_recall", successCount: 0 };
    assert.equal(choose(state)?.itemId, "new");
    assert.equal(Object.keys(state.retries).length, 4);
});

test("due suspension is not displaced by an introduction slot", () => {
    const state = createScheduler(["held", "new"], () => 0.5);
    state.turn = 3;
    state.struggles.held = {
        consecutiveFailures: 0, firstFailureAt: null, suspensionLevel: 1,
        suspendedUntil: time,
    };
    const selected = choose(state, {}, time);
    assert.equal(selected?.itemId, "held");
    assert.equal(selected?.reason, "suspension_due");
    assert.equal(state.struggles.held.suspendedUntil, null);
});

test("an expiring retry beats an introduction slot", () => {
    const state = createScheduler(["retry", "new"], () => 0.5);
    state.turn = 1;
    state.retries.retry = { itemId: "retry", earliestTurn: 2,
        latestTurn: 2, reason: "failed_recall", successCount: 0 };
    assert.equal(choose(state)?.itemId, "retry");
});
