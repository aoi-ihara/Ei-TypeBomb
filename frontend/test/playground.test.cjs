/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function evaluate(source, globals = {}) {
    const scope = { exports: {}, ...globals };
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
            },
        }).outputText,
        scope,
    );
    return scope.exports;
}
function load(file, globals = {}) {
    return evaluate(fs.readFileSync(path.join(root, file), "utf8"), globals);
}
const memory = load("lib/playground/memory.ts");
const schedulerCache = new Map();
const schedulerStorage = {
    getItem: (key) => schedulerCache.get(key) ?? null,
    setItem: (key, value) => schedulerCache.set(key, value),
};
const scheduler = load("lib/playground/scheduler.ts", {
    require: () => memory,
    localStorage: schedulerStorage,
});
const input = load("lib/playground/recall-input.ts");
const clock = load("lib/playground/bomb-clock.ts");
const now = new Date("2026-10-07T00:00:00Z");
const initial = (id = "a") => ({
    ...memory.createInitialMemory("u", "r", id),
    reviewCount: 1,
    lastReviewedAt: now.toISOString(),
});
const observation = (extra = {}) => ({
    success: true,
    answerLength: 8,
    firstAttemptCorrect: true,
    attemptCount: 1,
    incorrectInputCount: 0,
    hintCount: 0,
    revealedHintChars: 0,
    maxCorrectPrefixLength: 8,
    recallLatencyMs: 100,
    elapsedMs: 1200,
    finalCueRatio: 0,
    initialCueRatio: 0,
    additionalHintCount: 0,
    elapsedSincePresentationMs: 10000,
    ...extra,
});
const apply = (m, o) =>
    memory.applyRecallObservation({
        memory: m,
        observation: o,
        userId: "u",
        roomId: "r",
        itemId: m?.itemId ?? "a",
        now,
    });
function rng(seed) {
    return () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}
function simulate(
    size,
    {
        seed = 1,
        kind = () => "fast",
        graduated = false,
        turns = size * 4,
        bot = false,
    } = {},
) {
    const random = rng(seed),
        ids = Array.from({ length: size }, (_, i) => String(i));
    const state = scheduler.createScheduler(ids, random),
        memories = {},
        seen = new Set(),
        trace = [];
    if (graduated)
        for (const id of ids)
            memories[id] = {
                ...initial(id),
                stability: 100,
                learningState: { phase: "graduated", freeRecallSuccesses: 2 },
            };
    let coverage = null;
    for (let i = 0; i < turns; i++) {
        const pending = { ...state.retries };
        const selected = scheduler.chooseNextUserItem(
            state,
            memories,
            random,
            now.getTime(),
        );
        assert(selected);
        // A small all-failing room may have no safe filler before a retry.
        if (selected.retry && selected.turn < selected.retry.earliestTurn) {
            assert(
                Object.keys(pending).length <= scheduler.MAX_ACTIVE_RELEARNING,
                "early practice is allowed only under a bounded active pool",
            );
        }
        if (selected.cycle === 1) seen.add(selected.itemId);
        const action = kind(selected.itemId, selected.turn, selected);
        const o = observation(
            action === "fail"
                ? { success: false, firstAttemptCorrect: false }
                : action === "hint"
                  ? {
                        finalCueRatio: 1,
                        revealedHintChars: 8,
                        answerWasFullyRevealed: true,
                        additionalHintCount: 4,
                    }
                  : action === "typo"
                    ? { incorrectInputCount: 1, firstAttemptCorrect: false }
                    : {},
        );
        const evaluation = memory.evaluateRecall(o);
        scheduler.recordUserAnswer(state, evaluation);
        memories[selected.itemId] = apply(
            memories[selected.itemId] ?? initial(selected.itemId),
            o,
        );
        assert(
            Object.keys(state.retries).length <=
                Math.min(size, scheduler.MAX_ACTIVE_RELEARNING),
            "relearning backlog must remain bounded",
        );
        trace.push({ ...selected, evaluation });
        if (coverage === null && seen.size === size) coverage = selected.turn;
        if (bot) {
            const before = JSON.stringify({
                turn: state.turn,
                queue: state.cycleQueue,
                retries: state.retries,
                answered: state.userAnswered,
            });
            const id = scheduler.chooseBotItem(state, random);
            if (id !== null) {
                const protectedForUpcomingRecall =
                    Boolean(state.retries[id]) ||
                    state.cycleQueue
                        .slice(0, scheduler.BOT_LOOKAHEAD)
                        .includes(id);
                // A protected BOT item is allowed only as the tiny-room
                // fallback, where the user has already answered it.
                assert(
                    !protectedForUpcomingRecall ||
                        (state.userAnswered[id] ?? 0) > 0,
                );
                scheduler.recordBotPresentation(state, id);
                memories[id] = memory.recordAnswerExposure(memories[id], now);
            }
            assert.equal(
                JSON.stringify({
                    turn: state.turn,
                    queue: state.cycleQueue,
                    retries: state.retries,
                    answered: state.userAnswered,
                }),
                before,
            );
        }
    }
    return { state, memories, trace, coverage };
}
for (const size of [20, 100])
    test(`${size} fast correct words cover exactly once in ${size} user answers`, () => {
        for (let seed = 1; seed <= 20; seed++) {
            const result = simulate(size, { seed, turns: size, bot: true });
            assert.equal(result.coverage, size);
            assert.equal(new Set(result.trace.map((x) => x.itemId)).size, size);
            assert.equal(Object.keys(result.state.retries).length, 0);
        }
        console.log(
            `Coverage: ${size} words / ${size} user answers (20 shuffle seeds)`,
        );
    });
test("graduated/high stability rows participate in every complete shuffle cycle", () => {
    const { trace, coverage } = simulate(20, { graduated: true, turns: 100 });
    assert.equal(coverage, 20);
    for (let cycle = 1; cycle <= 5; cycle++)
        assert.equal(
            new Set(trace.filter((x) => x.cycle === cycle).map((x) => x.itemId))
                .size,
            20,
        );
});
test("the first cycle reviews due words before untouched words", () => {
    const ids = ["untouched", "recent", "due", "hard-due"];
    const state = scheduler.createScheduler(ids, rng(19));
    const dueAt = new Date(now.getTime() - 2 * 86_400_000).toISOString();
    const recentAt = new Date(now.getTime() - 60_000).toISOString();
    const memories = {
        due: {
            ...initial("due"),
            stability: 1,
            difficulty: 4,
            lastReviewedAt: dueAt,
        },
        "hard-due": {
            ...initial("hard-due"),
            stability: 1,
            difficulty: 9,
            lastReviewedAt: dueAt,
        },
        recent: {
            ...initial("recent"),
            stability: 1,
            difficulty: 10,
            lastReviewedAt: recentAt,
        },
    };
    const order = [];
    for (let i = 0; i < ids.length; i++) {
        const selected = scheduler.chooseNextUserItem(
            state,
            memories,
            rng(30 + i),
            now.getTime(),
        );
        order.push(selected.itemId);
        if (memories[selected.itemId]) memories[selected.itemId].lastPresentedAt = now.toISOString();
        if (i === 0) assert.equal(selected.reason, "long_term_due");
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    }
    assert.deepEqual(order, ["hard-due", "due", "untouched", "recent"]);
    assert.equal(state.completedCycles, 1);
});

for (const mode of ["input", "selection"]) {
    test(`${mode}: remaining words follow current priority within a cycle`, () => {
        const timestamp = now.getTime();
        const hour = 60 * 60_000;
        const review = (itemId, elapsed, stability) => {
            const reviewedAt = new Date(timestamp - elapsed);
            const result = memory.recordAnswerModeResult({
                userId: "u", roomId: "r", itemId, mode: "selection",
                success: true, now: reviewedAt,
            });
            return {
                ...result,
                reviewCount: 1,
                lastReviewedAt: reviewedAt.toISOString(),
                stability,
                answerModeStats: {
                    ...result.answerModeStats,
                    recognition: { ...result.answerModeStats.recognition, stability },
                },
            };
        };
        const memories = {
            stable: review("stable", hour, 1),
            fragile: review("fragile", 0, 0.2),
            overdue: review("overdue", 24 * hour, 1),
        };
        const state = scheduler.createScheduler(Object.keys(memories), () => 0.5);
        const choose = (at) =>
            scheduler.chooseNextUserItem(state, memories, () => 0.5, at, mode);

        const first = choose(timestamp);
        assert.equal(first.itemId, "overdue");
        assert.deepEqual(Array.from(state.cycleQueue), ["stable", "fragile"]);
        assert.equal(choose(timestamp + hour), first);
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()), timestamp);
        assert.equal(choose(timestamp + 2 * hour).itemId, "fragile");
        assert.equal(state.cycle, 1);
    });
}

test("spaced overdue words interrupt new learning without consuming the saved round", () => {
    const timestamp = now.getTime();
    const oldReview = new Date(timestamp - 2 * 60 * 60_000).toISOString();
    const state = scheduler.createScheduler(["old", "older", "new", "next"], () => 0.5);
    state.turn = 6;
    state.cycleQueue = ["new", "next"];
    state.userAnswered = { old: 1, older: 1 };
    state.lastUserItem = "next";
    const memories = {
        old: { ...initial("old"), stability: 3, lastReviewedAt: oldReview },
        older: { ...initial("older"), stability: 0.2, lastReviewedAt: oldReview },
    };
    const queueBefore = [...state.cycleQueue];
    const chosen = scheduler.chooseNextUserItem(state, memories, () => 0.99, timestamp);
    assert.equal(chosen.itemId, "older");
    assert.equal(chosen.reason, "long_term_due");
    assert.equal(chosen.advancesCycle, false);
    assert.deepEqual(Array.from(state.cycleQueue), queueBefore);

    scheduler.saveSchedulerState("playground", "review-user", "review-room", state, timestamp);
    const restored = scheduler.loadSchedulerState(
        "playground", "review-user", "review-room",
        state.itemIds, timestamp + 1000,
    );
    assert.equal(restored.current.itemId, "older");
    assert.equal(restored.current.reason, "long_term_due");

    // The newly presented word is no longer independently due. The other
    // word has not yet crossed the 80% retention threshold, so new learning
    // resumes from the original round without shuffling its remaining entries.
    memories.older = memory.recordAnswerExposure(memories.older, new Date(timestamp));
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()), timestamp);
    assert.deepEqual(Array.from(state.cycleQueue), queueBefore);
    const next = scheduler.chooseNextUserItem(state, memories, () => 0.99, timestamp + 1000);
    assert.equal(next.itemId, "new");
    assert.equal(next.reason, "cycle");
    assert.deepEqual(Array.from(state.cycleQueue), queueBefore.slice(1));
});

test("retained words and recent exposures cannot interrupt the cycle", () => {
    const timestamp = now.getTime();
    const oldReview = new Date(timestamp - 10 * 60_000).toISOString();
    const state = scheduler.createScheduler(["old", "new", "next"], () => 0.5);
    state.turn = 6;
    state.cycleQueue = ["new", "next"];
    state.userAnswered = { old: 1 };
    const memories = { old: { ...initial("old"), lastReviewedAt: oldReview } };

    const noProbe = scheduler.chooseNextUserItem(
        state, memories, () => 0.9, timestamp,
    );
    assert.equal(noProbe.itemId, "new");
    assert.equal(noProbe.reason, "cycle");
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));

    const recent = scheduler.createScheduler(["old", "new"], () => 0.5);
    recent.turn = 6;
    recent.userAnswered = { old: 1 };
    recent.cycleQueue = ["new"];
    const recentlyShown = {
        old: { ...memories.old, lastPresentedAt: new Date(timestamp - 30_000).toISOString() },
    };
    assert.equal(
        scheduler.chooseNextUserItem(recent, recentlyShown, () => 0, timestamp).itemId,
        "new",
    );
});

test("due relearning takes priority over an optional spaced review", () => {
    const timestamp = now.getTime();
    const state = scheduler.createScheduler(["old", "retry", "new"], () => 0.5);
    state.turn = 6;
    state.cycleQueue = ["new"];
    state.userAnswered = { old: 1, retry: 1 };
    state.retries.retry = {
        itemId: "retry", earliestTurn: 7, latestTurn: 10,
        reason: "failed_recall", successCount: 0,
    };
    const memories = {
        old: {
            ...initial("old"),
            lastReviewedAt: new Date(timestamp - 2 * 60 * 60_000).toISOString(),
        },
    };
    const selected = scheduler.chooseNextUserItem(state, memories, () => 0, timestamp);
    assert.equal(selected.itemId, "retry");
    assert.equal(selected.reason, "retry");
});

test("recognition answers advance the scheduler without becoming free recall", () => {
    const state = scheduler.createScheduler(["a", "b", "c"], () => 0.5);
    const selected = scheduler.chooseNextUserItem(state, {}, () => 0.5);
    assert.ok(selected);
    assert.equal(
        scheduler.recordRecognitionAnswer(state, selected.itemId),
        true,
    );
    assert.equal(state.current, null);
    assert.equal(state.userAnswered[selected.itemId], 1);
    assert.equal(state.retries[selected.itemId], undefined);

    const next = scheduler.chooseNextUserItem(state, {}, () => 0.5);
    assert.ok(next);
    assert.notEqual(next.itemId, selected.itemId);
});

test("recognition mistakes reuse typing's short retry and confirmation schedule", () => {
    const stamp = now.getTime();
    const state = scheduler.createScheduler(["a", "b", "c", "d", "e"], () => 0.5);
    const first = scheduler.chooseNextUserItem(state, {}, () => 0.5, stamp);
    assert.ok(first);
    assert.equal(scheduler.recordRecognitionAnswer(state, first.itemId, true, stamp), true);
    assert.equal(state.userAnswered[first.itemId], 1);
    assert.equal(state.retries[first.itemId].reason, "failed_recall");
    assert.equal(state.retries[first.itemId].earliestTurn, 3);

    const filler = scheduler.chooseNextUserItem(state, {}, () => 0.5, stamp + 1_000);
    assert.notEqual(filler.itemId, first.itemId);
    scheduler.recordRecognitionAnswer(state, filler.itemId, false, stamp + 1_000);

    const retry = scheduler.chooseNextUserItem(state, {}, () => 0.5, stamp + 2_000);
    assert.equal(retry.itemId, first.itemId);
    assert.equal(retry.reason, "retry");
    scheduler.recordRecognitionAnswer(state, retry.itemId, false, stamp + 2_000);
    assert.equal(state.retries[first.itemId].reason, "uncertain_recall");
    assert.equal(state.retries[first.itemId].successCount, 1);
});

test("selection-only recognition history prioritizes difficult questions without free recall", () => {
    const stamp = now.getTime();
    const failed = memory.recordAnswerModeResult({
        userId: "u", roomId: "r", itemId: "hard", mode: "selection",
        success: false, now,
    });
    const correct = memory.recordAnswerModeResult({
        userId: "u", roomId: "r", itemId: "easy", mode: "selection",
        success: true, now,
    });
    const memories = { hard: failed, easy: correct };
    const state = scheduler.createScheduler(["new", "easy", "hard"], () => 0.5);
    const picked = scheduler.chooseNextUserItem(
        state, memories, () => 0.5, stamp + 120_000, "selection",
    );
    assert.equal(picked.itemId, "hard");
    assert.equal(failed.reviewCount, 0);
    assert.equal(correct.reviewCount, 0);
    assert.equal(memory.getRetrievability(failed, stamp), 0);
});

test("choice response speed breaks accuracy ties but cannot override a real failure", () => {
    const timestamp = now.getTime();
    const choice = (id, success, responseMs) =>
        memory.recordAnswerModeResult({
            userId: "u", roomId: "r", itemId: id, mode: "selection",
            success, responseMs, now,
        });
    const quick = choice("quick", true, 1_000);
    const slow = choice("slow", true, 15_000);
    const failed = choice("failed", false, 100);
    const memories = { quick, slow, failed };
    const state = scheduler.createScheduler(["quick", "slow", "failed"], () => 0.5);
    const selected = scheduler.chooseNextUserItem(state, memories, () => 0.5, timestamp, "selection");
    assert.equal(selected.itemId, "failed");

    const tied = scheduler.createScheduler(["quick", "slow"], () => 0.5);
    const slower = scheduler.chooseNextUserItem(tied, memories, () => 0.5, timestamp, "selection");
    assert.equal(slower.itemId, "slow");
    assert.equal(slow.reviewCount, 0);
});

test("a single wrong choice is softened; repeated mistakes and speed still influence ordering", () => {
    const timestamp = now.getTime();
    const observeChoice = (itemId, success, responseMs, previous) =>
        memory.recordAnswerModeResult({
            memory: previous,
            userId: "u",
            roomId: "r",
            itemId,
            mode: "selection",
            success,
            responseMs,
            now,
        });

    const quick = observeChoice("quick", true, 1_000);
    const slow = observeChoice("slow", true, 29_000);
    const once = observeChoice("once", false);
    const twice = observeChoice(
        "twice", false, null,
        observeChoice("twice", false),
    );
    const quickThenWrong = observeChoice(
        "quickThenWrong", false, null,
        observeChoice("quickThenWrong", true, 1_000),
    );
    const memories = { quick, slow, once, twice, quickThenWrong };
    const state = scheduler.createScheduler(Object.keys(memories), () => 0.5);
    const order = [];
    for (let index = 0; index < 5; index++) {
        const selected = scheduler.chooseNextUserItem(
            state, memories, () => 0.5, timestamp, "selection",
        );
        order.push(selected.itemId);
        scheduler.recordRecognitionAnswer(state, selected.itemId);
    }

    // A single error is no longer scored as a hard 100% failure, while
    // multiple mistakes still matter. A later miss cannot be hidden by a
    // previous fast answer. All other things equal, slower clean answers
    // receive earlier review than fast clean answers.
    assert.deepEqual(order, [
        "twice", "once", "quickThenWrong", "slow", "quick",
    ]);
    assert.equal(twice.reviewCount, 0);
    assert.equal(slow.reviewCount, 0);
});

test("the first cycle preserves its Fisher–Yates order when no recall history exists", () => {
    const state = scheduler.createScheduler(
        ["a", "b", "c", "d", "e"],
        rng(23),
    );
    const shuffled = [...state.cycleQueue];
    const order = [];
    for (let i = 0; i < shuffled.length; i++) {
        const selected = scheduler.chooseNextUserItem(
            state,
            {},
            rng(40 + i),
            now.getTime(),
        );
        order.push(selected.itemId);
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    }
    assert.deepEqual(order, shuffled);
});



test("mode changes preserve the saved queue and grade current mode at selection time", () => {
    const timestamp = now.getTime();
    const ids = ["recall-due", "recognition-hard", "retry", "current"];
    const memories = {
        "recall-due": {
            ...initial("recall-due"), stability: 0.1,
            lastReviewedAt: new Date(timestamp - 86_400_000).toISOString(),
        },
        "recognition-hard": memory.recordAnswerModeResult({
            userId: "u", roomId: "r", itemId: "recognition-hard",
            mode: "selection", success: false, now: new Date(timestamp - 120_000),
        }),
    };
    const state = scheduler.createScheduler(ids, () => 0.5);
    state.cycleQueue = ["recognition-hard", "recall-due"];
    state.priorityAnswerMode = "selection";
    state.turn = 4;
    state.retries.retry = {
        itemId: "retry", earliestTurn: 6, latestTurn: 8,
        reason: "failed_recall", successCount: 0,
    };
    state.current = {
        itemId: "current", turn: 4, cycle: 1,
        reason: "cycle", advancesCycle: true,
    };
    scheduler.saveSchedulerState("playground", "switch-user", "room", state, timestamp);

    const inputState = scheduler.loadSchedulerState(
        "playground", "switch-user", "room", ids,
        timestamp + 1_000,
    );
    assert.deepEqual(Array.from(inputState.cycleQueue), [
        "recognition-hard", "recall-due",
    ]);
    assert.equal(inputState.current.itemId, "current");
    assert.deepEqual({ ...inputState.retries.retry }, { ...state.retries.retry });
    assert.equal("priorityAnswerMode" in inputState, false);
    scheduler.recordRecognitionAnswer(inputState, "current");
    assert.equal(scheduler.chooseNextUserItem(
        inputState, memories, () => 0.5, timestamp + 1_000, "input",
    ).itemId, "recall-due");

    const selectionState = scheduler.loadSchedulerState(
        "playground", "switch-user", "room", ids,
        timestamp + 1_000,
    );
    assert.deepEqual(Array.from(selectionState.cycleQueue), [
        "recognition-hard", "recall-due",
    ]);
    assert.equal("priorityAnswerMode" in selectionState, false);
    scheduler.recordRecognitionAnswer(selectionState, "current");
    assert.equal(scheduler.chooseNextUserItem(
        selectionState, memories, () => 0.5, timestamp + 1_000, "selection",
    ).itemId, "recognition-hard");
});

test("old caches preserve round order and re-rank when selecting", () => {
    const timestamp = now.getTime();
    const ids = ["recall-due", "recognition-hard"];
    const state = scheduler.createScheduler(ids, () => 0.5);
    state.cycleQueue = [...ids].reverse();
    delete state.priorityAnswerMode;
    const memories = {
        "recall-due": {
            ...initial("recall-due"), stability: 0.1,
            lastReviewedAt: new Date(timestamp - 86_400_000).toISOString(),
        },
        "recognition-hard": memory.recordAnswerModeResult({
            userId: "u", roomId: "r", itemId: "recognition-hard",
            mode: "selection", success: false, now: new Date(timestamp - 120_000),
        }),
    };
    scheduler.saveSchedulerState("playground", "legacy-mode", "room", state, timestamp);
    const restored = scheduler.loadSchedulerState(
        "playground", "legacy-mode", "room", ids,
        timestamp + 1_000,
    );
    assert.deepEqual(Array.from(restored.cycleQueue), [
        "recognition-hard", "recall-due",
    ]);
    assert.equal(scheduler.chooseNextUserItem(restored, memories, () => 0.5, timestamp + 1000).itemId, "recall-due");
});

test("reload continues the exact pending cycle instead of reshuffling", () => {
    const ids = ["a", "b", "c", "d"];
    const state = scheduler.createScheduler(ids, rng(18));
    const timestamp = now.getTime();
    const first = scheduler.chooseNextUserItem(state, {}, rng(1), timestamp);
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    scheduler.saveSchedulerState("playground", "reload-user", "reload-room", state, timestamp);
    const expected = scheduler.chooseNextUserItem(state, {}, rng(2), timestamp);
    const restored = scheduler.loadSchedulerState(
        "playground", "reload-user", "reload-room", ids, timestamp + 1000,
    );
    assert.ok(restored);
    assert.equal(
        scheduler.chooseNextUserItem(restored, {}, rng(99), timestamp + 1000).itemId,
        expected.itemId,
    );
    assert.equal(restored.turn, 2);
    assert.equal(restored.userAnswered[first.itemId], 1);
});

test("reload preserves unfinished questions and scheduled failed recalls", () => {
    const ids = ["a", "b", "c", "d"];
    const timestamp = now.getTime();
    const state = scheduler.createScheduler(ids, rng(42));
    const first = scheduler.chooseNextUserItem(state, {}, rng(10), timestamp);
    scheduler.saveSchedulerState("playground", "retry-user", "retry-room", state, timestamp);
    let restored = scheduler.loadSchedulerState(
        "playground", "retry-user", "retry-room", ids, timestamp + 1000,
    );
    assert.equal(restored.current.itemId, first.itemId);
    assert.equal(restored.turn, 1);
    assert.equal(restored.userAnswered[first.itemId] ?? 0, 0);
    assert.equal(
        scheduler.chooseNextUserItem(restored, {}, rng(11), timestamp + 1000).itemId,
        first.itemId,
    );

    scheduler.recordUserAnswer(
        restored,
        memory.evaluateRecall(observation({ success: false })),
    );
    scheduler.saveSchedulerState(
        "playground", "retry-user", "retry-room", restored, timestamp + 1000,
    );
    const resumed = scheduler.loadSchedulerState(
        "playground", "retry-user", "retry-room", ids, timestamp + 2000,
    );
    assert.ok(resumed.retries[first.itemId]);
    scheduler.chooseNextUserItem(resumed, {}, rng(12), timestamp + 2000);
    scheduler.recordUserAnswer(resumed, memory.evaluateRecall(observation()));
    assert.equal(
        scheduler.chooseNextUserItem(resumed, {}, rng(13), timestamp + 2000).itemId,
        first.itemId,
    );
});

// Drive the real answer recorder with explicit wall-clock times.
function gradeStruggle(state, itemId, evaluation, at) {
    // In live play a retry is removed when its prompt is selected.
    const retry = state.retries[itemId];
    delete state.retries[itemId];
    state.turn += 1;
    state.current = {
        itemId,
        turn: state.turn,
        cycle: state.cycle,
        reason: retry ? "retry" : "cycle",
        advancesCycle: false,
        ...(retry ? { retry } : {}),
    };
    scheduler.recordUserAnswer(state, evaluation, at);
}
const failedRecall = memory.evaluateRecall(
    observation({ success: false, firstAttemptCorrect: false }),
);
const cleanRecall = memory.evaluateRecall(observation());

test("repeated difficulty suspends only after four failures over two minutes", () => {
    const start = now.getTime();
    const state = scheduler.createScheduler(["hard", "easy"], rng(7));
    for (const elapsed of [0, 20_000, 60_000]) {
        gradeStruggle(state, "hard", failedRecall, start + elapsed);
        assert.equal(state.struggles.hard.suspendedUntil, null);
    }
    gradeStruggle(state, "hard", failedRecall, start + 120_000);
    const firstDeadline = start + 120_000 + scheduler.SUSPENSION_DELAYS_MS[0];
    assert.equal(state.struggles.hard.suspensionLevel, 1);
    assert.equal(state.struggles.hard.suspendedUntil, firstDeadline);
    assert.equal(state.retries.hard, undefined);

    // The held word does not occupy the relearning pool or block new words.
    const next = scheduler.chooseNextUserItem(state, {}, rng(1), start + 121_000);
    assert.equal(next.itemId, "easy");
    scheduler.recordUserAnswer(state, cleanRecall, start + 121_000);

    // The next review resumes the old word before introducing new ones.
    const resumed = scheduler.chooseNextUserItem(state, {}, rng(2), firstDeadline);
    assert.equal(resumed.itemId, "hard");
    assert.equal(resumed.reason, "suspension_due");
    scheduler.recordUserAnswer(state, failedRecall, firstDeadline);
    assert.equal(state.struggles.hard.suspendedUntil, null);
    gradeStruggle(state, "hard", failedRecall, firstDeadline + 1_000);
    assert.equal(state.struggles.hard.suspensionLevel, 2);
    assert.equal(
        state.struggles.hard.suspendedUntil,
        firstDeadline + 1_000 + scheduler.SUSPENSION_DELAYS_MS[1],
    );
});

test("persistent failures escalate through 3h, 12h and 24h with a 24h cap", () => {
    const state = scheduler.createScheduler(["hard"], rng(8));
    let time = now.getTime();
    for (const elapsed of [0, 30_000, 60_000, 120_000])
        gradeStruggle(state, "hard", failedRecall, time + elapsed);
    let deadline = state.struggles.hard.suspendedUntil;
    const expected = [
        30 * 60_000,
        3 * 60 * 60_000,
        12 * 60 * 60_000,
        24 * 60 * 60_000,
        24 * 60 * 60_000,
    ];
    for (let index = 0; index < expected.length; index++) {
        // Rehearsal keeps a one-word room active without lifting the hold.
        assert.equal(scheduler.chooseNextUserItem(state, {}, rng(1), deadline - 1).reason, "early_practice");
        scheduler.recordUserAnswer(state, failedRecall, deadline - 1);
        assert.equal(state.struggles.hard.suspendedUntil, deadline);
        const due = scheduler.chooseNextUserItem(state, {}, rng(1), deadline);
        assert.equal(due?.reason, "suspension_due");
        scheduler.recordUserAnswer(state, failedRecall, deadline);
        gradeStruggle(state, "hard", failedRecall, deadline + 1_000);
        assert.equal(
            state.struggles.hard.suspendedUntil,
            deadline + 1_000 + expected[index],
        );
        deadline = state.struggles.hard.suspendedUntil;
    }
});

test("a successful independent recall reduces hold severity without treating typos as failures", () => {
    const state = scheduler.createScheduler(["hard"], rng(2));
    state.struggles.hard = {
        consecutiveFailures: 1,
        firstFailureAt: now.getTime(),
        suspensionLevel: 3,
        suspendedUntil: null,
    };
    // A corrected typing mistake still counts as unaided recall.
    const typo = memory.evaluateRecall(observation({
        incorrectInputCount: 1,
        firstAttemptCorrect: false,
    }));
    assert.equal(typo.retryNeed, "confirm");
    gradeStruggle(state, "hard", typo, now.getTime() + 1_000);
    assert.equal(state.struggles.hard.suspensionLevel, 2);
    assert.equal(state.struggles.hard.consecutiveFailures, 0);
    gradeStruggle(state, "hard", failedRecall, now.getTime() + 2_000);
    assert.equal(state.struggles.hard.consecutiveFailures, 1);
    gradeStruggle(state, "hard", cleanRecall, now.getTime() + 3_000);
    assert.equal(state.struggles.hard.suspensionLevel, 1);
    gradeStruggle(state, "hard", cleanRecall, now.getTime() + 4_000);
    assert.equal(state.struggles.hard, undefined);
});

test("recent BOT exposure never escalates difficulty, but assisted independent recalls do", () => {
    const state = scheduler.createScheduler(["hard"], rng(2));
    const exposed = memory.evaluateRecall(observation({
        success: false,
        elapsedSincePresentationMs: 100,
    }));
    assert.equal(exposed.independent, false);
    gradeStruggle(state, "hard", exposed, now.getTime());
    assert.equal(state.struggles.hard, undefined);
    const hint = memory.evaluateRecall(observation({
        finalCueRatio: 0.1,
        additionalHintCount: 1,
    }));
    assert.equal(hint.retryNeed, "confirm");
    gradeStruggle(state, "hard", hint, now.getTime());
    assert.equal(state.struggles.hard.consecutiveFailures, 1);
});

test("all held words allow user rehearsal but remain protected from BOT exposure", () => {
    const state = scheduler.createScheduler(["a", "b"], rng(1));
    const until = now.getTime() + 3 * 60 * 60_000;
    for (const id of state.itemIds) {
        state.struggles[id] = {
            consecutiveFailures: 0,
            firstFailureAt: null,
            suspensionLevel: 3,
            suspendedUntil: until,
        };
        state.userAnswered[id] = 1;
    }
    assert.equal(scheduler.chooseNextUserItem(state, {}, rng(4), now.getTime()).reason, "early_practice");
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()), now.getTime());
    assert.equal(scheduler.chooseBotItem(state, rng(4)), null);
    assert.equal(scheduler.nextSuspendedReviewAt(state), until);
    const restoredId = scheduler.chooseNextUserItem(state, {}, rng(4), until)?.itemId;
    assert.ok(["a", "b"].includes(restoredId));
    assert.equal(state.struggles[restoredId].suspendedUntil, null);
});

test("word hold deadlines survive reload and removed room words are discarded", () => {
    const state = scheduler.createScheduler(["hard", "deleted", "new"], rng(2));
    const time = now.getTime();
    state.struggles.hard = {
        consecutiveFailures: 0,
        firstFailureAt: null,
        suspensionLevel: 4,
        suspendedUntil: time + 12 * 60 * 60_000,
    };
    state.struggles.deleted = {
        consecutiveFailures: 0,
        firstFailureAt: null,
        suspensionLevel: 1,
        suspendedUntil: time + 600_000,
    };
    scheduler.saveSchedulerState("playground", "hold-user", "room", state, time);
    const restored = scheduler.loadSchedulerState(
        "playground", "hold-user", "room", ["hard", "new"], time + 10_000,
    );
    assert.equal(restored.struggles.hard.suspendedUntil, time + 12 * 60 * 60_000);
    assert.equal(restored.struggles.deleted, undefined);
    assert.equal(
        scheduler.chooseNextUserItem(restored, {}, rng(4), time + 10_000).itemId,
        "new",
    );
    const old = scheduler.createScheduler(["old"], rng(3));
    delete old.struggles;
    scheduler.saveSchedulerState("playground", "old-cache", "room", old, time);
    assert.deepEqual(
        Object.keys(scheduler.loadSchedulerState(
            "playground", "old-cache", "room", ["old"], time + 1_000,
        ).struggles),
        [],
    );
});

test("scheduler storage is scoped to user, room and mode", () => {
    const ids = ["a", "b"];
    const state = scheduler.createScheduler(ids, rng(9));
    scheduler.saveSchedulerState(
        "playground", "owner", "room", state, now.getTime(),
    );
    for (const [mode, user, room] of [
        ["online", "owner", "room"],
        ["playground", "other", "room"],
        ["playground", "owner", "other"],
    ]) {
        assert.equal(
            scheduler.loadSchedulerState(mode, user, room, ids, now.getTime()),
            null,
        );
    }
});

test("long-break restore re-evaluates due words without grading interrupted work", () => {
    const ids = ["stable", "due"];
    const timestamp = now.getTime();
    const state = scheduler.createScheduler(ids, rng(17));
    scheduler.chooseNextUserItem(state, {}, rng(1), timestamp);
    scheduler.saveSchedulerState("playground", "delayed", "room", state, timestamp);
    const memories = {
        stable: { ...initial("stable"), stability: 100 },
        due: {
            ...initial("due"),
            stability: 0.15,
            lastReviewedAt: new Date(timestamp - 86_400_000).toISOString(),
        },
    };
    const restored = scheduler.loadSchedulerState(
        "playground", "delayed", "room", ids,
        timestamp + 8 * 60 * 60 * 1000,
    );
    assert.equal(restored.current, null);
    assert.equal(
        scheduler.chooseNextUserItem(
            restored, memories, rng(22), timestamp + 8 * 60 * 60 * 1000,
        ).itemId,
        "due",
    );
    assert.equal(Object.keys(restored.userAnswered).length, 0);
});

test("room edits reconcile the queue while preserving prior answers", () => {
    const timestamp = now.getTime();
    const state = scheduler.createScheduler(["a", "b", "removed"], rng(33));
    const first = scheduler.chooseNextUserItem(state, {}, rng(1), timestamp);
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    scheduler.saveSchedulerState("playground", "edit", "room", state, timestamp);
    const ids = ["a", "b", "new"];
    const restored = scheduler.loadSchedulerState(
        "playground", "edit", "room", ids, timestamp + 1000,
    );
    assert.ok(restored);
    assert.deepEqual(Array.from(restored.itemIds), ids);
    assert.ok(restored.cycleQueue.includes("new"));
    assert.ok(!restored.cycleQueue.includes("removed"));
    if (first.itemId !== "removed") {
        assert.ok(!restored.cycleQueue.includes(first.itemId));
        assert.equal(restored.userAnswered[first.itemId], 1);
    }
});

test("damaged scheduler storage falls back to normal scheduling", () => {
    schedulerStorage.setItem(
        "playground-scheduler:v1:playground:bad:room",
        "{not-json",
    );
    assert.equal(
        scheduler.loadSchedulerState(
            "playground", "bad", "room", ["a"], now.getTime(),
        ),
        null,
    );
});

test("a failed word is retried promptly, before unbounded new introductions", () => {
    const result = simulate(20, {
        kind: (id) => (id === "0" ? "fail" : "fast"),
        turns: 80,
    });
    assert(
        result.trace.filter((x) => x.itemId === "0" && x.reason === "retry")
            .length > 2,
    );
    assert(result.coverage !== null);
});
test("saturated relearning keeps new introductions progressing without overflowing retries", () => {
    for (const size of [4, 8, 20, 100]) {
        const result = simulate(size, {
            kind: () => "fail",
            turns: 120,
        });
        const introduced = new Set(result.trace.map((x) => x.itemId));
        assert(introduced.size >= 1);
        if (size > 4) assert(introduced.size > 4,
            "even persistent failures must not permanently starve new words");
        assert.equal(result.state.retries && Object.keys(result.state.retries).length <= 4, true);
    }
});
test("relearning backlog drains after independent recall and permits new words", () => {
    const counts = {};
    const result = simulate(30, {
        turns: 150,
        kind: (id) => {
            counts[id] = (counts[id] ?? 0) + 1;
            return counts[id] === 1 ? "hint" : "fast";
        },
    });
    assert(result.coverage !== null);
    assert.equal(new Set(result.trace.map((x) => x.itemId)).size, 30);
});
test("mixed failures keep the active backlog bounded", () => {
    for (let seed = 1; seed <= 10; seed++) {
        const random = rng(seed * 41);
        const result = simulate(30, {
            seed,
            turns: 300,
            bot: true,
            kind: () => {
                const v = random();
                return v < 0.3 ? "fail" : v < 0.6 ? "hint" : "fast";
            },
        });
        assert(Object.keys(result.state.retries).length <= 4);
    }
});
test("retry success widens the gap, second success clears it, renewed failure resets short gap", () => {
    const state = scheduler.createScheduler(
        Array.from({ length: 20 }, (_, i) => String(i)),
        rng(2),
    );
    let selected = scheduler.chooseNextUserItem(state),
        target = selected.itemId;
    scheduler.recordUserAnswer(
        state,
        memory.evaluateRecall(observation({ success: false })),
    );
    assert.equal(
        state.retries[target].earliestTurn,
        state.turn + scheduler.SHORT_RETRY_GAP,
    );
    while (true) {
        selected = scheduler.chooseNextUserItem(state);
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
        if (selected.itemId === target) break;
    }
    assert.equal(state.retries[target].successCount, 1);
    assert.equal(
        state.retries[target].earliestTurn,
        state.turn + scheduler.CONFIRM_RETRY_GAP,
    );
    while (true) {
        selected = scheduler.chooseNextUserItem(state);
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
        if (selected.itemId === target) break;
    }
    assert.equal(state.retries[target], undefined);
});
test("light corrected typo is distinct from a fully revealed answer", () => {
    const current = { ...initial(), stability: 5, lastReviewedAt: new Date(now.getTime() - 2 * 86_400_000).toISOString() };
    const typo = observation({
        incorrectInputCount: 1,
        firstAttemptCorrect: false,
    });
    const full = observation({
        finalCueRatio: 1,
        answerWasFullyRevealed: true,
        revealedHintChars: 8,
    });
    assert.equal(memory.evaluateRecall(typo).memoryEvidence, "recall");
    assert.equal(memory.evaluateRecall(typo).retryNeed, "confirm");
    assert.equal(
        memory.evaluateRecall(full).memoryEvidence,
        "insufficient_evidence",
    );
    assert.equal(memory.evaluateRecall(full).retryNeed, "short");
    assert(apply(current, typo).stability >= current.stability);
    assert.equal(apply(current, full).stability, current.stability, "recent rehearsal only updates short-term state");
    assert(apply(current, { ...full, elapsedSincePresentationMs: 2 * 86_400_000 }).stability < current.stability);
});
test("slow unaided correctness and typing errors do not become recall failures", () => {
    const slow = observation({
        firstAttemptCorrect: false,
        incorrectInputCount: 8,
        attemptCount: 9,
        recallLatencyMs: 15_000,
        elapsedMs: 60_000,
    });
    const evaluation = memory.evaluateRecall(slow);
    assert.equal(evaluation.memoryEvidence, "recall");
    assert.equal(evaluation.retryNeed, "confirm");
    assert.equal(evaluation.independent, true);
    assert.equal(apply({ ...initial(), stability: 5 }, slow).stability,
        apply({ ...initial(), stability: 5 }, observation()).stability);
});

test("recent BOT exposure supplies no independent recall or long-term gain", () => {
    const current = { ...initial(), stability: 5 };
    const exposed = memory.recordAnswerExposure(current, now);
    assert.equal(exposed.reviewCount, current.reviewCount);
    assert.equal(exposed.lastReviewedAt, current.lastReviewedAt);
    assert.equal(exposed.stability, current.stability);
    const o = observation({ elapsedSincePresentationMs: 500 });
    assert.equal(memory.evaluateRecall(o).independent, false);
    assert.equal(
        memory.evaluateRecall(o).memoryEvidence,
        "insufficient_evidence",
    );
    assert.equal(apply(exposed, o).stability, exposed.stability);
});
test("all words start without forced cues; speed does not multiply stability gain", () => {
    assert.equal(memory.createTurnPlan(undefined).initialCueRatio, 0);
    assert.equal(
        memory.createTurnPlan({
            ...initial(),
            learningState: { phase: "supported_recall" },
        }).initialCueRatio,
        0,
    );
    const current = { ...initial(), lastReviewedAt: "2026-10-06T00:00:00Z" };
    const fast = observation(),
        normal = observation({ elapsedMs: 4500, recallLatencyMs: 3000 });
    assert.equal(
        apply(current, fast).stability,
        apply(current, normal).stability,
    );
});
test("bomb and hint helpers retain their independent behavior", () => {
    assert.equal(clock.advanceBombClock(0.5, 5000, 10000, false), 1);
    assert.equal(clock.advanceBombClock(0.5, 5000, 10000, true), 0.5);
    assert.equal(input.hintCoversError(["Y"], "Hello", 1), true);
    assert.equal(input.hintCoversError(["H"], "Hello", 1), false);
});

test("BOT fallback stays null only before the user has answered anything", () => {
    const state = scheduler.createScheduler(["a", "b", "c"], () => 0);
    assert.equal(
        scheduler.chooseBotItem(state, () => 0.5),
        null,
    );
});

test("BOT fallback keeps the handoff alive after a user answer when every word is protected", () => {
    const state = scheduler.createScheduler(["a", "b", "c"], () => 0);
    const selected = scheduler.chooseNextUserItem(state, {}, () => 0);
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));

    // In a three-word room BOT_LOOKAHEAD protects the remaining cycle,
    // while the answered word may also be unavailable to the strict pool.
    // The fallback must still return an already answered word.
    state.retries[selected.itemId] = {
        itemId: selected.itemId,
        earliestTurn: state.turn + 1,
        latestTurn: state.turn + 4,
        reason: "uncertain_recall",
        successCount: 0,
    };

    for (let i = 0; i < 20; i++) {
        const id = scheduler.chooseBotItem(state, rng(i + 1));
        assert.notEqual(id, null);
        assert((state.userAnswered[id] ?? 0) > 0);
    }
});

test("BOT lookahead skips held and retry words before protecting upcoming recalls", () => {
    const ids = [
        "held-a", "held-b", "held-c", "retry",
        "next-a", "next-b", "next-c", "safe",
    ];
    const state = scheduler.createScheduler(ids, () => 0);
    state.cycleQueue = [...ids];
    for (const id of ["held-a", "held-b", "held-c"]) {
        state.struggles[id] = {
            consecutiveFailures: 0,
            firstFailureAt: null,
            suspensionLevel: 1,
            suspendedUntil: now.getTime() + 10 * 60_000,
        };
    }
    state.retries.retry = {
        itemId: "retry",
        earliestTurn: 999,
        latestTurn: 1002,
        reason: "failed_recall",
        successCount: 0,
    };
    // A previously seen upcoming recall is otherwise an eligible BOT word.
    state.userAnswered["next-a"] = 1;
    state.userAnswered.safe = 1;

    // BOT can use the safe word without spoiling the next user question.
    assert.equal(scheduler.chooseBotItem(state, () => 0), "safe");
    assert.equal(
        scheduler.chooseNextUserItem(state, {}, () => 0, now.getTime()).itemId,
        "next-a",
    );
});

test("BOT never introduces an unseen word when only a protected answered word exists", () => {
    const state = scheduler.createScheduler(["a", "b", "c", "d", "e"], () => 0);
    state.userAnswered.a = 1;
    state.lastBotItem = "a";
    state.cycleQueue = ["b", "c", "d"];
    state.retries.a = {
        itemId: "a",
        earliestTurn: 2,
        latestTurn: 4,
        reason: "uncertain_recall",
        successCount: 0,
    };

    assert.equal(scheduler.chooseBotItem(state, () => 0.75), "a");
});

// Exercise the real queue callback, including arrivals during an in-flight request.
function getCallback(name, globals) {
    const source = fs.readFileSync(
        path.join(root, "app/(game)/[link]/offline/Client.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
        "Client.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    let callback;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
            callback = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert(callback);
    const printed = ts
        .createPrinter()
        .printNode(ts.EmitHint.Expression, callback, ast);
    return evaluate("export const callback = " + printed, globals).callback;
}

test("solo answer speech plays after success, including after a full hint", () => {
    for (const scenario of [
        { readAnswer: true, revealed: false, expected: ["apple"] },
        { readAnswer: true, revealed: true, expected: ["apple"] },
        { readAnswer: true, revealed: false, answer: "こんにちは", lang: "ja-JP", expected: ["こんにちは"] },
        { readAnswer: false, revealed: false, expected: [] },
    ]) {
        const spoken = [];
        const utterances = [];
        const nextItems = [];
        const answerSpeechRef = { current: null };
        let speechVersion = 0;
        const synthesis = {
            cancel: () => {},
            speak: (utterance) => {
                utterances.push(utterance);
                spoken.push([utterance.text, utterance.lang]);
            },
        };
        class Utterance {
            constructor(text) {
                this.text = text;
            }
        }
        const callback = getCallback("handleSuccess", {
            window: { speechSynthesis: synthesis },
            SpeechSynthesisUtterance: Utterance,
            getSpeechLanguage: (text, side) => {
                assert.equal(text, scenario.answer ?? "apple");
                assert.equal(side, "answer");
                return scenario.lang ?? "en-US";
            },
            isPaused: false,
            readAnswer: scenario.readAnswer,
            answerSpeechRef,
            setAnswerSpeechVersion: (update) => { speechVersion = update(speechVersion); },
            soundEffects: false,
            successAudioRef: { current: null },
            currentItemRef: { current: { id: "a", answer: scenario.answer ?? "apple" } },
            recallProgressRef: {
                current: { answerWasFullyRevealed: scenario.revealed },
            },
            setCurrentInput: () => {},
            previousInputAtRef: { current: null },
            previousInputLengthRef: { current: 0 },
            resolveTurnWithItem: () => ({ id: "b" }),
            setTrackedItem: (item, slide) => {
                assert.equal(slide, true, "successful answers opt into a slide");
                nextItems.push(item.id);
            },
            posthog: { capture: () => {} },
            room: { id: "r" },
        });
        callback();
        assert.deepEqual(spoken.map(([text]) => text), scenario.expected);
        assert.deepEqual(nextItems, ["b"], "the next prompt belongs to the same player");
        if (scenario.expected.length) {
            assert.equal(spoken[0][1], scenario.lang ?? "en-US");
            assert.equal(answerSpeechRef.current, utterances[0]);
            assert.equal(speechVersion, 0, "answer completion has not occurred yet");
            utterances[0].onend();
            assert.equal(answerSpeechRef.current, null);
            assert.equal(speechVersion, 1, "the next question may now be read");
        } else {
            assert.equal(answerSpeechRef.current, null);
        }
    }
});

test("paused solo practice does not advance a question", () => {
    let advanced = false;
    const callback = getCallback("handleSuccess", {
        isPaused: true,
        currentItemRef: { current: { id: "a", answer: "apple" } },
        setTrackedItem: () => { advanced = true; },
    });
    callback();
    assert.equal(advanced, false);
});

test("active recall clock excludes paused intervals before and after resume", () => {
    const { getActiveElapsedMs } = load("lib/playground/active-clock.ts");

    // A pause starts at 2s. While paused, elapsed time stays frozen at 1s.
    assert.equal(getActiveElapsedMs(62_000, 1_000, 0, 2_000), 1_000);

    // After a 60s pause, one more active second brings elapsed time to 2s.
    assert.equal(getActiveElapsedMs(63_000, 1_000, 60_000, null), 2_000);

    // A later pause also stays excluded while it is still in progress.
    assert.equal(getActiveElapsedMs(100_000, 1_000, 60_000, 80_000), 19_000);
});

test("memory action isolates invalid rows and maps existing room item IDs", async () => {
    const roomId = "00000000-0000-4000-8000-000000000001";
    const item = { ...initial("existing_item-17"), roomId, updatedAt: now.toISOString() };
    const format = load("lib/playground/memory-sync-format.ts", { require: () => memory });
    const codec = load("lib/playground/memory-storage-id.ts", {
        require: id => id === "node:crypto" ? require(id) : format,
    });
    let authStatus = { userId: "u", error: null };
    let databaseError = null;
    const writes = [];
    const actions = load("lib/playground/memory-actions.ts", {
        performance,
        require: id => ({
            "@/lib/db/server": {
                createClient: async () => ({
                    from: () => ({
                        upsert: async rows => {
                            writes.push(rows);
                            return { error: databaseError, status: databaseError ? 400 : 201 };
                        },
                        select: () => ({ eq: () => ({ eq: async () => ({ data: writes[0] }) }) }),
                    }),
                }),
            },
            "@/lib/auth/memory-session": { getMemoryAuthStatus: async () => authStatus },
            "@/lib/playground/memory": memory,
            "./memory-sync-format": format,
            "./memory-storage-id": codec,
        })[id],
    });
    const sync = rows => actions.syncPlaygroundMemory(roomId, "u", rows);
    const result = await sync([{ ...item, stability: -1 }, item, null, { ...item, userId: "other" }]);
    assert.equal(result.type, "saved");
    assert.deepEqual(JSON.parse(JSON.stringify(result.rejected)), [
        { index: 0, reason: "stability" }, { index: 2, reason: "shape" }, { index: 3, reason: "owner" },
    ]);
    assert.equal(writes.length, 1);
    assert.equal(writes[0][0].id, codec.memoryStorageId(roomId, item.itemId));
    assert.match(writes[0][0].id, /^[\da-f]{8}-[\da-f]{4}-8[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    const loaded = await actions.loadPlaygroundMemory(roomId, [item.itemId]);
    assert.equal(loaded.memoryByItem[item.itemId].itemId, item.itemId);
    assert.equal((await sync(Array(501).fill(item))).type, "permanent");

    databaseError = { code: "23514", message: "private database details" };
    assert.equal((await sync([item])).rejected[0].reason, "database_error");
    databaseError = { code: "42501", message: "private database details" };
    assert.equal((await sync([item])).databaseCode, "42501");
    assert.equal(JSON.stringify(await sync([item])).includes("private database details"), false);
    databaseError = { code: "40001" };
    assert.equal((await sync([item])).type, "temporary");
    authStatus = { userId: null, error: null };
    assert.equal((await sync([item])).type, "auth_required");
    authStatus = { userId: null, error: { retryable: true } };
    assert.equal((await sync([item])).type, "temporary");
});

test("memory sync adapter handles beta auth errors and reports sampled safe metrics", async () => {
    const metrics = [];
    const denied = "Beta tester access required";
    const listeners = new Map();
    let rejection = new Error(denied);
    const events = {
        visibilityState: "hidden",
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: name => listeners.delete(name),
    };
    let options;
    let flushes = 0;
    let stopped = 0;
    const { startMemorySync } = load("lib/playground/memory-client.ts", {
        Math: { random: () => 0 },
        Error,
        window: events,
        document: events,
        require: id => ({
            "posthog-js": { default: { capture: (event, properties) => metrics.push([event, properties]) } },
            "@/lib/auth/beta-action": { BETA_ACTION_DENIED: denied },
            "./memory-actions": { syncPlaygroundMemory: async () => { throw rejection; } },
            "./memory-queue": { MemoryQueue: class {
                constructor(value) { options = value; }
                flush() { flushes++; }
                stop() { stopped++; }
            } },
        })[id],
    });
    const sync = startMemorySync("user-secret", "room-secret", "online");
    assert.equal((await options.send([initial()])).type, "auth_required");
    rejection = new Error("network failure");
    await assert.rejects(options.send([initial()]), rejection);
    listeners.get("pagehide")();
    listeners.get("visibilitychange")();
    listeners.get("online")();
    assert.equal(flushes, 3);
    const summary = { batch_size: 1, pending_count: 1, duration_ms: 12, retry_count: 0 };
    options.report(summary);
    options.report({ ...summary, error_type: "invalid_memory", invalid_fields: { timestamp: 1 } });
    assert.deepEqual(metrics.map(([event, p]) => [event, p.sample_rate]), [
        ["playground_memory_sync_succeeded", 0.1], ["playground_memory_sync_failed", 1],
    ]);
    assert.equal(JSON.stringify(metrics).includes("-secret"), false);
    sync.stop();
    assert.equal(listeners.size, 0);
    assert.equal(stopped, 1);
});

function clientCallbacks(names, globals) {
    const source = fs.readFileSync(
        path.join(root, "app/(game)/[link]/offline/Client.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
        "Client.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    const found = {};
    function visit(node) {
        if (
            ts.isVariableDeclaration(node) &&
            names.includes(node.name.getText(ast))
        )
            found[node.name.getText(ast)] = node.initializer.arguments[0];
        ts.forEachChild(node, visit);
    }
    visit(ast);
    return evaluate(
        names
            .map(
                (name) =>
                    "export const " +
                    name +
                    " = " +
                    ts
                        .createPrinter()
                        .printNode(ts.EmitHint.Expression, found[name], ast) +
                    ";",
            )
            .join("\n"),
        { LEARNING_DIAGNOSTICS_ENABLED: false, ...globals },
    );
}
test("actual solo Client callbacks cover all words and keep practicing without a budget reset", () => {
    for (const size of [20, 100]) {
        let time = now.getTime();
        class Clock extends Date {
            constructor(...args) {
                super(...(args.length ? args : [time]));
            }
            static now() {
                return time;
            }
        }
        const m = load("lib/playground/memory.ts", { Date: Clock });
        const sch = load("lib/playground/scheduler.ts", {
            Date: Clock,
            require: () => m,
        });
        const ref = (current) => ({ current }),
            noop = () => {};
        const items = Array.from({ length: size }, (_, i) => ({
            id: String(i),
            type: "typed_recall",
            answer: "abcdefgh",
        }));
        const events = [];
        const pending = new Map();
        const globals = {
            ...m,
            ...sch,
            Date: Clock,
            items,
            room: { id: "r" },
            answerMode: "input",
            itemModes: {},
            choiceCount: 4,
            isPaused: false,
            readAnswer: false,
            soundEffects: false,
            schedulerRef: ref(sch.createScheduler(items.map((x) => x.id), rng(17))),
            currentItemRef: ref(null),
            recallProgressRef: ref(null),
            sessionTurnNumberRef: ref(0),
            memoryByItemRef: ref({}),
            exposureGapAtStartRef: ref(null),
            predictedRetrievabilityAtPromptRef: ref(null),
            expectedTypingAtStartRef: ref(0),
            getTypingAnswer: require("../../backend/shared/typing-answer.cjs").getTypingAnswer,
            userTypingDelayRef: ref(220),
            authenticatedUserIdRef: ref("u"),
            memoryReadFailedRef: ref(false),
            memorySyncRef: ref({ queue: { enqueue: value => pending.set(value.itemId, value) } }),
            flushPendingMemory: noop,
            userReviewCountRef: ref(0),
            previousInputAtRef: ref(null),
            previousInputLengthRef: ref(0),
            successAudioRef: ref(null),
            posthog: {
                capture: (event, payload) => events.push({ event, ...payload }),
            },
        };
        for (const setter of [
            "setCurrentItem",
            "setItemPresentationKey",
            "setSlidePresentationKey",
            "setMemoryByItem",
            "setMasteryNow",
            "setCurrentInput",
            "setNextReviewAt",
            "setIsStarted",
        ]) globals[setter] = noop;
        const actual = clientCallbacks(
            [
                "setTrackedItem",
                "chooseItemForTurn",
                "resolveTurnWithItem",
                "updateLocalMemory",
                "handleRecallComplete",
                "handleSuccess",
            ],
            globals,
        );
        actual.setTrackedItem(actual.resolveTurnWithItem());
        const seen = new Set();
        for (let turn = 0; turn < size; turn++) {
            const item = globals.currentItemRef.current;
            assert(item, "solo play does not pause while reviews are not yet due");
            assert(!seen.has(item.id), "successful learning advances through the entire room");
            seen.add(item.id);
            time += 1200;
            actual.handleRecallComplete(observation());
            actual.handleSuccess();
        }
        assert.equal(seen.size, size);
        assert.equal(globals.schedulerRef.current.completedCycles, 1);
        assert.equal(globals.userReviewCountRef.current, size);
        const recallEvents = events.filter(
            (x) => x.event === "playground_item_recalled",
        );
        assert.equal(recallEvents.length, size);
        assert(
            recallEvents.every(
                (x) =>
                    x.scheduler_reason === "cycle" &&
                    x.memory_evidence === "strong_recall" &&
                    x.retry_need === "none",
            ),
        );
        assert(
            recallEvents.slice(8).every((x) =>
                x.stability_after ===
                recallEvents.find((prior) => prior.item_id === x.item_id)?.stability_after,
            ),
            "repeated practice must not imply fresh long-term recall",
        );
        assert(
            recallEvents.every(
                (x) => x.model_version === m.MEMORY_MODEL_VERSION,
        ));
        assert.equal(
            Object.keys(globals.schedulerRef.current.retries).length,
            0,
        );

        pending.clear();
        globals.memoryReadFailedRef.current = true;
        actual.updateLocalMemory(items[0], observation());
        assert.equal(
            pending.size,
            0,
            "fallback recall observations must stay out of the authenticated sync queue",
        );
    }
});

test("selection callbacks preserve the exposure interval when completing a scheduler turn", () => {
    const schedulerState = {
        current: { itemId: "a", reason: "early_practice" },
    };
    const calls = [];
    const callback = getCallback("handleSelectionAnswer", {
        currentItemRef: { current: { id: "a" } },
        isPaused: false,
        schedulerRef: { current: schedulerState },
        choiceCount: 4,
        recordRecognitionAnswer: (state) => { state.current = null; },
        memoryReadFailedRef: { current: true },
        recallProgressRef: { current: {} },
        updateAnswerModeMemory: (...args) => calls.push(args),
        exposureGapAtStartRef: { current: 30_000 },
        room: { id: "r" },
    });
    callback(true, false, 1_000, false);
    assert.equal(schedulerState.current, null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][5], 30_000, "memory eligibility uses the prompt exposure gap, not the scheduler label");
});

test("fallback answer-mode observations never enter authenticated sync queue", async () => {
    const m = load("lib/playground/memory.ts");
    const ref = (current) => ({ current });
    const item = { id: "a", type: "typed_recall", answer: "abcdefgh" };
    const pending = ref(new Map());
    const memory = ref({});
    let syncCalls = 0;
    const globals = {
        ...m,
        room: { id: "r" },
        items: [item],
        choiceCount: 1,
        authenticatedUserIdRef: ref("u"),
        memoryReadFailedRef: ref(true),
        memoryByItemRef: memory,
        memorySyncRef: ref({ queue: {
            enqueue: value => pending.current.set(value.itemId, value),
            flush: async () => { if (pending.current.size) syncCalls++; },
        } }),
        setMemoryByItem: () => {},
        setMasteryNow: () => {},
    };
    const actual = clientCallbacks(
        ["updateAnswerModeMemory", "flushPendingMemory"],
        globals,
    );

    actual.updateAnswerModeMemory(item, "input", true);
    await actual.flushPendingMemory();

    assert(memory.current.a, "the current session still updates its memory");
    assert.equal(pending.current.size, 0);
    assert.equal(syncCalls, 0);
});

test("actual input callbacks retain a wrong character through Backspace correction", () => {
    const source = fs.readFileSync(
        path.join(root, "components/recall/TypingView.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
            "TypingView.tsx",
            source,
            ts.ScriptTarget.Latest,
            true,
            ts.ScriptKind.TSX,
        ),
        names = ["resetInput", "moveToNext"],
        found = {};
    function visit(node) {
        if (
            ts.isVariableDeclaration(node) &&
            names.includes(node.name.getText(ast))
        )
            found[node.name.getText(ast)] = node.initializer;
        if (ts.isJsxAttribute(node) && node.name.getText(ast) === "onKeyDown")
            found.key = node.initializer.expression;
        ts.forEachChild(node, visit);
    }
    visit(ast);
    const print = (node) =>
        ts.createPrinter().printNode(ts.EmitHint.Expression, node, ast);
    const code =
        'let input=Array(5).fill(""),currentSelection=0; const setInput=v=>{input=v}; const setCurrentSelection=v=>{currentSelection=v};\n' +
        names
            .map((name) => "const " + name + " = " + print(found[name]) + ";")
            .join("\n") +
        "\nexport const key = " +
        print(found.key) +
        "; export const type = char => { const next=[...input]; next[currentSelection]=char; setInput(next); moveToNext(next); };";
    const ref = (current) => ({ current }),
        noop = () => {},
        observations = [];
    const actual = evaluate(code, {
        english: "apple",
        completedRef: ref(false),
        answerRevealed: false,
        manualHints: true,
        isKanaAnswer: false,
        kanaComposing: "",
        setKanaComposing: noop,
        kanaCommitSpansRef: ref([]),
        assistedPositions: [],
        hintEventsRef: ref([]),
        hintLength: 0,
        hintCount: 0,
        initialCueRatio: 0,
        initialCueLength: 0,
        timedHintCount: 0,
        learningMode: "free_recall",
        bombStatus: 0,
        attemptCountRef: ref(1),
        incorrectInputCountRef: ref(0),
        maxCorrectPrefixRef: ref(0),
        lastCorrectProgressAtRef: ref(0),
        firstKeyAtRef: ref(100),
        recallStartedAtRef: ref(0),
        inputFrameRef: ref(null),
        correctPrefixLength: input.correctPrefixLength,
        performance: { now: () => 1200 },
        getActiveElapsedMs: () => 0,
        onRecallComplete: (o) => observations.push(o),
        onSuccess: noop,
        onChangeInput: noop,
        setCharInput: noop,
        setIsFailAnimating: noop,
        setTimedHintCount: noop,
        setRevealedHintLength: noop,
        isSoundEffectsEnabled: () => false,
        console: { log: noop },
    });
    for (const char of "apx") actual.type(char);
    actual.key({ key: "Backspace", preventDefault: noop });
    for (const char of "ple") actual.type(char);
    assert.equal(observations.length, 1);
    assert.equal(observations[0].success, true);
    assert.equal(observations[0].firstAttemptCorrect, false);
    assert.equal(observations[0].incorrectInputCount, 1);
    assert.equal(memory.evaluateRecall(observations[0]).retryNeed, "confirm");
});
test("a renewed failure resets confirmation; clean rehearsal finishes short-term retries", () => {
    const state = scheduler.createScheduler(
        Array.from({ length: 10 }, (_, i) => String(i)),
        rng(9),
    );
    const first = scheduler.chooseNextUserItem(state);
    scheduler.recordUserAnswer(
        state,
        memory.evaluateRecall(observation({ success: false })),
    );
    function reachTarget(evaluation) {
        for (let count = 0; count < 100; count++) {
            const selected = scheduler.chooseNextUserItem(state);
            const target = selected.itemId === first.itemId;
            scheduler.recordUserAnswer(
                state,
                target ? evaluation : memory.evaluateRecall(observation()),
            );
            if (target) return;
        }
        assert.fail("retry target never returned");
    }
    reachTarget(memory.evaluateRecall(observation()));
    assert.equal(state.retries[first.itemId].successCount, 1);
    reachTarget(
        memory.evaluateRecall(observation({ elapsedSincePresentationMs: 0 })),
    );
    assert.equal(state.retries[first.itemId], undefined);
    reachTarget(memory.evaluateRecall(observation({ success: false })));
    assert.equal(
        state.retries[first.itemId].earliestTurn,
        state.turn + scheduler.SHORT_RETRY_GAP,
    );
    assert.equal(state.retries[first.itemId].reason, "failed_recall");
});

test("manual hints skip solved letters and spaces and never reveal the last unresolved letter", () => {
    assert.equal(input.nextHintPosition([], "a", []), null);
    assert.equal(input.nextHintPosition([], "cat", []), 0);
    assert.equal(input.nextHintPosition([], "cat", [0, 1]), null);
    assert.equal(
        input.nextHintPosition(
            ["r", "e", "c", "i", "e", "v", "e"],
            "receive",
            [],
        ),
        3,
    );
    assert.equal(
        input.nextHintPosition(
            ["a", "b", "c", "d", "e", "f", "g"],
            "abcdefghij",
            [],
        ),
        7,
    );
    assert.equal(
        input.nextHintPosition(
            ["a", "b", "c", "d", "e", "f", "g"],
            "abcdefghij",
            [7],
        ),
        8,
    );
    assert.equal(input.nextHintPosition([], "a b", [0]), null);
    assert.equal(memory.createTurnPlan(undefined).hintDelaysMs, null);
});

function getInputFunction(name, globals) {
    const source = fs.readFileSync(
        path.join(root, "components/recall/TypingView.tsx"),
        "utf8",
    );
    const ast = ts.createSourceFile(
        "Input.tsx",
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
    );
    let found;
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name)
            found = node.initializer;
        ts.forEachChild(node, visit);
    }
    visit(ast);
    assert(found);
    return evaluate(
        "export const callback = " +
            ts.createPrinter().printNode(ts.EmitHint.Expression, found, ast),
        { getActiveElapsedMs: () => 0, ...globals },
    ).callback;
}

test("manual hint shortcut is handled by the text input change path", () => {
    const source = fs.readFileSync(
        path.join(root, "components/recall/TypingView.tsx"),
        "utf8",
    );
    assert.match(source, /if \(char === " "\)/);
    assert.match(source, /if \(lastKeyWasSpaceRef\.current\)/);
    assert.match(source, /requestHint\(\)/);
});

test("full manual hint reuses the inline overlay and keeps typing enabled", () => {
    const source = fs.readFileSync(
        path.join(root, "components/recall/TypingView.tsx"),
        "utf8",
    );
    assert.match(
        source,
        /opacity-25 border-b border-\(--color-border\) flex items-center justify-center/,
    );
    assert.doesNotMatch(source, /確認して次へ/);
    assert.doesNotMatch(source, /text-blue-600/);
    assert.match(source, /\{!isReadonly && \(/);
    assert.doesNotMatch(
        source,
        /if \(completedRef\.current \|\| answerRevealed\) return;/,
    );
});

test("existing mistakes clear when hints appear, while new incorrect keys are ignored", () => {
    const source = fs.readFileSync(
        path.join(root, "components/recall/TypingView.tsx"),
        "utf8",
    );
    // Playground manual hints and timed online hints both check previously
    // entered mistakes at reveal time.
    assert.match(source, /shouldClearForTimedHint\(/);
    assert.match(source, /currentSelection,\s*kanaComposing,/);
    assert.doesNotMatch(source, /const hasIncorrectInput = isKanaAnswer/);
    assert.match(source, /onChangeInput\("", true\)/);

    // After a hint is displayed, wrong keys are ignored before input changes.
    assert.match(source, /const activeHintLength = manualHints/);
    assert.match(source, /shouldIgnoreIncorrectHintKey\(/);
    assert.doesNotMatch(source, /const incorrectAfterReveal =/);
    assert.doesNotMatch(source, /const typedInsideHint =/);
});

test("actual manual hint callback reveals the full answer and records one answer event", async () => {
    const { shouldClearForTimedHint } = await import("../lib/romaji-input.mjs");
    const typed = ["r", "e", "c", "i", "e", "v", "e"];
    const events = { current: [] };
    const lastKeyWasSpaceRef = { current: true };
    let answerRevealed = false;
    const callback = getInputFunction("requestHint", {
        manualHints: true,
        english: "receive",
        answerRevealed: false,
        isKanaAnswer: false,
        currentSelection: 6,
        kanaComposing: "",
        shouldClearForTimedHint,
        completedRef: { current: false },
        input: typed,
        onHintChange: () => {},
        resetInput: () => {},
        hintEventsRef: events,
        performance: { now: () => 7000 },
        recallStartedAtRef: { current: 0 },
        lastKeyWasSpaceRef,
        setAnswerRevealed: (value) => {
            answerRevealed = value;
        },
    });
    callback();
    assert.equal(typed.join(""), "recieve");
    assert.equal(answerRevealed, true);
    assert.equal(lastKeyWasSpaceRef.current, false);
    assert.equal(events.current.length, 1);
    assert.equal(events.current[0].kind, "answer");
    assert.equal(events.current[0].correctBefore, 5);
    assert.equal(events.current[0].source, "manual");
});

test("manual full hint clears incompatible pending romaji but keeps valid prefixes", async () => {
    const { shouldClearForTimedHint, shouldIgnoreIncorrectHintKey } =
        await import("../lib/romaji-input.mjs");
    for (const { answer, cells, cursor, composing, clears } of [
        { answer: "てすと", cells: ["", "", ""], cursor: 0, composing: "s", clears: true },
        { answer: "てすと", cells: ["", "", ""], cursor: 0, composing: "t", clears: false },
        { answer: "ちゃ", cells: ["", ""], cursor: 0, composing: "ch", clears: false },
        { answer: "さくら", cells: ["さ", "", ""], cursor: 1, composing: "k", clears: false },
        { answer: "さくら", cells: ["さ", "た", ""], cursor: 2, composing: "", clears: true },
        { answer: "cat", cells: ["c", "x", ""], cursor: 2, composing: "", clears: true },
    ]) {
        let resetCount = 0;
        let revealed = false;
        const callback = getInputFunction("requestHint", {
            manualHints: true,
            english: answer,
            answerRevealed: false,
            completedRef: { current: false },
            input: cells,
            currentSelection: cursor,
            kanaComposing: composing,
            shouldClearForTimedHint,
            hintEventsRef: { current: [] },
            lastKeyWasSpaceRef: { current: false },
            onHintChange: () => {},
            setAnswerRevealed: (value) => { revealed = value; },
            resetInput: () => { resetCount++; },
        });
        callback();
        assert.equal(revealed, true, `Hint not revealed for ${answer}`);
        assert.equal(resetCount, Number(clears), `Wrong reset for ${answer}/${composing}`);
    }
    // A rejected pre-hint "s" no longer blocks a correct "t" after reset.
    assert.equal(shouldIgnoreIncorrectHintKey("てすと", 0, "", "t", 3), false);
    assert.equal(shouldIgnoreIncorrectHintKey("てすと", 0, "s", "t", 3), true);
});

test("actual solo progress callback keeps hint state without bomb pressure", () => {
    const saved = { current: null };
    const callback = getCallback("handleRecallProgress", {
        recallProgressRef: saved,
    });
    callback({ hintCount: 1, revealedHintChars: 1 });
    assert.equal(saved.current.hintCount, 1);
    assert.equal(saved.current.revealedHintChars, 1);
});

test("correcting an interior letter completes a retained learning answer", () => {
    const observations = [];
    let advanced = 0;
    const noop = () => {};
    const ref = (current) => ({ current });
    const callback = getInputFunction("moveToNext", {
        completedRef: ref(false),
        answerRevealed: false,
        english: "apple",
        currentSelection: 2,
        manualHints: true,
        isKanaAnswer: false,
        setKanaComposing: noop,
        kanaCommitSpansRef: ref([]),
        setCharInput: noop,
        hintLength: 1,
        hintCount: 1,
        assistedPositions: [2],
        hintEventsRef: ref([]),
        initialCueRatio: 0,
        initialCueLength: 0,
        timedHintCount: 0,
        learningMode: "free_recall",
        incorrectInputCountRef: ref(1),
        attemptCountRef: ref(2),
        maxCorrectPrefixRef: ref(2),
        lastCorrectProgressAtRef: ref(0),
        firstKeyAtRef: ref(100),
        recallStartedAtRef: ref(0),
        correctPrefixLength: input.correctPrefixLength,
        performance: { now: () => 8000 },
        onRecallComplete: (x) => observations.push(x),
        onSuccess: () => advanced++,
        onChangeInput: noop,
        setInput: noop,
        setCurrentSelection: noop,
        setTimedHintCount: noop,
        setRevealedHintLength: noop,
        bombStatus: 0,
        console: { log: noop },
        isSoundEffectsEnabled: () => false,
    });
    callback(Array.from("apple"));
    assert.equal(advanced, 1);
    assert.equal(observations[0].outcome, "cued_recall");
    assert.equal(observations[0].revealedHintChars, 1);
    assert.equal(observations[0].firstAttemptCorrect, false);
});

// Regression tests for continuous priority and first-review encoding.
test("second cycle prioritizes lower retrievability even within the old <0.8 bucket", () => {
    const state = scheduler.createScheduler(["low", "mid", "high"], () => 0.5);
    state.cycleQueue = [];
    const base = initial();
    const histories = Object.fromEntries(
        [["low", 1], ["mid", 2], ["high", 4]].map(([id, stability]) => [
            id,
            { ...base, itemId: id, stability, reviewCount: 2,
              lastReviewedAt: "2026-10-06T00:00:00Z" },
        ]),
    );
    const actual = [];
    for (let i = 0; i < 3; i++) {
        const next = scheduler.chooseNextUserItem(state, histories, () => 0.5, now.getTime());
        actual.push(next.itemId);
        histories[next.itemId].lastPresentedAt = now.toISOString();
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    }
    assert.deepEqual(actual, ["low", "mid", "high"]);
});
test("first independent recall increases stability without crediting recent exposure", () => {
    const original = memory.createInitialMemory("u", "r", "w");
    assert.equal(apply(original, observation()).stability, memory.INITIAL_CLEAR_RECALL_STABILITY);
    assert.equal(apply(original, observation({ additionalHintCount: 1 })).stability,
        original.stability);
    assert.equal(apply(original, observation({ elapsedSincePresentationMs: 100 })).stability,
        original.stability);
});


test("mastery progress counts current, three-hour and 24-hour retrievability", () => {
    const stamp = Date.parse("2026-11-20T00:00:00Z");
    const lastReviewedAt = new Date(stamp).toISOString();
    const stable = {
        ...initial("stable"),
        stability: 10,
        lastReviewedAt,
    };
    const fragile = {
        ...initial("fragile"),
        stability: 0.5,
        lastReviewedAt,
    };
    const unknown = memory.createInitialMemory("u", "r", "unknown");
    const records = { stable, fragile, unknown };

    assert.equal(memory.MASTERY_RETRIEVABILITY_THRESHOLD, 0.8);
    const first = memory.getMasteryProgress(
        ["stable", "fragile", "unknown", "missing", "stable"],
        records,
        stamp,
    );
    assert.equal(first.total, 4);
    assert.equal(first.masteredNow, 2);
    assert.equal(first.masteredAfter3Hours, 1);
    assert.equal(first.masteredAfter24Hours, 1);

    const dayLater = memory.getMasteryProgress(
        ["stable", "fragile", "unknown", "missing"],
        records,
        stamp + 24 * 60 * 60 * 1000,
    );
    assert.equal(dayLater.masteredNow, 1);
    assert.equal(dayLater.masteredAfter3Hours, 1);
    assert.equal(dayLater.masteredAfter24Hours, 1);

    const afterThreeDays = memory.getMasteryProgress(
        ["stable", "fragile"],
        records,
        stamp + 3 * 24 * 60 * 60 * 1000,
    );
    assert.equal(afterThreeDays.masteredNow, 0);
    assert.equal(afterThreeDays.masteredAfter3Hours, 0);
    assert.equal(afterThreeDays.masteredAfter24Hours, 0);

    const invalid = { ...initial("invalid"), lastReviewedAt: "not-a-date" };
    const invalidProgress = memory.getMasteryProgress(
        ["invalid"],
        { invalid },
        stamp,
    );
    assert.equal(invalidProgress.masteredNow, 0);
    assert.equal(invalidProgress.masteredAfter3Hours, 0);
    assert.equal(invalidProgress.masteredAfter24Hours, 0);

    const empty = memory.getMasteryProgress([], records, stamp);
    assert.equal(empty.total, 0);
    assert.equal(empty.masteredNow, 0);
    assert.equal(empty.masteredAfter3Hours, 0);
    assert.equal(empty.masteredAfter24Hours, 0);
});

test("failed and fully revealed typing never reset the independent review date", () => {
    for (const event of [{ success: false }, { answerWasFullyRevealed: true }, { finalCueRatio: 0.5 }]) {
        const first = apply(undefined, observation(event));
        assert.equal(memory.getRetrievability(first, now.getTime()), 0);
        assert.equal(first.lastPresentedAt, now.toISOString());
        const previous = { ...initial(), lastReviewedAt: new Date(now.getTime() - 86_400_000).toISOString() };
        assert.equal(apply(previous, observation(event)).lastReviewedAt, previous.lastReviewedAt);
    }
});

test("demonstrated spacing extends the forecast while immediate recognition gives no new anchor", () => {
    const choose = (previous, hours, choiceCount = 4) => memory.recordAnswerModeResult({
        memory: previous, userId: "u", roomId: "r", itemId: "a", mode: "selection", success: true,
        choiceCount, now: new Date(now.getTime() + hours * 3_600_000),
    });
    const first = choose(undefined, 0);
    assert.ok(choose(undefined, 0, 2).answerModeStats.recognition.stability < first.answerModeStats.recognition.stability);
    const immediate = choose(first, 1 / 3600);
    assert.equal(immediate.answerModeStats.recognition.lastReviewedAt, first.answerModeStats.recognition.lastReviewedAt);
    const spaced = choose(first, 3);
    assert.ok(memory.getRecognitionRetrievability(spaced, now.getTime() + 6 * 3_600_000) >= 0.8);
});

test("a mixed room prioritizes a due selection over a freshly recalled typing word", () => {
    const state = scheduler.createScheduler(["typing", "choice"]);
    const failedChoice = memory.recordAnswerModeResult({ userId: "u", roomId: "r", itemId: "choice", mode: "selection", success: false, now: new Date(now.getTime() - 120_000) });
    const next = scheduler.chooseNextUserItem(state, { typing: initial("typing"), choice: failedChoice },
        () => 0.9, now.getTime(), "input", { choice: "selection" });
    assert.equal(next.itemId, "choice");
    assert.equal(next.reason, "long_term_due");
});

test("waiting with the prompt open does not increase spacing credit", () => {
    const stamp = now.getTime();
    const threeHours = 3 * 3_600_000;
    const previous = {
        ...initial(),
        lastReviewedAt: new Date(stamp - threeHours).toISOString(),
    };
    const typed = apply(previous, observation({ elapsedSincePresentationMs: 1000 }));
    assert.equal(typed.stability, previous.stability);
    assert.equal(typed.lastReviewedAt, previous.lastReviewedAt);

    const choose = (base, time, exposureGapMs) => memory.recordAnswerModeResult({
        memory: base, userId: "u", roomId: "r", itemId: "a",
        mode: "selection", success: true, now: new Date(time), exposureGapMs,
    });
    const first = choose(undefined, stamp - threeHours);
    const immediatePrompt = choose(first, stamp, 1000);
    assert.equal(immediatePrompt.answerModeStats.recognition.lastReviewedAt,
        first.answerModeStats.recognition.lastReviewedAt);
    assert.equal(immediatePrompt.answerModeStats.recognition.stability,
        first.answerModeStats.recognition.stability);
    assert.ok(choose(first, stamp, threeHours).answerModeStats.recognition.stability >
        first.answerModeStats.recognition.stability);
});

test("an immediate clean selection clears short-term confirmation", () => {
    const state = scheduler.createScheduler(["review", "other"]);
    state.retries.review = {
        itemId: "review", earliestTurn: 1, latestTurn: 2,
        reason: "uncertain_recall", successCount: 1,
    };
    const stamp = now.getTime();
    assert.equal(scheduler.chooseNextUserItem(state, {}, () => 0.9, stamp).itemId, "review");
    scheduler.recordRecognitionAnswer(state, "review", false, stamp, 1000);
    assert.equal(state.retries.review, undefined);
    assert.equal(scheduler.chooseNextUserItem(state, {}, () => 0.9, stamp).itemId, "other");
    scheduler.recordRecognitionAnswer(state, "other", false, stamp);
    assert.equal(scheduler.chooseNextUserItem(state, {}, () => 0.9, stamp).itemId, "review");
    scheduler.recordRecognitionAnswer(state, "review", false, stamp, 5000);
    assert.equal(state.retries.review, undefined);
});

test("a full retry pool uses an answered filler before a retry becomes due", () => {
    const state = scheduler.createScheduler(["a", "b", "c", "d", "filler", "new"]);
    for (const itemId of ["a", "b", "c", "d"]) {
        state.retries[itemId] = {
            itemId, earliestTurn: 2, latestTurn: 4, reason: "failed_recall", successCount: 0,
        };
    }
    state.userAnswered.filler = 1;
    state.cycleQueue = ["new"];
    assert.equal(scheduler.chooseNextUserItem(state).itemId, "filler");
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation({ success: false })));
    assert.equal(Object.keys(state.retries).length, 4);
    assert.ok(state.cycleQueue.includes("filler"));
    assert.equal(scheduler.chooseNextUserItem(state).retry?.earliestTurn, 2);
});

test("single-option Client answers persist exposure without recognition credit", () => {
    const item = { id: "single", answer: "answer" };
    const records = { current: {} };
    const state = scheduler.createScheduler([item.id]);
    scheduler.chooseNextUserItem(state);
    const actual = clientCallbacks(["handleSelectionAnswer", "updateAnswerModeMemory"], {
        ...memory,
        room: { id: "r" }, items: [item], choiceCount: 1,
        currentItemRef: {current:item}, schedulerRef: {current:state},
        isPaused: false, authenticatedUserIdRef: {current:"u"},
        memoryReadFailedRef: {current:true},
        memoryByItemRef: records, memorySyncRef: {current:null},
        recallProgressRef: {current:null}, exposureGapAtStartRef: {current:null},
        setMemoryByItem: () => {}, setMasteryNow: () => {},
    });
    actual.handleSelectionAnswer(true, false, 500, false);
    assert.equal(state.current, null);
    assert.equal(records.current.single.reviewCount, 0);
    assert.equal(records.current.single.answerModeStats, undefined);
    assert.equal(records.current.single.lastReviewedAt, null);
    assert(Number.isFinite(Date.parse(records.current.single.lastPresentedAt)));
    assert.equal(scheduler.chooseNextUserItem(state, records.current).itemId, item.id);
});

test("offline question transitions are requested only after success", () => {
    const source = fs.readFileSync(
        path.join(root, "app/(game)/[link]/offline/Client.tsx"),
        "utf8",
    );
    assert.match(source, /setTrackedItem\(resolveTurnWithItem\(\), true\)/);
    assert.match(source, /setTrackedItem\(resolveTurnWithItem\(\)\);/);
    assert.match(source, /setSlidePresentationKey\(slide \? sessionTurnNumberRef\.current : null\)/);
    assert.match(source, /slideQuestion=\{slidePresentationKey === itemPresentationKey\}/);
});

test("repeated presentations of the same item get distinct transition keys", () => {
    const keys = [];
    const slides = [];
    const callback = getCallback("setTrackedItem", {
        currentItemRef: { current: null },
        setCurrentItem: () => {},
        recallProgressRef: { current: null },
        sessionTurnNumberRef: { current: 0 },
        setItemPresentationKey: (key) => keys.push(key),
        setSlidePresentationKey: (key) => slides.push(key),
        memoryByItemRef: { current: {} },
        predictedRetrievabilityAtPromptRef: { current: null },
        exposureGapAtStartRef: { current: null },
        expectedTypingAtStartRef: { current: 0 },
        itemModes: {},
        answerMode: "input",
        getExposureGap: () => null,
        getTypingAnswer: (item) => item.answer,
        userTypingDelayRef: { current: 220 },
    });
    const item = { id: "same", answer: "apple" };
    callback(item);
    callback(item, true);
    callback(item, true);
    callback(item);
    assert.deepEqual(keys, [1, 2, 3, 4]);
    assert.deepEqual(slides, [null, 2, 3, null]);
});

test("shared slide motion scales to the rendered width", () => {
    const { slideFrames } = load("components/layout/slide-motion.ts");
    const positions = (phase, width) => Array.from(slideFrames(phase, width), frame => frame.transform);
    assert.deepEqual(positions("push-in", 320), ["translateX(320px)", "translateX(0)"]);
    assert.deepEqual(positions("under-out", 320), ["translateX(0)", "translateX(-160px)"]);
    assert.deepEqual(positions("push-in", 448), ["translateX(448px)", "translateX(0)"]);
    assert.deepEqual(positions("pop-out", 448), ["translateX(0)", "translateX(448px)"]);
});

test("navigation and local question slides read the same duration and offset tokens", () => {
    const readLayout = (file) => fs.readFileSync(path.join(root, "components/layout", file), "utf8");
    const css = readLayout("slide-motion.css");
    const tokens = Object.fromEntries(Array.from(css.matchAll(/(--etb-slide-[\w-]+):\s*([^;]+);/g), match => [match[1], match[2]]));
    const { getSlideMotion, slideFrames } = load("components/layout/slide-motion.ts", {
        document: { documentElement: {} },
        getComputedStyle: () => ({
            getPropertyValue: (name) => tokens[name] ?? "",
        }),
    });
    const defaults = getSlideMotion();
    assert.equal(defaults.timing.duration, 400);
    assert.equal(defaults.timing.easing, tokens["--etb-slide-easing"]);
    assert.equal(defaults.offset, 0.5);
    tokens["--etb-slide-duration"] = "0.25s";
    tokens["--etb-slide-offset"] = "0.25";
    const changed = getSlideMotion();
    assert.equal(changed.timing.duration, 250);
    assert.equal(slideFrames("under-out", 320, changed.offset)[1].transform, "translateX(-80px)");
    assert.match(readLayout("navigation.css"), /animation-duration: var\(--etb-slide-duration\)/);
    assert.match(readLayout("Navigation.tsx"), /const \{ timing, offset \} = getSlideMotion\(\)/);
    assert.match(readLayout("SlideTransition.tsx"), /const \{ timing, offset \} = getSlideMotion\(\)/);
    assert.doesNotMatch(fs.readFileSync(path.join(root, "components/game/GameView.tsx"), "utf8"), /duration=\{200\}/);
});

test("solo slides clip at the game edges independently of the centered content width", () => {
    const game = fs.readFileSync(path.join(root, "components/game/GameView.tsx"), "utf8");
    const slide = fs.readFileSync(path.join(root, "components/layout/SlideTransition.tsx"), "utf8");
    assert.match(game, /const\s+fullWidthQuestion\s*=\s*soloMode\s*&&\s*isStarted\s*&&\s*currentItem\s*!==\s*null\s*&&\s*!!room\s*&&\s*!serverError/);
    assert.match(game, /w-full \$\{fullWidthQuestion \? "" : "max-w-3xl px-4"\}/);
    assert.match(game, /fullWidthQuestion \? "px-4"/);
    assert.match(game, /<div\s+className="w-full max-w-3xl px-4">\s*\{masteryProgress\}\s*<\/div>/);
    assert.match(game, /contentClassName="max-w-3xl"/);
    assert.match(game, /getDistance=\{getQuestionSlideDistance\}/);
    assert.match(slide, /w-full flex-col overflow-x-clip/);
    assert.match(slide, /mx-auto flex h-full min-w-0 w-full flex-col/);
    assert.match(slide, /left: "50%"/);
    assert.match(slide, /marginLeft: `\$\{-width \/ 2\}px`/);
    assert.match(slide, /slideFrames\("push-in", customDistance \?\? live\.offsetWidth, offset\)/);
    assert.match(slide, /slideFrames\("under-out", customDistance \?\? width, offset\)/);
});

test("question slide distance uses the widest visible question element and both gutters", () => {
    let desktop = true;
    const { getQuestionSlideDistance } = load("components/game/question-slide-distance.ts", {
        window: { matchMedia: () => ({ matches: desktop }) },
        getComputedStyle: () => ({ paddingLeft: "16px", paddingRight: "16px" }),
    });
    const make = (width, ...parts) => ({
        offsetWidth: width,
        querySelector: () => ({
            querySelectorAll: () => parts.map(offsetWidth => ({ offsetWidth })),
        }),
    });
    assert.equal(getQuestionSlideDistance(make(768, 300, 512)), 544);
    assert.equal(getQuestionSlideDistance(make(768, 620, 512)), 652);
    assert.equal(getQuestionSlideDistance(make(768, 100, 160)), 192);
    assert.equal(getQuestionSlideDistance(make(640, 640)), 640);
    assert.equal(getQuestionSlideDistance(make(768)), 768);
    desktop = false;
    assert.equal(getQuestionSlideDistance(make(390, 100, 200)), 390);
});

test("slide cursor uses destination geometry and restores animated transforms", async () => {
    let transform = "translateX(12px)";
    let priority = "";
    let refreshes = 0;
    let finish;
    const animation = { playState: "running", finished: new Promise(resolve => { finish = resolve; }) };
    const rect = { left: 100, top: 20, width: 80, height: 30 };
    const button = { closest: () => button, getBoundingClientRect: () => rect };
    const element = {
        isConnected: true,
        animate: () => animation,
        style: {
            getPropertyValue: () => transform,
            getPropertyPriority: () => priority,
            setProperty: (_name, value, important = "") => { transform = value; priority = important; },
            removeProperty: () => { transform = ""; priority = ""; },
        },
    };
    const cursor = load("components/layout/slide-cursor.ts", {
        window: { dispatchEvent: () => { refreshes++; } },
        Event: class {},
        document: {
            elementFromPoint: () => {
                assert.equal(transform, "none");
                assert.equal(priority, "important");
                return button;
            },
        },
    });
    cursor.animateSlideEntrance(element, [], {});
    assert.equal(refreshes, 1, "refresh happens at animation start");
    assert.equal(cursor.getSlideCursorTarget(120, 30).rect, rect);
    assert.equal(transform, "translateX(12px)");
    assert.equal(priority, "");
    assert.equal(cursor.isSlideCursorActive(), true);
    finish();
    await Promise.resolve();
    assert.equal(cursor.isSlideCursorActive(), false);
    assert.equal(refreshes, 2);
});

test("native slide cursor resolves the new DOM when captured content cannot be hit", () => {
    const rect = { left: 100, top: 20, right: 180, bottom: 50, width: 80, height: 30 };
    const button = {
        closest: selector => selector.includes("inert") ? null : button,
        getClientRects: () => [rect],
        getBoundingClientRect: () => rect,
    };
    const cursor = load("components/layout/slide-cursor.ts", {
        window: { dispatchEvent: () => {} },
        Event: class {},
        getComputedStyle: () => ({ visibility: "visible", pointerEvents: "auto" }),
        document: { elementFromPoint: () => null, querySelectorAll: () => [button] },
    });
    cursor.beginNativeSlideCursor();
    assert.equal(cursor.getSlideCursorTarget(120, 30).element, button);
    assert.equal(cursor.getSlideCursorTarget(90, 30), null);
    cursor.endNativeSlideCursor();
    assert.equal(cursor.getSlideCursorTarget(120, 30), null);
});

test("shared morph rectangles interpolate both axes and retarget without jumping", () => {
    const { interpolateMorphRect, sameMorphRect } = load("components/layout/morph-motion.ts");
    const start = { x: 20, y: 100, width: 300, height: 120 };
    const target = { x: 10, y: 20, width: 700, height: 520 };
    const middle = interpolateMorphRect(start, target, 0.5);
    assert.deepEqual({ ...middle }, { x: 15, y: 60, width: 500, height: 320 });
    const resized = { ...target, height: 620 };
    assert.equal(sameMorphRect(target, resized), false);
    assert.deepEqual({ ...interpolateMorphRect(middle, resized, 0) }, { ...middle });
    assert.deepEqual({ ...interpolateMorphRect(middle, resized, 1) }, resized);
});

test("page morph keeps the same eased curve for a fixed target", () => {
    const { advanceMorphRect, interpolateMorphRect } = load("components/layout/morph-motion.ts");
    const origin = { x: 20, y: 100, width: 300, height: 120 };
    const target = { x: 10, y: 20, width: 700, height: 520 };
    let state = { rect: origin, progress: 0 };
    for (const progress of [0.1, 0.35, 0.7, 0.91, 1]) {
        state = advanceMorphRect(state.rect, target, state.progress, progress);
        const expected = interpolateMorphRect(origin, target, progress);
        for (const key of Object.keys(expected)) assert.ok(Math.abs(state.rect[key] - expected[key]) < 1e-9);
        assert.equal(state.progress, progress);
    }
});

test("page morph advances even when its destination changes every frame", () => {
    const { advanceMorphRect } = load("components/layout/morph-motion.ts");
    let state = { rect: { x: 0, y: 0, width: 100, height: 50 }, progress: 0 };
    for (let i = 1; i <= 20; i++) {
        const target = { x: 200 + i, y: 100 + i, width: 500 + i, height: 300 + i };
        const previous = state;
        state = advanceMorphRect(state.rect, target, state.progress, i / 20);
        assert.ok(state.rect.x > previous.rect.x);
        assert.ok(state.rect.height > previous.rect.height);
        assert.ok(state.progress > previous.progress);
        if (i === 20) assert.deepEqual({ ...state.rect }, target);
    }
});

test("page morph crops long rooms to the visible viewport in both directions", () => {
    const { intersectMorphRect, visibleMorphTransform, morphClipInsets, advanceMorphRect } = load("components/layout/morph-motion.ts");
    const screen = { x: 0, y: 0, width: 1200, height: 800 };
    const room = { x: 250, y: 100, width: 896, height: 6000 };
    const visible = intersectMorphRect(room, screen);
    assert.deepEqual({ ...visible }, { x: 250, y: 100, width: 896, height: 700 });
    assert.deepEqual(Array.from(morphClipInsets(room, visible)), [0, 0, 5300, 0]);
    const card = { x: 250, y: 240, width: 432, height: 180 };
    const opening = advanceMorphRect(card, visible, 0, 0.5).rect;
    const closing = advanceMorphRect(visible, card, 0, 0.5).rect;
    assert.equal(opening.height, 440);
    assert.equal(closing.height, 440);
    const scrolled = { ...room, y: -300 };
    const scrolledVisible = intersectMorphRect(scrolled, screen);
    assert.deepEqual({ ...scrolledVisible }, { x: 250, y: 0, width: 896, height: 800 });
    assert.deepEqual(Array.from(morphClipInsets(scrolled, scrolledVisible)), [300, 0, 4900, 0]);
    const transform = visibleMorphTransform(scrolled, scrolledVisible, card);
    assert.equal(scrolled.x + transform.dx + (scrolledVisible.x - scrolled.x) * transform.sx, card.x);
    assert.equal(scrolled.y + transform.dy + (scrolledVisible.y - scrolled.y) * transform.sy, card.y);
    assert.equal(scrolledVisible.height * transform.sy, card.height);
    assert.equal(intersectMorphRect({ ...card, y: 1000 }, screen).height, 0);
});

test("visible morph handoff is identity even when the full destination extends offscreen", () => {
    const { intersectMorphRect, visibleMorphTransform, morphClipInsets } = load("components/layout/morph-motion.ts");
    const full = { x: -20, y: -300, width: 1000, height: 6000 };
    const screen = { x: 0, y: 0, width: 800, height: 700 };
    const visible = intersectMorphRect(full, screen);
    assert.deepEqual({ ...visible }, screen);
    assert.deepEqual({ ...visibleMorphTransform(full, visible, visible) }, { sx: 1, sy: 1, dx: 0, dy: 0 });
    assert.deepEqual(Array.from(morphClipInsets(full, visible)), [300, 180, 5000, 20]);
});
