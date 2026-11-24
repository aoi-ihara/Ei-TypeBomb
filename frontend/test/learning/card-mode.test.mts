import assert from "node:assert/strict";
import test from "node:test";
import type { CardRating } from "../../lib/answer-mode";
import {
    CHOICE_UNKNOWN_FAILURE_WEIGHT,
    getMasteryProgress,
    getRecognitionFailureRate,
    recordAnswerModeResult,
    type ItemMemoryState,
} from "../../lib/playground/memory";
import {
    chooseNextUserItem,
    createScheduler,
    recordRecognitionAnswer,
} from "../../lib/playground/scheduler";

const DAY_MS = 86_400_000;
const start = Date.parse("2026-11-21T00:00:00.000Z");

/** The offline client's card grading, using recognition memory as in selection. */
function gradeCard(
    previous: ItemMemoryState | undefined,
    rating: CardRating,
    now = start,
    exposureGapMs: number | null = null,
) {
    return recordAnswerModeResult({
        memory: previous,
        userId: "u",
        roomId: "r",
        itemId: "word",
        mode: "selection",
        success: rating === "correct",
        usedHint: rating === "unknown",
        // A card has no distractors, but a self-grade is still an observation.
        choiceCount: 4,
        now: new Date(now),
        exposureGapMs,
    });
}

test("a clean card grade is the same recognition observation as a clean choice", () => {
    const fromCard = gradeCard(undefined, "correct");
    const fromChoice = recordAnswerModeResult({
        memory: undefined,
        userId: "u",
        roomId: "r",
        itemId: "word",
        mode: "selection",
        success: true,
        now: new Date(start),
    });
    assert.deepEqual(fromCard.answerModeStats, fromChoice.answerModeStats);
    assert.equal(fromCard.answerModeStats?.recognition.lastReviewedAt, new Date(start).toISOString());
});

test("card misses weaken recognition stability and remember the revealed answer", () => {
    const reviewed = gradeCard(undefined, "correct");
    const wrong = gradeCard(reviewed, "incorrect", start + DAY_MS, DAY_MS);
    const unknown = gradeCard(reviewed, "unknown", start + DAY_MS, DAY_MS);
    const recognition = (memory: ItemMemoryState) => memory.answerModeStats!.recognition;

    assert.equal(recognition(wrong).attempts, 2);
    assert.equal(recognition(wrong).correct, 1);
    assert.equal(recognition(wrong).unknownCount, undefined);
    assert.equal(recognition(unknown).unknownCount, 1);
    assert(recognition(wrong).stability! < recognition(reviewed).stability!);
    assert(recognition(unknown).stability! <= recognition(wrong).stability!);
    assert.equal(recognition(wrong).lastReviewedAt, recognition(reviewed).lastReviewedAt);
    assert.equal(recognition(unknown).lastReviewedAt, recognition(reviewed).lastReviewedAt);
    assert.equal(
        getRecognitionFailureRate(recognition(unknown)) > getRecognitionFailureRate(recognition(wrong)),
        CHOICE_UNKNOWN_FAILURE_WEIGHT > 1,
    );
});

test("a card in a one-word room still records a recognition grade", () => {
    // recordAnswerModeResult skips choice-only exposure for single-choice rooms;
    // the card client passes a real observation count instead.
    const memory = gradeCard(undefined, "correct");
    assert.equal(memory.answerModeStats?.recognition.attempts, 1);
    assert.equal(memory.answerModeStats?.recognition.correct, 1);
});

test("card misses enter the same short retry queue as wrong choices", () => {
    const state = createScheduler(["word"]);
    const first = chooseNextUserItem(state, {}, () => 0, start, "selection");
    assert.equal(first?.itemId, "word");
    assert.equal(recordRecognitionAnswer(state, "word", true, start, null), true);
    assert.equal(state.retries.word.reason, "failed_recall");
    const retry = chooseNextUserItem(state, {}, () => 0, start + 5_000, "selection");
    assert.equal(retry?.itemId, "word");
    assert.equal(retry?.reason, "retry");
});

test("card mastery uses the recognition prediction of the shared progress bar", () => {
    const memory = gradeCard(undefined, "correct");
    const progress = getMasteryProgress(
        ["word"],
        { word: memory },
        start,
        0.8,
        "input",
        { word: "selection" },
    );
    assert.equal(progress.total, 1);
    assert.equal(progress.masteredNow, 1);
});
