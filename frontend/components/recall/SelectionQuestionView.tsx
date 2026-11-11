"use client";

import { useCallback, useEffect, useState } from "react";
import type { Item } from "@/type";
import Button from "@/components/ui/Button";
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
    // The component is keyed by the presented turn, so options remain stable
    // even when online room snapshots rerender the surrounding game.
    const [options] = useState(() => createChoiceOptions(item, items));
    const [wrongOptions, setWrongOptions] = useState<Set<number>>(
        () => new Set(),
    );
    const [completed, setCompleted] = useState(false);
    const disabled = currentInput !== null || isPaused || completed;

    const choose = useCallback(
        (index: number) => {
            if (
                disabled ||
                index < 0 ||
                index >= options.length ||
                wrongOptions.has(index)
            )
                return;

            const correct = options[index] === item.answer;
            onAnswer(correct);
            if (correct) {
                setCompleted(true);
                onSuccess();
            } else {
                // A wrong choice can never be submitted again this turn.
                setWrongOptions((previous) => new Set(previous).add(index));
            }
        },
        [disabled, options, wrongOptions, item.answer, onAnswer, onSuccess],
    );

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.repeat ||
                event.isComposing ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                !/^[1-4]$/.test(event.key)
            )
                return;

            const target = event.target;
            if (
                target instanceof HTMLElement &&
                (target.isContentEditable ||
                    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
            )
                return;

            const index = Number(event.key) - 1;
            if (disabled || index >= options.length || wrongOptions.has(index))
                return;

            event.preventDefault();
            choose(index);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [choose, disabled, options.length, wrongOptions]);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center">
                <div
                    className="font-bold font-mono text-xl text-center w-fit border border-(--color-border) px-2 rounded-lg py-1"
                    data-cursor="text"
                >
                    {item.prompt}
                </div>
            </div>
            <div className="w-64 flex flex-col gap-4">
                {options.map((option, index) => (
                    <Button
                        key={option + ":" + index}
                        type="button"
                        variant="primary"
                        padding="large"
                        alignment="left"
                        className="w-full"
                        disabled={disabled || wrongOptions.has(index)}
                        onClick={() => choose(index)}
                    >
                        {index + 1}. {option}
                    </Button>
                ))}
            </div>
        </div>
    );
}
