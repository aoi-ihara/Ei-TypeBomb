import type { Item } from "@/type";
export { getTypingAnswer } from "../../backend/shared/typing-answer.cjs";

export type AnswerMode = "selection" | "input";

export const ANSWER_MODE_OPTIONS: {
    value: AnswerMode;
    label: string;
}[] = [
    { value: "selection", label: "選択" },
    { value: "input", label: "入力" },
];

export const normalizeAnswerMode = (
    value: unknown,
    hasTypingAnswers: boolean,
): AnswerMode =>
    value === "input" && hasTypingAnswers ? "input" : "selection";

export const getAnswerModeOptions = (hasTypingAnswers: boolean) =>
    hasTypingAnswers
        ? ANSWER_MODE_OPTIONS
        : [ANSWER_MODE_OPTIONS[0]];

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
