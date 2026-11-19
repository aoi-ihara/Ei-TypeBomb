"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Item } from "@/type";
import Button from "@/components/ui/Button";
import { createChoiceOptions, getDistractorIndices } from "@/lib/answer-mode";
import {
    createActiveResponseClock,
    readActiveResponseMs,
    setResponseClockActive,
} from "@/lib/selection-timing";

type Props = {
    item: Item;
    items: Item[];
    currentInput: string | null;
    onAnswer: (
        correct: boolean,
        hadMistake: boolean,
        responseMs: number | null,
        usedHint: boolean,
    ) => void;
    onSuccess: () => void;
    isPaused?: boolean;
    allowHint?: boolean;
};

export default function SelectionQuestionView({
    item,
    items,
    currentInput,
    onAnswer,
    onSuccess,
    isPaused = false,
    allowHint = false,
}: Readonly<Props>) {
    // The component is keyed by the presented turn, so options remain stable
    // even when online room snapshots rerender the surrounding game.
    const [options] = useState(() => createChoiceOptions(item, items));
    const [wrongOptions, setWrongOptions] = useState<Set<number>>(
        () => new Set(),
    );
    const [completed, setCompleted] = useState(false);
    const [hintUsed, setHintUsed] = useState(false);
    const lastKeyWasSpaceRef = useRef(false);
    const disabled = currentInput !== null || isPaused || completed;
    const responseClock = useRef(createActiveResponseClock());

    useEffect(() => {
        const syncClock = () =>
            setResponseClockActive(
                responseClock.current,
                !disabled && document.visibilityState === "visible",
                performance.now(),
            );
        syncClock();
        document.addEventListener("visibilitychange", syncClock);
        return () => {
            document.removeEventListener("visibilitychange", syncClock);
            setResponseClockActive(
                responseClock.current,
                false,
                performance.now(),
            );
        };
    }, [disabled]);

    useEffect(() => {
        lastKeyWasSpaceRef.current = false;
    }, [disabled]);

    const revealHint = useCallback(() => {
        if (!allowHint || disabled || hintUsed) return;
        // Preserve wrong choices while disabling every remaining distractor.
        setWrongOptions((previous) => {
            const next = new Set(previous);
            for (const index of getDistractorIndices(options, item.answer))
                next.add(index);
            return next;
        });
        setHintUsed(true);
        lastKeyWasSpaceRef.current = false;
    }, [allowHint, disabled, hintUsed, options, item.answer]);

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
            // Revealed answers are not independent recognition, even if the
            // learner clicked no wrong option before requesting the hint.
            const assisted = hintUsed || wrongOptions.size > 0;
            const responseMs =
                correct && !assisted
                    ? readActiveResponseMs(
                          responseClock.current,
                          performance.now(),
                      )
                    : null;
            onAnswer(correct, correct && assisted, responseMs, hintUsed);
            if (correct) {
                setCompleted(true);
                onSuccess();
            } else {
                // A wrong choice can never be submitted again this turn.
                setWrongOptions((previous) => new Set(previous).add(index));
            }
        },
        [
            disabled,
            options,
            wrongOptions,
            hintUsed,
            item.answer,
            onAnswer,
            onSuccess,
        ],
    );

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.repeat ||
                event.isComposing ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
            )
                return;

            const target = event.target;
            if (
                target instanceof HTMLElement &&
                (target.isContentEditable ||
                    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
            ) {
                lastKeyWasSpaceRef.current = false;
                return;
            }

            if (allowHint && (event.code === "Space" || event.key === " ")) {
                // Keep native Space activation for a focused button.
                if (target instanceof HTMLElement && target.closest("button")) {
                    lastKeyWasSpaceRef.current = false;
                    return;
                }
                if (disabled || hintUsed) return;
                event.preventDefault();
                if (lastKeyWasSpaceRef.current) revealHint();
                else lastKeyWasSpaceRef.current = true;
                return;
            }

            lastKeyWasSpaceRef.current = false;
            if (!/^[1-4]$/.test(event.key)) return;

            const index = Number(event.key) - 1;
            if (disabled || index >= options.length || wrongOptions.has(index))
                return;

            event.preventDefault();
            choose(index);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        choose,
        disabled,
        options.length,
        wrongOptions,
        allowHint,
        hintUsed,
        revealHint,
    ]);

    return (
        <div className="flex flex-col gap-4 items-center">
            <div className="flex flex-col items-center">
                <div
                    className="font-bold font-mono text-xl text-center w-fit border border-(--color-border) px-2 rounded-lg py-1"
                    data-cursor="text"
                >
                    {item.prompt}
                </div>
            </div>
            <div className="max-w-lg w-full flex flex-col gap-4">
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
                        <span className="font-bold font-mono">
                            {index + 1}. {option}
                        </span>
                    </Button>
                ))}
                {allowHint && (
                    <Button
                        type="button"
                        className="w-full"
                        disabled={disabled || hintUsed}
                        onClick={revealHint}
                    >
                        分からない
                    </Button>
                )}
            </div>
        </div>
    );
}
