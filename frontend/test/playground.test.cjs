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
    let coverage = null,
        lastCycle = 0;
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
        if (selected.advancesCycle) lastCycle = selected.turn;
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
        if (i === 0) assert.equal(selected.reason, "long_term_due");
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    }
    assert.deepEqual(order, ["hard-due", "due", "recent", "untouched"]);
    assert.equal(state.initialPriorityApplied, true);
});

test("interleaved review targets the weakest previously answered word without consuming the cycle", () => {
    const timestamp = now.getTime();
    const oldReview = new Date(timestamp - 2 * 60 * 60_000).toISOString();
    const state = scheduler.createScheduler(["old", "older", "new", "next"], () => 0.5);
    state.initialPriorityApplied = true;
    state.turn = 6;
    state.cycleQueue = ["new", "next"];
    state.userAnswered = { old: 1, older: 1 };
    state.lastUserItem = "next";
    const memories = {
        old: { ...initial("old"), stability: 3, lastReviewedAt: oldReview },
        older: { ...initial("older"), stability: 0.4, lastReviewedAt: oldReview },
    };
    const queueBefore = [...state.cycleQueue];
    const chosen = scheduler.chooseNextUserItem(state, memories, () => 0, timestamp);
    assert.equal(chosen.itemId, "older");
    assert.equal(chosen.reason, "spaced_review");
    assert.equal(chosen.advancesCycle, false);
    assert.deepEqual(Array.from(state.cycleQueue), queueBefore);

    scheduler.saveSchedulerState("playground", "review-user", "review-room", state, timestamp);
    const restored = scheduler.loadSchedulerState(
        "playground", "review-user", "review-room",
        state.itemIds, memories, timestamp + 1000,
    );
    assert.equal(restored.current.itemId, "older");
    assert.equal(restored.current.reason, "spaced_review");

    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    assert.deepEqual(Array.from(state.cycleQueue), queueBefore);
});

test("interleaved review is optional and respects exposure cooldowns", () => {
    const timestamp = now.getTime();
    const oldReview = new Date(timestamp - 10 * 60_000).toISOString();
    const state = scheduler.createScheduler(["old", "new", "next"], () => 0.5);
    state.initialPriorityApplied = true;
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
    recent.initialPriorityApplied = true;
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
    state.initialPriorityApplied = true;
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


test("reload continues the exact pending cycle instead of reshuffling", () => {
    const ids = ["a", "b", "c", "d"];
    const state = scheduler.createScheduler(ids, rng(18));
    const timestamp = now.getTime();
    const first = scheduler.chooseNextUserItem(state, {}, rng(1), timestamp);
    scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    scheduler.saveSchedulerState("playground", "reload-user", "reload-room", state, timestamp);
    const expected = scheduler.chooseNextUserItem(state, {}, rng(2), timestamp);
    const restored = scheduler.loadSchedulerState(
        "playground", "reload-user", "reload-room", ids, {}, timestamp + 1000,
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
        "playground", "retry-user", "retry-room", ids, {}, timestamp + 1000,
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
        "playground", "retry-user", "retry-room", ids, {}, timestamp + 2000,
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
        // One-word room: there are no safe fillers before this deadline.
        assert.equal(scheduler.chooseNextUserItem(state, {}, rng(1), deadline - 1), null);
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
    assert.equal(typo.retryNeed, "none");
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

test("all held words remain absent from user/BOT selection until due", () => {
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
    assert.equal(scheduler.chooseNextUserItem(state, {}, rng(4), now.getTime()), null);
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
        "playground", "hold-user", "room", ["hard", "new"], {}, time + 10_000,
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
            "playground", "old-cache", "room", ["old"], {}, time + 1_000,
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
            scheduler.loadSchedulerState(mode, user, room, ids, {}, now.getTime()),
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
        "playground", "delayed", "room", ids, memories,
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
        "playground", "edit", "room", ids, {}, timestamp + 1000,
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
            "playground", "bad", "room", ["a"], {}, now.getTime(),
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
test("four persistently failing words block new introductions", () => {
    for (const size of [4, 8, 20, 100]) {
        const result = simulate(size, {
            kind: () => "fail",
            turns: 120,
        });
        const introduced = new Set(result.trace.map((x) => x.itemId));
        assert(introduced.size >= 1);
        assert(introduced.size <= Math.min(4, size));
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
    const current = { ...initial(), stability: 5 };
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
    assert.equal(memory.evaluateRecall(typo).retryNeed, "none");
    assert.equal(
        memory.evaluateRecall(full).memoryEvidence,
        "insufficient_evidence",
    );
    assert.equal(memory.evaluateRecall(full).retryNeed, "short");
    assert(apply(current, typo).stability >= current.stability);
    assert(apply(current, full).stability < current.stability);
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
    assert.equal(evaluation.retryNeed, "none");
    assert.equal(evaluation.independent, true);
    assert.equal(apply({ ...initial(), stability: 5 }, slow).stability, 5);
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
        { mode: "answer", revealed: false, expected: ["apple"] },
        { mode: "answer", revealed: true, expected: ["apple"] },
        { mode: "question", revealed: false, expected: [] },
        { mode: "none", revealed: false, expected: [] },
    ]) {
        const spoken = [];
        const nextItems = [];
        const synthesis = {
            cancel: () => {},
            speak: (utterance) => spoken.push([utterance.text, utterance.lang]),
        };
        class Utterance {
            constructor(text) {
                this.text = text;
            }
        }
        const callback = getCallback("handleSuccess", {
            window: { speechSynthesis: synthesis },
            SpeechSynthesisUtterance: Utterance,
            isPaused: false,
            offlineVoiceReading: scenario.mode,
            soundEffects: false,
            successAudioRef: { current: null },
            currentItemRef: { current: { id: "a", answer: "apple" } },
            recallProgressRef: {
                current: { answerWasFullyRevealed: scenario.revealed },
            },
            setCurrentInput: () => {},
            previousInputAtRef: { current: null },
            previousInputLengthRef: { current: 0 },
            resolveTurnWithItem: () => ({ id: "b" }),
            setTrackedItem: (item) => nextItems.push(item.id),
            posthog: { capture: () => {} },
            room: { id: "r" },
        });
        callback();
        assert.deepEqual(spoken.map(([text]) => text), scenario.expected);
        assert.deepEqual(nextItems, ["b"], "the next prompt belongs to the same player");
        if (scenario.expected.length) assert.equal(spoken[0][1], "en-US");
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

test("memory sync serializes newer writes and retains unsent data on rejection", async () => {
    const pending = { current: new Map([["a", initial()]]) };
    const inFlight = { current: null };
    let release,
        calls = 0,
        savingError = false;
    const snapshots = [];
    const flush = getCallback("flushPendingMemory", {
        cachePendingMemory: () => {},
        authenticatedUserIdRef: { current: "u" },
        memoryPersistenceDisabledRef: { current: false },
        pendingMemoryRef: pending,
        syncInFlightRef: inFlight,
        setSaveError: (value) => {
            savingError = value;
        },
        room: { id: "r" },
        posthog: { capture: () => {} },
        console: { error: () => {} },
        syncPlaygroundMemory: (snapshot) => {
            snapshots.push(snapshot);
            calls++;
            if (calls === 1)
                return new Promise((resolve) => {
                    release = resolve;
                });
            return Promise.resolve(null);
        },
    });
    const first = flush();
    const newer = { ...initial(), reviewCount: 2 };
    pending.current.set("a", newer);
    const second = flush();
    assert.equal(calls, 1);
    release(null);
    await Promise.all([first, second]);
    assert.equal(calls, 2);
    assert.equal(snapshots[1][0], newer);
    assert.equal(pending.current.size, 0);
    assert.equal(inFlight.current, null);
    const failing = getCallback("flushPendingMemory", {
        cachePendingMemory: () => {},
        authenticatedUserIdRef: { current: "u" },
        pendingMemoryRef: pending,
        syncInFlightRef: inFlight,
        setSaveError: (value) => {
            savingError = value;
        },
        room: { id: "r" },
        posthog: { capture: () => {} },
        console: { error: () => {} },
        syncPlaygroundMemory: () => Promise.reject(new Error("offline")),
    });
    pending.current.set("a", newer);
    await failing();
    assert.equal(pending.current.get("a"), newer);
    assert.equal(savingError, false);
    // A failed sync preserves pending data for the next retry and reports telemetry.
    assert.equal(inFlight.current, null);
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
        globals,
    );
}
test("actual solo Client callbacks cover 20/100 words without BOT turns", () => {
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
        const globals = {
            ...m,
            ...sch,
            Date: Clock,
            items,
            room: { id: "r" },
            isPaused: false,
            offlineVoiceReading: "none",
            soundEffects: false,
            schedulerRef: ref(sch.createScheduler(items.map((x) => x.id), rng(17))),
            currentItemRef: ref(null),
            recallProgressRef: ref(null),
            sessionTurnNumberRef: ref(0),
            memoryByItemRef: ref({}),
            exposureGapAtStartRef: ref(null),
            predictedRetrievabilityAtPromptRef: ref(null),
            expectedTypingAtStartRef: ref(0),
            userTypingDelayRef: ref(220),
            authenticatedUserIdRef: ref("u"),
            memoryPersistenceDisabledRef: ref(false),
            pendingMemoryRef: ref(new Map()),
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
            "setMemoryByItem",
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
            assert(item, "the solo learner receives a question immediately");
            assert(!seen.has(item.id));
            seen.add(item.id);
            time += 1200;
            actual.handleRecallComplete(observation());
            actual.handleSuccess();
        }
        assert.equal(seen.size, size);
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
            recallEvents.every(
                (x) => x.model_version === m.MEMORY_MODEL_VERSION,
        ));
        assert.equal(
            Object.keys(globals.schedulerRef.current.retries).length,
            0,
        );

        globals.pendingMemoryRef.current.clear();
        globals.memoryPersistenceDisabledRef.current = true;
        actual.updateLocalMemory(items[0], observation());
        assert.equal(
            globals.pendingMemoryRef.current.size,
            0,
            "fallback recall observations must stay out of the authenticated sync queue",
        );
    }
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
        authenticatedUserIdRef: ref("u"),
        memoryPersistenceDisabledRef: ref(true),
        memoryByItemRef: memory,
        pendingMemoryRef: pending,
        setMemoryByItem: () => {},
        syncPlaygroundMemory: async () => {
            syncCalls++;
            return null;
        },
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
    assert.equal(memory.evaluateRecall(observations[0]).retryNeed, "none");
});
test("a renewed failure resets confirmation; exposure-assisted success never clears retry", () => {
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
    assert.equal(state.retries[first.itemId].successCount, 0);
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

test("Playground full hints and online partial hints clear incorrect English and kana input", () => {
    const source = fs.readFileSync(
        path.join(root, "components/recall/TypingView.tsx"),
        "utf8",
    );
    assert.match(source, /const hasIncorrectInput = isKanaAnswer\s*\?/);
    assert.match(source, /if \(hasIncorrectInput\) \{\s*resetInput\(\);\s*\}/);
    assert.match(source, /const incorrectAfterReveal =\s*answerRevealed &&/);
    // Playground's fully revealed hint applies to all answer types.
    // Online hints enforce immediate failure within the revealed prefix.
    assert.match(source, /const typedInsideHint = Array\.from\(/);
    assert.match(source, /onChangeInput\("", true\)/);
    assert.match(
        source,
        /if \(incorrectAfterReveal \|\| \(typedInsideHint && !manualHints\)\) \{\s*resetInput\(\);\s*return;/,
    );
});

test("actual manual hint callback reveals the full answer and records one answer event", () => {
    const typed = ["r", "e", "c", "i", "e", "v", "e"];
    const events = { current: [] };
    const lastKeyWasSpaceRef = { current: true };
    let answerRevealed = false;
    const callback = getInputFunction("requestHint", {
        manualHints: true,
        english: "receive",
        answerRevealed: false,
        isKanaAnswer: false,
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
        scheduler.recordUserAnswer(state, memory.evaluateRecall(observation()));
    }
    assert.deepEqual(actual, ["low", "mid", "high"]);
});
test("first independent recall increases stability without crediting recent exposure", () => {
    const original = memory.createInitialMemory("u", "r", "w");
    assert.equal(apply(original, observation()).stability, memory.INITIAL_CLEAR_RECALL_STABILITY);
    assert.equal(apply(original, observation({ additionalHintCount: 1 })).stability,
        memory.INITIAL_WEAK_RECALL_STABILITY);
    assert.equal(apply(original, observation({ elapsedSincePresentationMs: 100 })).stability,
        original.stability);
});
