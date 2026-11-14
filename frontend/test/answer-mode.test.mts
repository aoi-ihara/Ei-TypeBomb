import test from "node:test";
import assert from "node:assert/strict";
import {
    createChoiceOptions,
    getAnswerModeOptions,
    getTypingAnswer,
    normalizeAnswerMode,
} from "../lib/answer-mode";
import {
    createInitialMemory,
    recordAnswerModeResult,
} from "../lib/playground/memory";
import { validateItems } from "../lib/auth/validator";
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
