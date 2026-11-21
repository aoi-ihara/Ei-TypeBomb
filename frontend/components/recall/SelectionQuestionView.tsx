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
import {
    canHandleSelectionSpace,
    canCountSelectionSpaceKeyDown,
    isGameSpaceKeyDown,
    isSpaceKey,
    isDualRoleSpaceRelease,
    nextSelectionSpacePress,
} from "@/lib/selection-shortcut";
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
    const lastKeyWasSpaceRef = useRef(false);
    const spaceKeyHandledRef = useRef(false);
    const spaceKeyDownRef = useRef(false);
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

    useEffect(() => {
        lastKeyWasSpaceRef.current = false;
        spaceKeyHandledRef.current = false;
        spaceKeyDownRef.current = false;
    }, [disabled, allowHint]);

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
                event.isComposing ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
            ) {
                lastKeyWasSpaceRef.current = false;
                return;
            }

            const target = event.target;
            const isEditable =
                target instanceof HTMLElement &&
                (target.isContentEditable ||
                    Boolean(target.closest("input, textarea, select")));
            if (isEditable) {
                lastKeyWasSpaceRef.current = false;
                return;
            }

            // Dual-role Space/Shift keyboards may send Shift keydown between
            // two short Space taps. It must not cancel an armed shortcut.
            if (isDualRoleSpaceRelease(event)) return;

            if (allowHint && isSpaceKey(event)) {
                const isInteractive =
                    target instanceof Element &&
                    Boolean(
                        target.closest(
                            "button, a, summary, [role='button'], [role='link']",
                        ),
                    );
                const isInsideQuestion =
                    target instanceof Node &&
                    questionRef.current?.contains(target) === true;

                if (
                    disabled ||
                    hintUsed ||
                    !canHandleSelectionSpace(
                        isEditable,
                        isInteractive,
                        isInsideQuestion,
                    )
                ) {
                    lastKeyWasSpaceRef.current = false;
                    return;
                }

                // Prevent scrolling and the native click of a focused answer
                // button. Its focus must not disable the double-Space hint.
                event.preventDefault();
                spaceKeyHandledRef.current = true;
                // Count physical down/up cycles, rather than trusting repeat
                // alone (synthetic/accessibility events may omit that flag).
                // Only an actual release can separate two presses. Some
                // Space/Shift remappers release Shift instead of Space.
                if (
                    !isGameSpaceKeyDown(event) ||
                    !canCountSelectionSpaceKeyDown(
                        event.repeat,
                        spaceKeyDownRef.current,
                    )
                )
                    return;
                spaceKeyDownRef.current = true;

                const { armed, reveal } = nextSelectionSpacePress(
                    lastKeyWasSpaceRef.current,
                    true,
                );
                lastKeyWasSpaceRef.current = armed;
                if (reveal) revealHint();
                return;
            }

            lastKeyWasSpaceRef.current = false;
            if (event.repeat || !/^[1-4]$/.test(event.key)) return;

            const index = Number(event.key) - 1;
            if (disabled || index >= options.length || wrongOptions.has(index))
                return;

            event.preventDefault();
            choose(index);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (!isSpaceKey(event)) {
                // A dual-role Space/Shift mapper can emit Shift keyup after
                // a short Space keydown. Do not mistake unrelated Shift use
                // for a release if another keydown broke the Space sequence.
                if (
                    spaceKeyDownRef.current &&
                    lastKeyWasSpaceRef.current &&
                    isDualRoleSpaceRelease(event)
                ) {
                    spaceKeyDownRef.current = false;
                    spaceKeyHandledRef.current = false;
                }
                return;
            }
            // Some browsers activate a focused button on Space keyup, not
            // keydown. Suppress that click for consumed hint shortcuts only.
            spaceKeyDownRef.current = false;
            if (spaceKeyHandledRef.current) {
                event.preventDefault();
                spaceKeyHandledRef.current = false;
            }
        };

        const resetSequence = () => {
            lastKeyWasSpaceRef.current = false;
        };
        const onFocusIn = (event: FocusEvent) => {
            // Focus moving between controls within the active question is
            // still the same interaction; entering an editor or a control
            // outside the question cancels a partially armed shortcut.
            if (
                event.target instanceof Node &&
                questionRef.current?.contains(event.target)
            )
                return;
            resetSequence();
            spaceKeyDownRef.current = false;
            spaceKeyHandledRef.current = false;
        };
        const onBlur = () => {
            resetSequence();
            spaceKeyDownRef.current = false;
            spaceKeyHandledRef.current = false;
        };

        // A click/focus change starts a new interaction. In particular, do not
        // carry half a shortcut through an editor, a dialog, or another tab.
        window.addEventListener("blur", onBlur);
        window.addEventListener("focusin", onFocusIn);
        window.addEventListener("pointerdown", resetSequence, true);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        return () => {
            window.removeEventListener("blur", onBlur);
            window.removeEventListener("focusin", onFocusIn);
            window.removeEventListener("pointerdown", resetSequence, true);
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
        };
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
        <div
            ref={questionRef}
            className="flex flex-col w-full gap-4 items-center"
        >
            <div className="flex flex-col items-center">
                <div
                    className="leading-loose text-xl text-center w-fit border border-(--color-border) px-3 rounded-lg py-1 font-serif"
                    data-cursor="text"
                >
                    {item.prompt}
                </div>
            </div>
            {masteryProgress}
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
                        <span className="font-mono text-xl">{index + 1}. </span>
                        <span className="font-serif text-xl"> {option}</span>
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
