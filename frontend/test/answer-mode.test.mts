import test from "node:test";
import assert from "node:assert/strict";
import {
    createChoiceOptions,
    getDistractorIndices,
    getAnswerModeOptions,
    getTypingAnswer,
    getEffectiveAnswerMode,
    normalizeAnswerMode,
    toLearningAnswerMode,
    getRecognitionChoiceCount,
} from "../lib/answer-mode";
import {
    createInitialMemory,
    recordAnswerModeResult,
    getRecognitionSpeedAdjustment,
    getRecognitionFailureRate,
    getRecognitionRetrievability,
    getMasteryProgress,
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
import {
    canHandleSelectionSpace,
    canCountSelectionSpaceKeyDown,
    isGameSpaceKeyDown,
    isDualRoleSpaceRelease,
    nextSelectionSpacePress,
} from "../lib/selection-shortcut";
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

test("the answer-mode selector offers card even when no answer is typable", () => {
    assert.deepEqual(
        getAnswerModeOptions(false).map((option) => option.value),
        ["selection", "card"],
    );
    assert.deepEqual(
        getAnswerModeOptions(true).map((option) => option.value),
        ["selection", "input", "card"],
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
    assert.equal(normalizeAnswerMode("card", false), "card");
    assert.equal(normalizeAnswerMode("card", true), "card");
    assert.equal(toLearningAnswerMode("card"), "selection");
    assert.equal(toLearningAnswerMode("input"), "input");
    assert.equal(toLearningAnswerMode("selection"), "selection");
});

test("effective answer mode follows ItemView's per-item typing fallback", () => {
    const selectionOnly = { ...item, answer: "東京都🍎" };
    assert.equal(getTypingAnswer(selectionOnly), null);
    assert.equal(getEffectiveAnswerMode(selectionOnly, "input"), "selection");
    assert.equal(getEffectiveAnswerMode(item, "input"), "input");
    assert.equal(getEffectiveAnswerMode(item, "selection"), "selection");
});

test("mixed input rooms include selection-only mastery in current and 24h counts", () => {
    const timestamp = Date.parse("2026-11-20T00:00:00.000Z");
    const typedItem = { ...item, id: "typed" };
    const choiceItem = { ...item, id: "choice", answer: "東京都🍎" };
    const typedMemory = {
        ...createInitialMemory("u", "r", typedItem.id),
        stability: 10,
        reviewCount: 1,
        lastReviewedAt: new Date(timestamp).toISOString(),
    };
    const choiceMemory = recordAnswerModeResult({
        memory: undefined,
        userId: "u",
        roomId: "r",
        itemId: choiceItem.id,
        mode: "selection",
        success: true,
        now: new Date(timestamp),
    });
    const modes = Object.fromEntries(
        [typedItem, choiceItem].map((entry) => [
            entry.id, getEffectiveAnswerMode(entry, "input"),
        ]),
    );
    const result = getMasteryProgress(
        [typedItem.id, choiceItem.id],
        { typed: typedMemory, choice: choiceMemory },
        timestamp,
        0.8,
        "input",
        modes,
    );
    assert.deepEqual(result, {
        total: 2,
        masteredNow: 2,
        masteredAfter3Hours: 1,
        masteredAfter24Hours: 1,
    });
    const dayLater = getMasteryProgress(
        [typedItem.id, choiceItem.id],
        { typed: typedMemory, choice: choiceMemory },
        timestamp + 24 * 60 * 60 * 1000,
        0.8,
        "input",
        modes,
    );
    assert.equal(dayLater.masteredNow, 1);
    // The original room-wide mode would incorrectly drop the selection item.
    assert.equal(
        getMasteryProgress(
            [typedItem.id, choiceItem.id],
            { typed: typedMemory, choice: choiceMemory },
            timestamp,
            0.8,
            "input",
        ).masteredNow,
        1,
    );
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

test("game start and selection share the same Space keydown detection", () => {
    const space = { key: " ", code: "Space", repeat: false, isComposing: false };
    assert.equal(isGameSpaceKeyDown(space), true);
    assert.equal(isGameSpaceKeyDown({ ...space, key: "Shift" }), true);
    assert.equal(isGameSpaceKeyDown({ ...space, code: "", key: "Spacebar" }), true);
    assert.equal(isGameSpaceKeyDown({ ...space, repeat: true }), false);
    assert.equal(isGameSpaceKeyDown({ ...space, isComposing: true }), false);
    assert.equal(isGameSpaceKeyDown({ ...space, key: "Shift", code: "ShiftLeft" }), false);
});

test("Space keydowns require a release even after delayed repeat-flag-free events", () => {
    assert.equal(canCountSelectionSpaceKeyDown(false, false), true);
    assert.equal(canCountSelectionSpaceKeyDown(false, true), false);
    assert.equal(canCountSelectionSpaceKeyDown(true, true), false);
    assert.equal(canCountSelectionSpaceKeyDown(false, false), true);
    assert.equal(isDualRoleSpaceRelease({ key: "Shift", code: "ShiftLeft" }), true);
    assert.equal(isDualRoleSpaceRelease({ key: "Shift", code: "ShiftRight" }), true);
    assert.equal(isDualRoleSpaceRelease({ key: " ", code: "Space" }), false);
    assert.equal(isDualRoleSpaceRelease({ key: "Control", code: "ControlLeft" }), false);
});

test("double-Space hint works when an answer button has focus", () => {
    // Previously all focused buttons were excluded, silently preventing the
    // shortcut for users who clicked a choice before pressing Space.
    assert.equal(canHandleSelectionSpace(false, true, true), true);
    assert.equal(canHandleSelectionSpace(false, false, false), true);

    const first = nextSelectionSpacePress(false, true);
    assert.deepEqual(first, { armed: true, reveal: false });
    const second = nextSelectionSpacePress(first.armed, true);
    assert.deepEqual(second, { armed: false, reveal: true });

    // Key repeat is filtered at the keyboard handler: a different key resets
    // the shortcut, so two nonconsecutive presses do not reveal the answer.
    assert.deepEqual(nextSelectionSpacePress(true, false), {
        armed: false,
        reveal: false,
    });
    assert.deepEqual(nextSelectionSpacePress(false, true), {
        armed: true,
        reveal: false,
    });

    // Buttons outside the question keep their native Space behavior.
    assert.equal(canHandleSelectionSpace(false, true, false), false);
    // Focused inputs/contenteditable never activate the shortcut.
    assert.equal(canHandleSelectionSpace(true, true, true), false);
    assert.equal(canHandleSelectionSpace(true, false, false), false);
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
    // Recognition tracks its own stability; typing free recall is unchanged.
    assert.equal(failed.reviewCount, 0);
    assert.ok(failed.answerModeStats?.recognition.stability);

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


test("clean choice recall grows recognition stability with spaced practice", () => {
    const day = 24 * 60 * 60 * 1000;
    const firstTime = new Date("2026-11-20T00:00:00.000Z");
    const first = recordAnswerModeResult({
        memory: undefined,
        userId: "u",
        roomId: "r",
        itemId: "apple",
        mode: "selection",
        success: true,
        responseMs: 1800,
        now: firstTime,
    });
    const firstStability = first.answerModeStats!.recognition.stability!;
    assert.ok(firstStability > 0);
    assert.equal(getRecognitionRetrievability(first, firstTime.getTime()), 1);
    assert.ok(getRecognitionRetrievability(first, firstTime.getTime() + day) < 0.8);
    assert.equal(first.lastReviewedAt, null);
    assert.equal(first.reviewCount, 0);

    const secondTime = new Date(firstTime.getTime() + day);
    const second = recordAnswerModeResult({
        memory: first,
        userId: "u",
        roomId: "r",
        itemId: "apple",
        mode: "selection",
        success: true,
        now: secondTime,
    });
    assert.ok(second.answerModeStats!.recognition.stability! > firstStability);
    assert.equal(second.answerModeStats!.recognition.lastReviewedAt, secondTime.toISOString());
    assert.equal(getRecognitionRetrievability(second, secondTime.getTime()), 1);
    assert.equal(second.stability, first.stability);
    assert.equal(second.lastReviewedAt, first.lastReviewedAt);
    assert.equal(
        parseAnswerModeStats(second.answerModeStats)?.recognition.stability,
        second.answerModeStats!.recognition.stability,
    );
});

test("spaced wrong and revealed selections reduce stability without crediting a recall", () => {
    const start = new Date("2026-11-20T00:00:00.000Z");
    const reviewed = recordAnswerModeResult({
        memory: undefined, userId: "u", roomId: "r", itemId: "a",
        mode: "selection", success: true, now: start,
    });
    const afterDay = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const wrong = recordAnswerModeResult({
        memory: reviewed, userId: "u", roomId: "r", itemId: "a",
        mode: "selection", success: false, now: afterDay,
    });
    const revealed = recordAnswerModeResult({
        memory: reviewed, userId: "u", roomId: "r", itemId: "a",
        mode: "selection", success: false, usedHint: true, now: afterDay,
    });
    assert.ok(wrong.answerModeStats!.recognition.stability! < reviewed.answerModeStats!.recognition.stability!);
    assert.ok(revealed.answerModeStats!.recognition.stability! <= wrong.answerModeStats!.recognition.stability!);
    assert.equal(wrong.answerModeStats!.recognition.lastReviewedAt, start.toISOString());
    assert.equal(revealed.answerModeStats!.recognition.lastReviewedAt, start.toISOString());
    assert.ok(getRecognitionRetrievability(wrong, afterDay.getTime()) <=
        getRecognitionRetrievability(reviewed, afterDay.getTime()));
    assert.equal(getRecognitionRetrievability(recordAnswerModeResult({
        memory: undefined, userId: "u", roomId: "r", itemId: "a",
        mode: "selection", success: false, usedHint: true, now: start,
    }), start.getTime()), 0);
    assert.equal(revealed.answerModeStats!.recognition.unknownCount, 1);
});

test("selection mastery bar counts recognition instead of free recall", () => {
    const timestamp = Date.parse("2026-11-20T00:00:00.000Z");
    const mastered = recordAnswerModeResult({
        memory: undefined, userId: "u", roomId: "r", itemId: "a",
        mode: "selection", success: true, now: new Date(timestamp),
    });
    assert.deepEqual(
        getMasteryProgress(["a", "b"], { a: mastered }, timestamp, 0.8, "selection"),
        { total: 2, masteredNow: 1, masteredAfter3Hours: 0, masteredAfter24Hours: 0 },
    );
    assert.deepEqual(
        getMasteryProgress(["a", "b"], { a: mastered }, timestamp, 0.8, "input"),
        { total: 2, masteredNow: 0, masteredAfter3Hours: 0, masteredAfter24Hours: 0 },
    );
    assert.equal(
        getMasteryProgress(["a", "b"], { a: mastered }, timestamp + 24 * 60 * 60 * 1000, 0.8, "selection").masteredNow,
        0,
    );
});

test("selection scheduler prioritizes decayed recognition even at equal accuracy and speed", () => {
    const timestamp = Date.parse("2026-11-20T00:00:00.000Z");
    const records = Object.fromEntries(
        [["stable", 10], ["fragile", 0.3]].map(([id, stability]) => {
            const memory = recordAnswerModeResult({
                memory: undefined, userId: "u", roomId: "r",
                itemId: String(id), mode: "selection",
                success: true, now: new Date(timestamp),
            });
            memory.answerModeStats!.recognition.stability = Number(stability);
            return [String(id), memory];
        }),
    );
    const now = timestamp + 24 * 60 * 60 * 1000;
    const scheduler = createScheduler(["stable", "fragile"], () => 0.99);
    const first = chooseNextUserItem(scheduler, records, () => 0.99, now, "selection");
    assert.equal(first?.itemId, "fragile");
});

test("legacy recognition history without stability remains readable", () => {
    const stamp = "2026-11-20T00:00:00.000Z";
    const old = parseAnswerModeStats({
        recognition: { attempts: 1, correct: 1, correctStreak: 1, lastAttemptAt: stamp },
        recall: { attempts: 0, correct: 0, correctStreak: 0, lastAttemptAt: null },
    });
    assert.ok(old);
    const state = { ...createInitialMemory("u", "r", "a"), answerModeStats: old };
    assert.equal(getRecognitionRetrievability(state, Date.parse(stamp)), 1);
    const updated = recordAnswerModeResult({
        memory: state, userId: "u", roomId: "r", itemId: "a",
        mode: "selection", success: true, now: new Date(Date.parse(stamp) + 86_400_000),
    });
    assert.ok(updated.answerModeStats!.recognition.stability! > 0);
    assert.equal(updated.answerModeStats!.recognition.lastReviewedAt, new Date(Date.parse(stamp) + 86_400_000).toISOString());
});

test("card self-assessment records recognition without distractors", () => {
    assert.equal(getRecognitionChoiceCount("selection", 1), 1);
    assert.equal(getRecognitionChoiceCount("card", 1), 2);
    assert.equal(getRecognitionChoiceCount("card", 4), 4);
    const now = new Date("2026-11-24T00:00:00Z");
    for (const success of [true, false]) {
        const rated = recordAnswerModeResult({
            memory: undefined, userId: "u", roomId: "r", itemId: item.id,
            mode: toLearningAnswerMode("card"), success, now,
            choiceCount: getRecognitionChoiceCount("card", 1),
        });
        assert.equal(rated.answerModeStats?.recognition.attempts, 1);
        assert.equal(rated.answerModeStats?.recognition.correct, Number(success));
        assert.equal(rated.answerModeStats?.recognition.unknownCount ?? 0, 0);
    }
});
