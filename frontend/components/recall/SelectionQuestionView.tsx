"use client";

import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import type { Item } from "@/type";
import Button from "@/components/ui/Button";
import { createChoiceOptions, getDistractorIndices } from "@/lib/answer-mode";
import { useSelectionShortcuts } from "@/lib/use-selection-shortcuts";
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
    masteryProgress?: ReactNode;
};

export default function SelectionQuestionView({
    item,
    items,
    currentInput,
    onAnswer,
    onSuccess,
    isPaused = false,
    allowHint = false,
    masteryProgress,
}: Readonly<Props>) {
    // The component is keyed by the presented turn, so options remain stable
    // even when online room snapshots rerender the surrounding game.
    const [options] = useState(() => createChoiceOptions(item, items));
    const [wrongOptions, setWrongOptions] = useState<Set<number>>(
        () => new Set(),
    );
    const [completed, setCompleted] = useState(false);
    const [hintUsed, setHintUsed] = useState(false);
    const questionRef = useRef<HTMLDivElement>(null);
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

    const onOtherKeyDown = useCallback((event: KeyboardEvent) => {
        if (!/^[1-4]$/.test(event.key)) return;
        const index = Number(event.key) - 1;
        if (index >= options.length || wrongOptions.has(index)) return;
        event.preventDefault();
        choose(index);
    }, [choose, options.length, wrongOptions]);

    useSelectionShortcuts({
        questionRef, disabled, allowHint, hintUsed, revealHint, onOtherKeyDown,
    });

    return (
        <div
            ref={questionRef}
            className="flex flex-col w-full gap-4 items-center"
        >
            <div className="flex flex-col items-center">
                <div
                    data-question-slide-width
                    className="leading-loose text-xl text-center w-fit border border-(--color-border) px-3 rounded-lg py-1 font-serif"
                    data-cursor="text"
                >
                    {item.prompt}
                </div>
            </div>
            {masteryProgress}
            <div data-question-slide-width className="max-w-lg w-full flex flex-col gap-4">
                {options.map((option, index) => (
                    <Button
                        key={option + ":" + index}
                        type="button"
                        padding="large"
                        alignment="left"
                        className="w-full"
                        disabled={disabled || wrongOptions.has(index)}
                        onClick={() => choose(index)}
                    >
                        <span className="font-mono">{index + 1}. </span>
                        <span className="font-serif text-xl font-normal">
                            {" "}
                            {option}
                        </span>
                    </Button>
                ))}
                {allowHint && (
                    <Button
                        type="button"
                        className="w-full"
                        font="mono"
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
