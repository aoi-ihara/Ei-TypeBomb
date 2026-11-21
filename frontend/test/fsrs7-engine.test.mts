import assert from "node:assert/strict";
import test from "node:test";
import { Rating } from "ts-fsrs";
import {
    MEMORY_MODEL_VERSION,
    MEMORY_CONFIG_VERSION,
    TARGET_RETENTION,
    cardId,
    createMemoryCard,
    evaluateAnswer,
    reviewMemoryCard,
    predictRetention,
} from "../lib/learning/engine";

const t0 = new Date("2026-11-21T00:00:00Z");
const unaided = {
    firstAttemptCorrect: true,
    usedHint: false,
    struggled: false,
} as const;

test("the engine pins FSRS-7 and a versioned configuration", () => {
    assert.equal(MEMORY_MODEL_VERSION, "FSRS-7");
    assert.equal(MEMORY_CONFIG_VERSION, 1);
    assert.equal(TARGET_RETENTION, 0.9);
});

test("card identities do not collide between recall and recognition", async () => {
    const identity = { roomId: "room", itemId: "term" } as const;
    const recalled = await createMemoryCard({ ...identity, mode: "recall" }, t0);
    const recognized = await createMemoryCard(
        { ...identity, mode: "recognition" }, t0,
    );
    assert.notEqual(recalled.cardId, recognized.cardId);
    assert.equal(recalled.cardId, cardId({ ...identity, mode: "recall" }));
    assert.equal(recalled.scheduleStatus, "new");
    assert.equal(await predictRetention(recalled, t0), null);
});

test("answer grading never credits hints or corrected mistakes as first-try recall", () => {
    assert.equal(evaluateAnswer(unaided), Rating.Good);
    assert.equal(evaluateAnswer({ ...unaided, struggled: true }), Rating.Hard);
    assert.equal(evaluateAnswer({ ...unaided, usedHint: true }), Rating.Again);
    assert.equal(
        evaluateAnswer({ ...unaided, firstAttemptCorrect: false }),
        Rating.Again,
    );
});

test("review returns a separate card and revlog without mutating the input", async () => {
    const card = await createMemoryCard(
        { roomId: "r", itemId: "a", mode: "recall" }, t0,
    );
    const before = JSON.stringify(card);
    const reviewed = await reviewMemoryCard(card, unaided, t0);
    assert.equal(JSON.stringify(card), before);
    assert.notEqual(reviewed.card, card);
    assert.equal(reviewed.revlog.rating, Rating.Good);
    assert.equal(reviewed.card.cardId, card.cardId);
    assert(reviewed.card.dueAt instanceof Date);
    assert(reviewed.card.dueAt.getTime() > t0.getTime());
    const immediate = await predictRetention(reviewed.card, t0);
    assert(immediate !== null && immediate > 0.999 && immediate <= 1);
});

test("predicted retention decreases over time without an intervening review", async () => {
    const card = await createMemoryCard(
        { roomId: "r", itemId: "b", mode: "recall" }, t0,
    );
    const { card: reviewed } = await reviewMemoryCard(card, unaided, t0);
    const atHour = await predictRetention(
        reviewed, new Date(t0.getTime() + 3_600_000),
    );
    const atWeek = await predictRetention(
        reviewed, new Date(t0.getTime() + 7 * 86_400_000),
    );
    assert(atHour !== null && atWeek !== null);
    assert(atHour <= 1 && atHour >= 0);
    assert(atWeek < atHour);
});

test("recognition failures produce Again review logs, not recall credit", async () => {
    const card = await createMemoryCard(
        { roomId: "r", itemId: "c", mode: "recognition" }, t0,
    );
    const result = await reviewMemoryCard(
        card, { ...unaided, firstAttemptCorrect: false }, t0,
    );
    assert.equal(result.revlog.rating, Rating.Again);
});
