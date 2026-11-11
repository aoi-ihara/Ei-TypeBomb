import type { Item } from "@/type";
import { isAllowedTypingAnswer } from "@/lib/room/importWords";
import {
    getRetrievability,
    type ItemMemoryState,
} from "@/lib/playground/memory";

export type AnswerMode = "selection" | "auto" | "input";
export type QuestionPresentation = "selection" | "input";

export const ANSWER_MODE_OPTIONS: {
    value: AnswerMode;
    label: string;
}[] = [
    { value: "selection", label: "選択" },
    { value: "auto", label: "自動" },
    { value: "input", label: "入力" },
];

export const isAnswerMode = (value: unknown): value is AnswerMode =>
    value === "selection" || value === "auto" || value === "input";

export const getAnswerModeOptions = (hasTypingAnswers: boolean) =>
    hasTypingAnswers
        ? ANSWER_MODE_OPTIONS
        : [ANSWER_MODE_OPTIONS[0]];

const isRecent = (value: string | null | undefined, now: number) => {
    if (!value) return false;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) &&
        now - timestamp <= 7 * 24 * 60 * 60_000;
};

export const resolveQuestionPresentation = (
    mode: AnswerMode,
    item: Item,
    memory?: ItemMemoryState,
    now = Date.now(),
): QuestionPresentation => {
    // Unsupported characters are always answered through recognition choices.
    if (!isAllowedTypingAnswer(item.answer)) return "selection";
    if (mode === "selection") return "selection";
    if (mode === "input") return "input";

    const stats = memory?.answerModeStats;
    if (stats) {
        const recallMastered =
            stats.recall.correctStreak > 0 &&
            isRecent(stats.recall.lastAttemptAt, now);
        const recognitionMastered =
            stats.recognition.correctStreak >= 3 &&
            isRecent(stats.recognition.lastAttemptAt, now);
        return recallMastered || recognitionMastered ? "input" : "selection";
    }

    // Existing memory rows predate answer-mode statistics. Preserve their
    // progress without pretending a single successful review proves mastery.
    return memory &&
        memory.reviewCount >= 3 &&
        getRetrievability(memory, now) >= 0.7
        ? "input"
        : "selection";
};

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
