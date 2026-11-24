"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import type { CardRating } from "@/lib/answer-mode";
import {
    canCountSelectionSpaceKeyDown,
    canHandleSelectionSpace,
    isDualRoleSpaceRelease,
    isGameSpaceKeyDown,
    isSpaceKey,
    nextSelectionSpacePress,
} from "@/lib/selection-shortcut";
import type { Item } from "@/type";

type Props = {
    item: Item;
    currentInput: string | null;
    onRate: (rating: CardRating) => void;
    isPaused?: boolean;
};

const RATING_KEYS: Record<string, CardRating> = {
    "1": "correct",
    "2": "incorrect",
    "3": "unknown",
};

/** A flashcard: reveal the answer, then grade your own recall. */
export default function CardView({
    item,
    currentInput,
    onRate,
    isPaused = false,
}: Readonly<Props>) {
    const [revealed, setRevealed] = useState(false);
    const [completed, setCompleted] = useState(false);
    const questionRef = useRef<HTMLDivElement>(null);
    const lastKeyWasSpaceRef = useRef(false);
    const spaceKeyDownRef = useRef(false);
    const spaceKeyHandledRef = useRef(false);
    const disabled = currentInput !== null || isPaused || completed;

    const resetSpaceSequence = useCallback(() => {
        lastKeyWasSpaceRef.current = false;
        spaceKeyDownRef.current = false;
        spaceKeyHandledRef.current = false;
    }, []);

    useEffect(() => {
        resetSpaceSequence();
    }, [disabled, revealed, resetSpaceSequence]);

    const reveal = useCallback(() => {
        if (disabled || revealed) return;
        setRevealed(true);
        resetSpaceSequence();
    }, [disabled, revealed, resetSpaceSequence]);

    const rate = useCallback(
        (rating: CardRating) => {
            if (disabled || !revealed) return;
            setCompleted(true);
            resetSpaceSequence();
            onRate(rating);
        },
        [disabled, revealed, resetSpaceSequence, onRate],
    );

    // The offline hint shortcut is double Space. Keep the same convention here,
    // including focused-button and dual-role keyboard handling.
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (
                event.isComposing ||
                event.altKey ||
                event.ctrlKey ||
                event.metaKey
            ) {
                resetSpaceSequence();
                return;
            }
            const target = event.target;
            const isEditable =
                target instanceof HTMLElement &&
                (target.isContentEditable ||
                    Boolean(target.closest("input, textarea, select")));
            if (isEditable) {
                resetSpaceSequence();
                return;
            }
            if (isDualRoleSpaceRelease(event)) return;

            if (isSpaceKey(event)) {
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
                    revealed ||
                    !canHandleSelectionSpace(
                        isEditable,
                        isInteractive,
                        isInsideQuestion,
                    )
                ) {
                    resetSpaceSequence();
                    return;
                }
                event.preventDefault();
                spaceKeyHandledRef.current = true;
                if (
                    !isGameSpaceKeyDown(event) ||
                    !canCountSelectionSpaceKeyDown(
                        event.repeat,
                        spaceKeyDownRef.current,
                    )
                )
                    return;
                spaceKeyDownRef.current = true;
                const { armed, reveal: shouldReveal } =
                    nextSelectionSpacePress(lastKeyWasSpaceRef.current, true);
                lastKeyWasSpaceRef.current = armed;
                if (shouldReveal) reveal();
                return;
            }

            resetSpaceSequence();
            if (event.repeat || !revealed) return;
            const rating = RATING_KEYS[event.key];
            if (!rating) return;
            event.preventDefault();
            rate(rating);
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (!isSpaceKey(event)) {
                // A dual-role Space/Shift mapper can finish a short tap with
                // Shift keyup instead of Space keyup.
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
            spaceKeyDownRef.current = false;
            if (spaceKeyHandledRef.current) {
                event.preventDefault();
                spaceKeyHandledRef.current = false;
            }
        };
        const onFocusIn = (event: FocusEvent) => {
            if (
                event.target instanceof Node &&
                questionRef.current?.contains(event.target)
            )
                return;
            resetSpaceSequence();
        };

        window.addEventListener("blur", resetSpaceSequence);
        window.addEventListener("focusin", onFocusIn);
        window.addEventListener("pointerdown", resetSpaceSequence, true);
        window.addEventListener("keydown", onKeyDown, true);
        window.addEventListener("keyup", onKeyUp, true);
        return () => {
            window.removeEventListener("blur", resetSpaceSequence);
            window.removeEventListener("focusin", onFocusIn);
            window.removeEventListener("pointerdown", resetSpaceSequence, true);
            window.removeEventListener("keydown", onKeyDown, true);
            window.removeEventListener("keyup", onKeyUp, true);
        };
    }, [disabled, revealed, rate, resetSpaceSequence, reveal]);

    return (
        <div
            ref={questionRef}
            className="flex flex-col w-full gap-4 items-center"
        >
            <div
                className="leading-loose text-xl text-center w-fit border border-(--color-border) px-3 rounded-lg py-1 font-serif"
                data-cursor="text"
            >
                {item.prompt}
            </div>
            <div className="max-w-lg w-full flex flex-col gap-4">
                {revealed ? (
                    <>
                        <div
                            className="animate-appear rounded-lg border border-cyan-600/50 bg-cyan-600/10 px-4 py-3 text-center font-serif text-xl"
                            role="status"
                            aria-label="答え"
                            data-cursor="text"
                        >
                            {item.answer}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <Button
                                type="button"
                                variant="primary"
                                aria-keyshortcuts="1"
                                disabled={disabled}
                                onClick={() => rate("correct")}
                            >
                                正解
                            </Button>
                            <Button
                                type="button"
                                aria-keyshortcuts="2"
                                disabled={disabled}
                                onClick={() => rate("incorrect")}
                            >
                                不正解
                            </Button>
                            <Button
                                type="button"
                                aria-keyshortcuts="3"
                                disabled={disabled}
                                onClick={() => rate("unknown")}
                            >
                                分からなかった
                            </Button>
                        </div>
                    </>
                ) : (
                    <Button
                        type="button"
                        variant="primary"
                        padding="large"
                        className="w-full"
                        disabled={disabled}
                        onClick={reveal}
                    >
                        表示
                    </Button>
                )}
            </div>
        </div>
    );
}
