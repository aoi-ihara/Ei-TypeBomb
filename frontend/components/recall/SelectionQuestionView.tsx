"use client";

import { useMemo, useState } from "react";
import type { Item } from "@/type";
import { createChoiceOptions } from "@/lib/answer-mode";

type Props = {
    item: Item;
    items: Item[];
    currentInput: string | null;
    onAnswer: (correct: boolean) => void;
    onSuccess: () => void;
    isPaused?: boolean;
};

export default function SelectionQuestionView({
    item,
    items,
    currentInput,
    onAnswer,
    onSuccess,
    isPaused = false,
}: Readonly<Props>) {
    const options = useMemo(
        () => createChoiceOptions(item, items),
        [item.id, item.answer, items],
    );
    const [wrongOption, setWrongOption] = useState<string | null>(null);
    const [completed, setCompleted] = useState(false);
    const disabled = currentInput !== null || isPaused || completed;

    const choose = (option: string) => {
        if (disabled) return;
        const correct = option === item.answer;
        onAnswer(correct);
        if (correct) {
            setCompleted(true);
            onSuccess();
        } else {
            setWrongOption(option);
        }
    };

    return (
        <div className="flex w-full max-w-2xl flex-col items-center gap-5 px-2">
            <div className="text-sm font-bold text-cyan-600" data-cursor="text">
                選択問題
            </div>
            <div
                className="w-full text-center text-2xl font-bold wrap-break-words"
                data-cursor="text"
            >
                {item.prompt}
            </div>
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                {options.map((option, index) => {
                    const isWrong = wrongOption === option;
                    return (
                        <button
                            key={option + ":" + index}
                            type="button"
                            disabled={disabled}
                            onClick={() => choose(option)}
                            aria-pressed={isWrong}
                            className={[
                                "min-h-14 w-full rounded-xl border px-4 py-3 text-left font-bold wrap-break-words transition-all duration-(--duration-etb) ease-etb",
                                isWrong
                                    ? "border-red-500 bg-red-500/10 text-red-500"
                                    : "border-(--color-border) bg-(--color-background-secondary) hover:border-cyan-600",
                                disabled ? "cursor-default opacity-70" : "active:scale-[0.98]",
                            ].join(" ")}
                        >
                            <span className="mr-3 font-mono opacity-40">
                                {String.fromCharCode(65 + index)}
                            </span>
                            {option}
                        </button>
                    );
                })}
            </div>
            {wrongOption !== null && !completed && (
                <p className="text-sm font-bold text-red-500" role="status">
                    もう一度選択してください。
                </p>
            )}
        </div>
    );
}
