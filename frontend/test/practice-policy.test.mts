import assert from "node:assert/strict";
import test from "node:test";
import {
    applyRecallObservation,
    createInitialMemory,
    evaluateRecall,
    getExposureGap,
    recordAnswerModeResult,
    type ItemMemoryState,
} from "../lib/playground/memory";
import {
    chooseNextUserItem,
    createScheduler,
    recordRecognitionAnswer,
    recordUserAnswer,
    saveSchedulerState,
    loadSchedulerState,
} from "../lib/playground/scheduler";

const start = Date.parse("2026-11-21T00:00:00Z");
const clean = {
    success: true,
    answerLength: 4,
    firstAttemptCorrect: true,
    attemptCount: 1,
    hintCount: 0,
    revealedHintChars: 0,
    maxCorrectPrefixLength: 4,
    recallLatencyMs: 500,
    elapsedMs: 1000,
};
for (const mode of ["input", "selection"] as const) {
    test(`${mode}: a recovered mistake cannot monopolize a 20-word room`, () => {
        const ids = Array.from({ length: 20 }, (_, i) => String(i));
        const state = createScheduler(ids, () => 0.5);
        const memories: Record<string, ItemMemoryState> = {};
        for (const id of ids) {
            const at = new Date(start - 60_000).toISOString();
            memories[id] = {
                ...createInitialMemory("u", "r", id),
                stability: 8,
                reviewCount: 1,
                lastReviewedAt: at,
                lastPresentedAt: at,
                answerModeStats: {
                    recall: {
                        attempts: 1,
                        correct: 1,
                        correctStreak: 1,
                        lastAttemptAt: at,
                    },
                    recognition: {
                        attempts: 1,
                        correct: 1,
                        correctStreak: 1,
                        lastAttemptAt: at,
                        stability: 8,
                        lastReviewedAt: at,
                    },
                },
            };
        }
        let failedId: string | undefined;
        const counts: Record<string, number> = {};
        for (let turn = 0; turn < 240; turn++) {
            const now = start + turn * 20_000;
            const selected = chooseNextUserItem(
                state,
                memories,
                () => 0.5,
                now,
                mode,
            )!;
            assert(selected);
            if (turn === 0) failedId = selected.itemId;
            const id = selected.itemId;
            const gap = getExposureGap(memories[id], mode, now);
            const observation = {
                ...clean,
                success: turn !== 0,
                elapsedSincePresentationMs: gap,
                schedulerReason: selected.reason,
            };
            if (mode === "input") {
                memories[id] = applyRecallObservation({
                    memory: memories[id],
                    observation,
                    userId: "u",
                    roomId: "r",
                    itemId: id,
                    now: new Date(now),
                });
                recordUserAnswer(state, evaluateRecall(observation), now);
            } else {
                memories[id] = recordAnswerModeResult({
                    memory: memories[id],
                    mode,
                    success: turn !== 0,
                    userId: "u",
                    roomId: "r",
                    itemId: id,
                    now: new Date(now),
                    exposureGapMs: gap,
                });
                recordRecognitionAnswer(state, id, turn === 0, now, gap);
            }
            if (turn >= 40) counts[id] = (counts[id] ?? 0) + 1;
        }
        assert.equal(Object.keys(counts).length, 20);
        assert((counts[failedId!] ?? 0) <= 12, JSON.stringify(counts));
        assert.equal(Object.keys(state.retries).length, 0);
    });
}

for (const mode of ["input", "selection"] as const) {
    for (const size of [1, 2, 8, 100]) {
        test(`${mode}: ${size} words keep cycling, survive reload and do not inflate retention`, () => {
            const ids = Array.from({ length: size }, (_, i) => String(i));
            let state = createScheduler(ids, () => 0.5);
            const memories: Record<string, ItemMemoryState> = {};
            const counts: Record<string, number> = {};
            let last: string | undefined;
            const baselines: Record<string, number> = {};
            const data = new Map<string, string>();
            const descriptor = Object.getOwnPropertyDescriptor(
                globalThis,
                "localStorage",
            );
            Object.defineProperty(globalThis, "localStorage", {
                configurable: true,
                value: {
                    getItem: (key: string) => data.get(key) ?? null,
                    setItem: (key: string, value: string) =>
                        data.set(key, value),
                },
            });
            try {
                for (let turn = 0; turn < size * 12; turn++) {
                    const now = start + turn * 5_000;
                    const selected = chooseNextUserItem(
                        state,
                        memories,
                        () => 0.5,
                        now,
                        mode,
                    )!;
                    assert(selected, "no waiting screen for a nonempty room");
                    const id = selected.itemId;
                    if (size > 1 && turn > 0) assert.notEqual(id, last);
                    last = id;
                    counts[id] = (counts[id] ?? 0) + 1;
                    const gap = getExposureGap(memories[id], mode, now);
                    if (mode === "input") {
                        const observation = {
                            ...clean,
                            elapsedSincePresentationMs: gap,
                            schedulerReason: selected.reason,
                        };
                        memories[id] = applyRecallObservation({
                            memory: memories[id],
                            observation,
                            userId: "u",
                            roomId: "r",
                            itemId: id,
                            now: new Date(now),
                        });
                        recordUserAnswer(
                            state,
                            evaluateRecall(observation),
                            now,
                        );
                    } else {
                        memories[id] = recordAnswerModeResult({
                            memory: memories[id],
                            mode,
                            success: true,
                            userId: "u",
                            roomId: "r",
                            itemId: id,
                            choiceCount: Math.min(size, 4),
                            exposureGapMs: gap,
                            now: new Date(now),
                        });
                        if (size === 1)
                            state.current = null; // The UI treats a single option as exposure.
                        else
                            recordRecognitionAnswer(state, id, false, now, gap);
                    }
                    const stability =
                        mode === "input"
                            ? memories[id].stability
                            : (memories[id].answerModeStats?.recognition
                                  .stability ?? 0);
                    baselines[id] ??= stability;
                    assert(
                        stability >= baselines[id] &&
                            stability - baselines[id] < 0.03,
                        "five-second rehearsals provide only bounded, tiny credit",
                    );
                    if (turn % 3 === 0) {
                        saveSchedulerState("playground", "u", "r", state, now);
                        const restored = loadSchedulerState(
                            "playground",
                            "u",
                            "r",
                            ids,
                            now,
                        )!;
                        assert.deepEqual(
                            restored,
                            state,
                            "reload preserves the entire learning session",
                        );
                        state = restored;
                    }
                }
                assert.equal(Object.keys(counts).length, size);
                for (const count of Object.values(counts))
                    assert.equal(count, 12);
                assert.equal(Object.keys(state.retries).length, 0);
                const id = ids[0];
                const now = start + 2 * 86_400_000;
                const gap = getExposureGap(memories[id], mode, now);
                const previous = memories[id];
                const updated =
                    mode === "input"
                        ? applyRecallObservation({
                              memory: previous,
                              observation: {
                                  ...clean,
                                  elapsedSincePresentationMs: gap,
                                  schedulerReason: "early_practice",
                              },
                              userId: "u",
                              roomId: "r",
                              itemId: id,
                              now: new Date(now),
                          })
                        : recordAnswerModeResult({
                              memory: previous,
                              mode,
                              success: true,
                              choiceCount: Math.min(size, 4),
                              exposureGapMs: gap,
                              userId: "u",
                              roomId: "r",
                              itemId: id,
                              now: new Date(now),
                          });
                if (mode === "input")
                    assert(updated.stability > previous.stability);
                else if (size > 1)
                    assert(
                        updated.answerModeStats!.recognition.stability! >
                            previous.answerModeStats!.recognition.stability!,
                    );
                else
                    assert.equal(
                        updated.answerModeStats,
                        undefined,
                        "one option never proves recognition",
                    );
            } finally {
                if (descriptor)
                    Object.defineProperty(
                        globalThis,
                        "localStorage",
                        descriptor,
                    );
                else Reflect.deleteProperty(globalThis, "localStorage");
            }
        });
    }
}

for (const mode of ["input", "selection"] as const) {
    test(`${mode}: rapid clean answers resolve short-term tasks without claiming retention`, () => {
        const ids = Array.from({ length: 20 }, (_, i) => String(i));
        const state = createScheduler(ids, () => 0.5);
        for (const itemId of ids.slice(0, 4))
            state.retries[itemId] = {
                itemId,
                earliestTurn: 1,
                latestTurn: 4,
                successCount: 0,
                reason: "failed_recall",
            };
        for (let turn = 0; turn < 12; turn++) {
            const selected = chooseNextUserItem(
                state,
                {},
                () => 0.5,
                start,
                mode,
            )!;
            const observation = { ...clean, elapsedSincePresentationMs: 500 };
            if (mode === "input")
                recordUserAnswer(state, evaluateRecall(observation), start);
            else
                recordRecognitionAnswer(
                    state,
                    selected.itemId,
                    false,
                    start,
                    500,
                );
        }
        assert.equal(Object.keys(state.retries).length, 0);
        assert(
            Object.keys(state.userAnswered).length > 4,
            "correct practice frees capacity for new words",
        );
        const base = {
            ...createInitialMemory("u", "r", "a"),
            reviewCount: 1,
            stability: 1,
            lastReviewedAt: new Date(start - 10_000).toISOString(),
        };
        const updated = applyRecallObservation({
            memory: base,
            observation: { ...clean, elapsedSincePresentationMs: 500 },
            userId: "u",
            roomId: "r",
            itemId: "a",
            now: new Date(start),
        });
        assert.equal(updated.stability, base.stability);
        assert.equal(updated.lastReviewedAt, base.lastReviewedAt);
    });
}
