import type { Item } from "@/type";
import { getTypingAnswer } from "../../backend/shared/typing-answer.cjs";
export { getTypingAnswer };

export type AnswerMode = "selection" | "input";
export type OfflineAnswerMode = AnswerMode | "card";

// Card practice deliberately shares the selection memory model for now.
export const toLearningAnswerMode = (mode: OfflineAnswerMode): AnswerMode =>
    mode === "card" ? "selection" : mode;

// Self-assessment remains a meaningful binary choice even without distractors.
export const getRecognitionChoiceCount = (mode: OfflineAnswerMode, distinctAnswers: number): number =>
    mode === "card" ? Math.max(2, distinctAnswers) : distinctAnswers;

// ItemView falls back to selection for answers that cannot be typed.
// Keep progress calculations in sync with the mode actually rendered.
export const getEffectiveAnswerMode = (
    item: Item,
    requestedMode: AnswerMode,
): AnswerMode =>
    requestedMode === "input" && getTypingAnswer(item) !== null
        ? "input"
        : "selection";

export const ANSWER_MODE_OPTIONS: {
    value: OfflineAnswerMode;
    label: string;
}[] = [
    { value: "selection", label: "選択" },
    { value: "input", label: "入力" },
    { value: "card", label: "カード" },
];

export const normalizeAnswerMode = (
    value: unknown,
    hasTypingAnswers: boolean,
): OfflineAnswerMode =>
    value === "card" ? "card" : value === "input" && hasTypingAnswers ? "input" : "selection";

export const getAnswerModeOptions = (hasTypingAnswers: boolean) =>
    ANSWER_MODE_OPTIONS.filter(option => hasTypingAnswers || option.value !== "input");

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
