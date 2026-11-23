import assert from "node:assert/strict";
import test from "node:test";
import {
    applyRecallObservation,
    createInitialMemory,
    recordAnswerModeResult,
} from "../../lib/playground/memory";

const start = Date.parse("2026-11-21T00:00:00.000Z");
const DAY_MS = 86_400_000;

function recognizedAt(now: number, previous?: ReturnType<typeof createInitialMemory>, gapMs?: number) {
    return recordAnswerModeResult({
        memory: previous,
        userId: "u", roomId: "r", itemId: "word",
        mode: "selection", success: true,
        now: new Date(now), exposureGapMs: gapMs,
    });
}

function recalledAt(now: number, previous?: ReturnType<typeof createInitialMemory>, gapMs?: number) {
    return applyRecallObservation({
        memory: previous,
        userId: "u", roomId: "r", itemId: "word",
        now: new Date(now),
        observation: {
            success: true, answerLength: 4, firstAttemptCorrect: true,
            attemptCount: 1, hintCount: 0, revealedHintChars: 0,
            maxCorrectPrefixLength: 4, recallLatencyMs: 500,
            elapsedMs: 1000,
            ...(gapMs === undefined ? {} : { elapsedSincePresentationMs: gapMs }),
        },
    });
}

for (const [mode, apply, stabilityOf, anchorOf] of [
    ["recognition", recognizedAt,
        (m: ReturnType<typeof recognizedAt>) => m.answerModeStats!.recognition.stability!,
        (m: ReturnType<typeof recognizedAt>) => m.answerModeStats!.recognition.lastReviewedAt],
    ["recall", recalledAt,
        (m: ReturnType<typeof recalledAt>) => m.stability,
        (m: ReturnType<typeof recalledAt>) => m.lastReviewedAt],
] as const) {
    test(`${mode}: clean sub-due practice receives continuous time-weighted credit`, () => {
        const base = apply(start);
        const small = apply(start + 10_000, base, 10_000);
        const medium = apply(start + 10 * 60_000, base, 10 * 60_000);
        const larger = apply(start + 20 * 60_000, base, 20 * 60_000);
        assert(stabilityOf(small) > stabilityOf(base));
        assert(stabilityOf(medium) > stabilityOf(small));
        assert(stabilityOf(larger) > stabilityOf(medium));
        assert.equal(anchorOf(small), anchorOf(base));
        assert.equal(anchorOf(larger), anchorOf(base));
    });

    test(`${mode}: frequent practice is bounded by real time, not answer count`, () => {
        let memory = apply(start);
        const initial = stabilityOf(memory);
        for (let i = 1; i <= 600; i++)
            memory = apply(start + i * 5_000, memory, 5_000);
        assert(stabilityOf(memory) > initial);
        // 50 minutes of continual answers cannot manufacture an extra day.
        assert(stabilityOf(memory) - initial < 0.01);
        assert.equal(anchorOf(memory), anchorOf(apply(start)));
    });

    test(`${mode}: later genuinely spaced review can still promote long-term memory`, () => {
        const base = apply(start);
        const early = apply(start + 10 * 60_000, base, 10 * 60_000);
        const spaced = apply(start + DAY_MS, early, DAY_MS - 10 * 60_000);
        assert(stabilityOf(spaced) > stabilityOf(early));
        assert.equal(anchorOf(spaced), new Date(start + DAY_MS).toISOString());
    });
}
