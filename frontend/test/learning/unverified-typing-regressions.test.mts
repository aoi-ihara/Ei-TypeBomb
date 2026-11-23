import assert from "node:assert/strict";
import test from "node:test";
import {
    applyRecallObservation,
    createInitialMemory,
    evaluateRecall,
    getExposureGap,
    recordAnswerModeResult,
    type ItemMemoryState,
} from "../../lib/playground/memory";
import {
    chooseNextUserItem,
    createScheduler,
    recordRecognitionAnswer,
    recordUserAnswer,
} from "../../lib/playground/scheduler";

const start = Date.parse("2026-11-21T05:19:52.000Z");
const ids = Array.from({ length: 24 }, (_, i) => `item-${i + 1}`);
const missingAnchors = ["item-5", "item-8"];
const clean = {
    success: true,
    answerLength: 6,
    firstAttemptCorrect: true,
    attemptCount: 1,
    incorrectInputCount: 0,
    hintCount: 0,
    revealedHintChars: 0,
    maxCorrectPrefixLength: 6,
    recallLatencyMs: 650,
    elapsedMs: 1200,
};

for (const mode of ["input", "selection"] as const) {
    test(`${mode}: two unconfirmed words in a 24-word room become eligible after a genuine gap`, () => {
        // Reduced reproduction of the 24-word/99-turn diagnostic: two words
        // have many attempts but no independent clean-review timestamp.
        const state = createScheduler(ids, () => 0.5);
        const memories: Record<string, ItemMemoryState> = {};
        for (const id of ids) {
            const lastPresentedAt = new Date(
                start - (id === "item-5" ? 30_000 :
                    id === "item-8" ? 25_000 : 10_000),
            ).toISOString();
            if (missingAnchors.includes(id)) {
                memories[id] = mode === "input"
                    ? { ...createInitialMemory("u", "r", id), reviewCount: 4,
                        stability: 0.12, lastPresentedAt }
                    : recordAnswerModeResult({
                        memory: recordAnswerModeResult({
                            memory: undefined, mode, success: false,
                            userId: "u", roomId: "r", itemId: id,
                            now: new Date(Date.parse(lastPresentedAt) - 1_000),
                        }),
                        // A short recovered success has no valid spaced anchor.
                        mode, success: true, exposureGapMs: 1_000,
                        userId: "u", roomId: "r", itemId: id,
                        now: new Date(lastPresentedAt),
                    });
            } else {
                memories[id] = mode === "input"
                    ? { ...createInitialMemory("u", "r", id), reviewCount: 3,
                        stability: 0.3,
                        lastReviewedAt: new Date(start - 60_000).toISOString(),
                        lastPresentedAt }
                    : recordAnswerModeResult({
                        memory: undefined, mode, success: true,
                        userId: "u", roomId: "r", itemId: id,
                        now: new Date(lastPresentedAt),
                    });
            }
        }

        const reviewed = new Set<string>();
        for (let turn = 0; turn < 30; turn++) {
            const now = start + turn * 10_000;
            const selected = chooseNextUserItem(
                state, memories, () => 0.5, now, mode,
            );
            assert(selected, "a nonempty room always stays playable");
            if (turn < 9)
                assert(!missingAnchors.includes(selected.itemId),
                    "do not reset unconfirmed words before the two-minute interval");
            const id = selected.itemId;
            const gap = getExposureGap(memories[id], mode, now);
            if (mode === "input") {
                const observation = {
                    ...clean, elapsedSincePresentationMs: gap,
                };
                memories[id] = applyRecallObservation({
                    memory: memories[id], observation,
                    userId: "u", roomId: "r", itemId: id, now: new Date(now),
                });
                recordUserAnswer(state, evaluateRecall(observation), now);
            } else {
                memories[id] = recordAnswerModeResult({
                    memory: memories[id], mode, success: true,
                    userId: "u", roomId: "r", itemId: id,
                    exposureGapMs: gap, now: new Date(now),
                });
                recordRecognitionAnswer(state, id, false, now, gap);
            }
            if (missingAnchors.includes(id)) {
                const anchor = mode === "input"
                    ? memories[id].lastReviewedAt
                    : memories[id].answerModeStats?.recognition.lastReviewedAt;
                if (anchor) {
                    assert.equal(selected.reason, "long_term_due");
                    reviewed.add(id);
                }
            }
        }
        assert.deepEqual([...reviewed].sort(), missingAnchors.slice().sort(),
            "all previously unconfirmed items should receive a real spaced review");
    });
}

test("corrected typing mistake schedules a finite confirmation without marking recall as failure", () => {
    const state = createScheduler(ids, () => 0.5);
    const selected = chooseNextUserItem(state, {}, () => 0.5, start)!;
    const correction = {
        ...clean, firstAttemptCorrect: false, incorrectInputCount: 1,
        attemptCount: 2, elapsedSincePresentationMs: 60_000,
    };
    const evaluation = evaluateRecall(correction);
    assert.equal(evaluation.memoryEvidence, "recall");
    assert.equal(evaluation.retryNeed, "confirm");
    assert.equal(evaluation.reason, "uncertain_recall");
    assert.equal(evaluation.minorCorrection, true);
    assert((evaluation.quality ?? 0) >= 0.8);

    const original: ItemMemoryState = {
        ...createInitialMemory("u", "r", selected.itemId), reviewCount: 2,
        stability: 0.3,
        lastReviewedAt: new Date(start - 3 * 60 * 60_000).toISOString(),
        lastPresentedAt: new Date(start - 60_000).toISOString(),
    };
    const updated = applyRecallObservation({
        memory: original, observation: correction,
        userId: "u", roomId: "r", itemId: selected.itemId,
        now: new Date(start),
    });
    assert(updated.stability >= original.stability,
        "a corrected spelling error is still unaided recall");
    assert.equal(updated.lastReviewedAt, original.lastReviewedAt,
        "a very recent correction does not reset the spaced anchor");

    recordUserAnswer(state, evaluation, start);
    assert(state.retries[selected.itemId], "a correction requests a near-term revisit");
    assert.equal(state.retries[selected.itemId].successCount, 1);
    assert.equal(state.retries[selected.itemId].earliestTurn, state.turn + 5);
    let confirmations = 0;
    for (let i = 1; i <= 18; i++) {
        const next = chooseNextUserItem(state, {}, () => 0.5,
            start + i * 10_000)!;
        if (next.itemId === selected.itemId) {
            assert.equal(next.reason, "retry");
            confirmations++;
        }
        recordUserAnswer(state, evaluateRecall({
            ...clean, elapsedSincePresentationMs: 10_000,
        }), start + i * 10_000);
    }
    assert.equal(confirmations, 1,
        "one confident typo plus one clean confirmation finishes the retry");
    assert.equal(state.retries[selected.itemId], undefined);
    assert.equal(state.struggles[selected.itemId], undefined);
});

test("an immediately corrected typo is not strong recall, but still requests confirmation", () => {
    const evaluation = evaluateRecall({
        ...clean, firstAttemptCorrect: false, incorrectInputCount: 1,
        attemptCount: 2, elapsedSincePresentationMs: 500,
    });
    assert.equal(evaluation.independent, false);
    assert.equal(evaluation.memoryEvidence, "insufficient_evidence");
    assert.equal(evaluation.retryNeed, "confirm");
});


test("another independent one-typo recall finishes confirmation without resetting", () => {
    const state = createScheduler(ids, () => 0.5);
    const first = chooseNextUserItem(state, {}, () => 0.5, start)!;
    const typo = evaluateRecall({
        ...clean, firstAttemptCorrect: false, incorrectInputCount: 1,
        attemptCount: 2, elapsedSincePresentationMs: 60_000,
    });
    recordUserAnswer(state, typo, start);
    assert.equal(state.retries[first.itemId].successCount, 1);
    let retryCount = 0;
    for (let i = 1; i <= 24; i++) {
        const next = chooseNextUserItem(state, {}, () => 0.5, start + i * 10_000)!;
        if (next.itemId === first.itemId && next.reason === "retry") retryCount++;
        recordUserAnswer(state, next.itemId === first.itemId && next.reason === "retry"
            ? typo : evaluateRecall({ ...clean, elapsedSincePresentationMs: 10_000 }),
            start + i * 10_000);
    }
    assert.equal(retryCount, 1);
    assert.equal(state.retries[first.itemId], undefined);
});

test("slow one-typo recall starts at zero and needs two successful confirmations", () => {
    const state = createScheduler(ids, () => 0.5);
    const first = chooseNextUserItem(state, {}, () => 0.5, start)!;
    const slow = evaluateRecall({
        ...clean, firstAttemptCorrect: false, incorrectInputCount: 1,
        attemptCount: 2, recallLatencyMs: 24_000, elapsedMs: 32_000,
        elapsedSincePresentationMs: 60_000,
    });
    assert.equal(slow.minorCorrection, true);
    assert((slow.quality ?? 1) < 0.8);
    recordUserAnswer(state, slow, start);
    assert.equal(state.retries[first.itemId].successCount, 0);
    assert.equal(state.retries[first.itemId].earliestTurn, state.turn + 2);
    let retryCount = 0;
    for (let i = 1; i <= 25; i++) {
        const next = chooseNextUserItem(state, {}, () => 0.5, start + i * 10_000)!;
        if (next.itemId === first.itemId && next.reason === "retry") retryCount++;
        recordUserAnswer(state, evaluateRecall({ ...clean, elapsedSincePresentationMs: 10_000 }),
            start + i * 10_000);
    }
    assert.equal(retryCount, 2);
    assert.equal(state.retries[first.itemId], undefined);
});

test("multiple errors, hint assistance, and failure do not earn typo credit", () => {
    const attempts = [
        { ...clean, firstAttemptCorrect: false, incorrectInputCount: 3,
            attemptCount: 4, elapsedSincePresentationMs: 60_000 },
        { ...clean, firstAttemptCorrect: false, incorrectInputCount: 1,
            attemptCount: 2, hintCount: 1, revealedHintChars: 1,
            elapsedSincePresentationMs: 60_000 },
        { ...clean, success: false, firstAttemptCorrect: false,
            incorrectInputCount: 1, attemptCount: 2,
            elapsedSincePresentationMs: 60_000 },
    ];
    for (const observation of attempts) {
        const evaluation = evaluateRecall(observation);
        assert.notEqual(evaluation.minorCorrection, true);
        const state = createScheduler(ids, () => 0.5);
        const first = chooseNextUserItem(state, {}, () => 0.5, start)!;
        recordUserAnswer(state, evaluation, start);
        assert.equal(state.retries[first.itemId].successCount, 0);
        assert.equal(state.retries[first.itemId].earliestTurn, state.turn + 2);
    }
});

test("150 known words and 1000 turns: one typo-prone word does not dominate", () => {
    const all = Array.from({ length: 150 }, (_, i) => `item-${i + 1}`);
    const target = "item-78";
    const state = createScheduler(all, () => 0.5);
    const memories: Record<string, ItemMemoryState> = Object.fromEntries(
        all.map(id => [id, {
            ...createInitialMemory("u", "r", id),
            reviewCount: 1, stability: 0.3,
            lastReviewedAt: new Date(start - 60_000).toISOString(),
            lastPresentedAt: new Date(start - 60_000).toISOString(),
        }]),
    );
    let maxRetries = 0;
    let targetRetries = 0;
    for (let i = 0; i < 1000; i++) {
        const now = start + i * 15_000;
        const selected = chooseNextUserItem(state, memories, () => 0.5, now, "input")!;
        const id = selected.itemId;
        if (id === target && selected.reason === "retry") targetRetries++;
        const observation = {
            ...clean,
            ...(id === target ? {
                firstAttemptCorrect: false, incorrectInputCount: 1,
                attemptCount: 2, recallLatencyMs: 921, elapsedMs: 3935,
            } : {}),
            elapsedSincePresentationMs: getExposureGap(memories[id], "input", now),
        };
        memories[id] = applyRecallObservation({
            memory: memories[id], observation, userId: "u", roomId: "r",
            itemId: id, now: new Date(now),
        });
        recordUserAnswer(state, evaluateRecall(observation), now);
        maxRetries = Math.max(maxRetries, Object.keys(state.retries).length);
    }
    const counts = Object.values(state.userAnswered).sort((a, b) => a - b);
    assert.equal(counts.length, 150, "all known words remain in circulation");
    const median = counts[Math.floor(counts.length / 2)];
    assert((state.userAnswered[target] ?? 0) <= median * 3,
        `target repeats ${state.userAnswered[target]} times vs median ${median}`);
    assert(targetRetries < 20, "typo confirmation must not monopolize practice");
    assert(maxRetries <= 4);
});

test("two unanchored cards are fairly rotated when no useful filler is available", () => {
    const state = createScheduler(["item-5", "item-8"], () => 0.5);
    const memories = Object.fromEntries(
        ["item-5", "item-8"].map(id => [id, {
            ...createInitialMemory("u", "r", id),
            reviewCount: 3, lastPresentedAt: new Date(start).toISOString(),
        }]),
    );
    const count: Record<string, number> = {};
    for (let i = 0; i < 8; i++) {
        const selected = chooseNextUserItem(
            state, memories, () => 0.5, start + i * 1_000, "input",
        )!;
        assert.equal(selected.reason, "early_practice");
        count[selected.itemId] = (count[selected.itemId] ?? 0) + 1;
        recordUserAnswer(state, evaluateRecall({
            ...clean, elapsedSincePresentationMs: 1_000,
        }), start + i * 1_000);
    }
    assert.deepEqual(Object.values(count).sort((a, b) => a - b), [4, 4]);
});
