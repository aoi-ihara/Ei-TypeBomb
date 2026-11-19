import test from "node:test";
import assert from "node:assert/strict";
import {
    createChoiceOptions,
    getDistractorIndices,
    getAnswerModeOptions,
    getTypingAnswer,
    normalizeAnswerMode,
} from "../lib/answer-mode";
import {
    createInitialMemory,
    recordAnswerModeResult,
    getRecognitionSpeedAdjustment,
    getRecognitionFailureRate,
    CHOICE_UNKNOWN_FAILURE_WEIGHT,
    parseAnswerModeStats,
    CHOICE_SPEED_IGNORE_AFTER_MS,
} from "../lib/playground/memory";
import {
    createActiveResponseClock,
    readActiveResponseMs,
    setResponseClockActive,
} from "../lib/selection-timing";
import { validateItems } from "../lib/auth/validator";
import { createScheduler, chooseNextUserItem } from "../lib/playground/scheduler";
import type { Item } from "../type";

const item: Item = {
    id: "apple",
    type: "typed_recall",
    prompt: "りんご",
    answer: "apple",
};
const items: Item[] = [
    item,
    { id: "banana", type: "typed_recall", prompt: "バナナ", answer: "banana" },
    { id: "orange", type: "typed_recall", prompt: "オレンジ", answer: "orange" },
    { id: "grape", type: "typed_recall", prompt: "ぶどう", answer: "grape" },
    { id: "duplicate", type: "typed_recall", prompt: "林檎", answer: "apple" },
    { id: "pear", type: "typed_recall", prompt: "梨", answer: "pear" },
];

test("the answer-mode selector only offers selection when no answer is typable", () => {
    assert.deepEqual(
        getAnswerModeOptions(false).map((option) => option.value),
        ["selection"],
    );
    assert.deepEqual(
        getAnswerModeOptions(true).map((option) => option.value),
        ["selection", "input"],
    );
});

test("typing uses only the first valid kana candidate, then the original answer", () => {
    for (const [answer, readings, expected] of [
        ["猫", ["ねこ"], "ねこ"], ["生物", ["せいぶつ", "なまもの"], "せいぶつ"],
        ["オレンジ", ["おれんじ"], "おれんじ"], ["学校", [], null],
        ["学校", undefined, null], ["Apple", undefined, "Apple"], ["ねこ", undefined, "ねこ"],
        ["学校", ["", "がっこう"], null], ["Apple", [42], "Apple"],
        ["学校", "がっこう", null], ["学校", ["abc"], null],
    ] as const) {
        assert.equal(getTypingAnswer({ answer, readings }), expected);
    }
    assert.equal(normalizeAnswerMode("input", true), "input");
    assert.equal(normalizeAnswerMode("auto", true), "selection");
    assert.equal(normalizeAnswerMode("input", false), "selection");
});

test("typing failures preserve the previous exposure timestamp", () => {
    const previousExposure = "2026-11-10T08:00:00.000Z";
    const attemptedAt = new Date("2026-11-11T12:00:00.000Z");
    const memory = {
        ...createInitialMemory("user", "room", item.id),
        lastPresentedAt: previousExposure,
    };

    const failed = recordAnswerModeResult({
        memory,
        userId: "user",
        roomId: "room",
        itemId: item.id,
        mode: "input",
        success: false,
        now: attemptedAt,
    });

    assert.equal(failed.lastPresentedAt, previousExposure);
    assert.equal(failed.updatedAt, attemptedAt.toISOString());

    const selectionAttempt = recordAnswerModeResult({
        memory,
        userId: "user",
        roomId: "room",
        itemId: item.id,
        mode: "selection",
        success: false,
        now: attemptedAt,
    });
    assert.equal(selectionAttempt.lastPresentedAt, attemptedAt.toISOString());
});

test("choice options are unique, include the answer, and use at most four room answers", () => {
    const options = createChoiceOptions(item, items, () => 0);
    assert.equal(options.length, 4);
    assert.ok(options.includes(item.answer));
    assert.equal(new Set(options).size, options.length);
});

test("manual selection reveal disables only distractors, even in a small room", () => {
    assert.deepEqual(getDistractorIndices(["pear", "apple", "banana"], "apple"), [0, 2]);
    assert.deepEqual(getDistractorIndices(["apple"], "apple"), []);
});

test("unknown selection is recorded once and receives more review priority than a miss", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    const memory = (id: string, usedHint: boolean) =>
        recordAnswerModeResult({
            memory: undefined,
            userId: "user",
            roomId: "room",
            itemId: id,
            mode: "selection",
            success: false,
            usedHint,
            now,
        });
    const missed = memory("missed", false);
    const revealed = memory("revealed", true);
    const wrongStats = missed.answerModeStats!.recognition;
    const unknownStats = revealed.answerModeStats!.recognition;
    assert.equal(CHOICE_UNKNOWN_FAILURE_WEIGHT, 1.3);
    assert.equal(wrongStats.attempts, 1);
    assert.equal(unknownStats.attempts, 1);
    assert.equal(unknownStats.correct, 0);
    assert.equal(unknownStats.unknownCount, 1);
    assert.equal(wrongStats.unknownCount, undefined);
    assert.ok(
        getRecognitionFailureRate(unknownStats) >
        getRecognitionFailureRate(wrongStats),
    );
    assert.equal(getRecognitionFailureRate(wrongStats), 0.5);
    assert.ok(Math.abs(getRecognitionFailureRate(unknownStats) - 0.65) < 1e-10);
    assert.equal(
        parseAnswerModeStats(revealed.answerModeStats)?.recognition.unknownCount,
        1,
    );

    const scheduler = createScheduler(["missed", "revealed"], () => 0.99);
    const chosen = chooseNextUserItem(
        scheduler,
        { missed, revealed },
        () => 0.99,
        now.getTime(),
        "selection",
    );
    assert.equal(chosen?.itemId, "revealed");

    // Old records remain valid and a clean success does not add unknowns.
    const followUp = recordAnswerModeResult({
        memory: revealed,
        userId: "user",
        roomId: "room",
        itemId: "revealed",
        mode: "selection",
        success: true,
        now: new Date(now.getTime() + 60_000),
    });
    assert.equal(followUp.answerModeStats?.recognition.unknownCount, 1);
    assert.equal(followUp.answerModeStats?.recognition.attempts, 2);
    assert.equal(followUp.answerModeStats?.recognition.correct, 1);
    assert.equal(
        parseAnswerModeStats(missed.answerModeStats)?.recognition.unknownCount,
        undefined,
    );
});

test("unsupported and long answers can be saved and empty answers cannot", () => {
    assert.equal(
        validateItems([
            { ...item, answer: "東京都🍎" },
            { ...items[1], prompt: "問".repeat(1000), answer: "🍎".repeat(100) },
        ]),
        null,
    );
    assert.notEqual(validateItems([{ ...item, prompt: "問".repeat(1001) }]), null);
    assert.notEqual(validateItems([{ ...item, answer: "🍎".repeat(101) }]), null);
    assert.notEqual(validateItems([{ ...item, answer: "   " }]), null);
});

test("choice clock skips paused and background time while preserving active response time", () => {
    const clock = createActiveResponseClock();
    assert.equal(readActiveResponseMs(clock, 0), null);
    setResponseClockActive(clock, true, 1_000);
    assert.equal(readActiveResponseMs(clock, 3_000), 2_000);
    setResponseClockActive(clock, false, 3_000);
    // One hour away from the question should not affect recognition latency.
    assert.equal(readActiveResponseMs(clock, 3_603_000), 2_000);
    setResponseClockActive(clock, true, 3_603_000);
    assert.equal(readActiveResponseMs(clock, 3_604_500), 3_500);
    setResponseClockActive(clock, false, 3_604_500);
    assert.equal(readActiveResponseMs(clock, 3_604_700), 3_500);
});

test("selection speed has a bounded, stronger bias and ignores idle responses", () => {
    const now = new Date("2026-11-17T00:00:00Z");
    const save = (previous: ReturnType<typeof createInitialMemory> | undefined, responseMs: number, success = true) =>
        recordAnswerModeResult({
            memory: previous,
            userId: "u", roomId: "r", itemId: "a",
            mode: "selection", success, responseMs, now,
        });
    const fast = save(undefined, 1_000);
    assert.equal(fast.answerModeStats?.recognition.averageResponseMs, 1_000);
    assert.equal(getRecognitionSpeedAdjustment(1_000), -0.30);
    assert.ok(getRecognitionSpeedAdjustment(5_000) < 0);
    assert.equal(getRecognitionSpeedAdjustment(8_000), 0);
    assert.ok(getRecognitionSpeedAdjustment(15_000) > 0);
    assert.ok(getRecognitionSpeedAdjustment(29_000) > getRecognitionSpeedAdjustment(15_000));
    assert.ok(getRecognitionSpeedAdjustment(29_000) <= 0.18);
    assert.ok(getRecognitionSpeedAdjustment(29_000) - getRecognitionSpeedAdjustment(1_000) > 0.46);
    assert.equal(getRecognitionSpeedAdjustment(30_000), 0);
    assert.equal(getRecognitionSpeedAdjustment(undefined), 0);

    const slow = save(fast, 15_000);
    assert.equal(slow.answerModeStats?.recognition.averageResponseMs, 5_900);
    // Responses under 30 seconds still count, rather than being clamped at 10.
    const considered = save(slow, 29_000);
    assert.equal(considered.answerModeStats?.recognition.averageResponseMs, 13_985);
    // A long idle answer adds no latency penalty and does not erase
    // an earlier response-speed sample.
    const idle = save(considered, CHOICE_SPEED_IGNORE_AFTER_MS + 3_600_000);
    assert.equal(idle.answerModeStats?.recognition.averageResponseMs, 13_985);
    const exactlyThirty = save(idle, CHOICE_SPEED_IGNORE_AFTER_MS);
    assert.equal(exactlyThirty.answerModeStats?.recognition.averageResponseMs, 13_985);
    const failed = save(exactlyThirty, 200, false);
    assert.equal(failed.answerModeStats?.recognition.averageResponseMs, 13_985);
    assert.equal(failed.reviewCount, 0);

    const parsed = parseAnswerModeStats({
        recognition: {
            attempts: 1, correct: 1, correctStreak: 1,
            lastAttemptAt: now.toISOString(),
        },
        recall: {
            attempts: 0, correct: 0, correctStreak: 0,
            lastAttemptAt: null,
        },
    });
    assert.ok(parsed);
    assert.equal(parsed.recognition.averageResponseMs, undefined);
    assert.ok(parseAnswerModeStats({
        recognition: {
            ...parsed.recognition, averageResponseMs: "invalid",
        },
        recall: parsed.recall,
    }));
});
