import test from "node:test";
import assert from "node:assert/strict";
import {
    createChoiceOptions,
    getAnswerModeOptions,
    resolveQuestionPresentation,
} from "../lib/answer-mode";
import {
    applyRecallObservation,
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
        ["selection", "auto", "input"],
    );
});

test("fixed modes and unsupported answers resolve to the expected question format", () => {
    assert.equal(resolveQuestionPresentation("selection", item), "selection");
    assert.equal(resolveQuestionPresentation("input", item), "input");
    assert.equal(
        resolveQuestionPresentation("input", {
            ...item,
            answer: "東京都🍎",
        }),
        "selection",
    );
    assert.equal(resolveQuestionPresentation("auto", item), "selection");
});

test("automatic mode promotes three consecutive recognitions to typed input", () => {
    let memory = createInitialMemory("user", "room", item.id);
    const now = new Date("2026-11-11T12:00:00.000Z");
    for (let index = 0; index < 3; index++) {
        memory = recordAnswerModeResult({
            memory,
            userId: "user",
            roomId: "room",
            itemId: item.id,
            mode: "selection",
            success: true,
            now: new Date(now.getTime() + index * 1000),
        });
    }
    assert.equal(
        resolveQuestionPresentation("auto", item, memory, now.getTime() + 3000),
        "input",
    );

    memory = recordAnswerModeResult({
        memory,
        userId: "user",
        roomId: "room",
        itemId: item.id,
        mode: "input",
        success: false,
        now: new Date(now.getTime() + 4000),
    });
    assert.equal(
        resolveQuestionPresentation("auto", item, memory, now.getTime() + 5000),
        "selection",
    );
});

test("automatic mode keeps typed input after independent recall and rejects hinted recall", () => {
    const now = new Date("2026-11-11T12:00:00.000Z");
    const initial = createInitialMemory("user", "room", item.id);
    const observation = {
        success: true,
        answerLength: item.answer.length,
        outcome: "free_recall" as const,
        firstAttemptCorrect: true,
        attemptCount: 1,
        incorrectInputCount: 0,
        hintCount: 0,
        revealedHintChars: 0,
        maxCorrectPrefixLength: item.answer.length,
        recallLatencyMs: 100,
        elapsedMs: 700,
        finalCueRatio: 0,
        initialCueRatio: 0,
        additionalHintCount: 0,
        answerWasFullyRevealed: false,
        elapsedSincePresentationMs: 60_000,
    };
    const recalled = applyRecallObservation({
        memory: initial,
        observation,
        userId: "user",
        roomId: "room",
        itemId: item.id,
        now,
    });
    assert.equal(
        resolveQuestionPresentation("auto", item, recalled, now.getTime() + 1000),
        "input",
    );

    const hinted = applyRecallObservation({
        memory: initial,
        observation: {
            ...observation,
            hintCount: 1,
            additionalHintCount: 1,
            finalCueRatio: 0.2,
        },
        userId: "user",
        roomId: "room",
        itemId: item.id,
        now,
    });
    assert.equal(
        resolveQuestionPresentation("auto", item, hinted, now.getTime() + 1000),
        "selection",
    );
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
            { ...items[1], answer: "x".repeat(200) },
        ]),
        null,
    );
    assert.notEqual(validateItems([{ ...item, answer: "   " }]), null);
});
