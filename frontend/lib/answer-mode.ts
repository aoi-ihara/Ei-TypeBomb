import type { Item } from "@/type";
import { getTypingAnswer } from "../../backend/shared/typing-answer.cjs";
export { getTypingAnswer };

export type AnswerMode = "selection" | "input" | "card";
export type CardRating = "correct" | "incorrect" | "unknown";

// Cards use the same spaced-repetition model as recognition questions: only
// the presentation differs, so their effective learning mode is "selection".
// ItemView also falls back to selection for answers that cannot be typed.
// Keep progress calculations in sync with the mode actually rendered.
export const getEffectiveAnswerMode = (
    item: Item,
    requestedMode: AnswerMode,
): "selection" | "input" =>
    requestedMode === "input" && getTypingAnswer(item) !== null
        ? "input"
        : "selection";

export const ANSWER_MODE_OPTIONS: {
    value: AnswerMode;
    label: string;
}[] = [
    { value: "selection", label: "選択" },
    { value: "input", label: "入力" },
    { value: "card", label: "カード" },
];

export const normalizeAnswerMode = (
    value: unknown,
    hasTypingAnswers: boolean,
): AnswerMode => {
    if (value === "card") return "card";
    return value === "input" && hasTypingAnswers ? "input" : "selection";
};

export const getAnswerModeOptions = (hasTypingAnswers: boolean) =>
    hasTypingAnswers
        ? ANSWER_MODE_OPTIONS
        : [ANSWER_MODE_OPTIONS[0], ANSWER_MODE_OPTIONS[2]];

const shuffle = <T,>(values: T[], random: () => number): T[] => {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
        const target = Math.min(
            index,
            Math.floor(random() * (index + 1)),
        );
        [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
};

// All distractors disappear in offline "I don't know" hint mode.
export const getDistractorIndices = (
    options: string[],
    correctAnswer: string,
): number[] =>
    options.flatMap((option, index) =>
        option === correctAnswer ? [] : [index],
    );

export const createChoiceOptions = (
    item: Item,
    items: Item[],
    random: () => number = Math.random,
    optionCount = 4,
): string[] => {
    const correct = item.answer;
    const distractors = Array.from(
        new Set(
            items
                .filter((candidate) => candidate.id !== item.id)
                .map((candidate) => candidate.answer)
                .filter((answer) => answer && answer !== correct),
        ),
    );
    const selectedDistractors = shuffle(distractors, random).slice(
        0,
        Math.max(0, optionCount - 1),
    );
    return shuffle([correct, ...selectedDistractors], random);
};
