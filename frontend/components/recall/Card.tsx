"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Item } from "@/type";
import Button from "@/components/ui/Button";
import "./card.css";
import { useSelectionShortcuts } from "@/lib/use-selection-shortcuts";
import {
    createActiveResponseClock,
    readActiveResponseMs,
    setResponseClockActive,
} from "@/lib/selection-timing";

type Phase = "hidden" | "revealed" | "unknown";
type Props = {
    item: Item;
    currentInput: string | null;
    isPaused?: boolean;
    onAnswer: (
        correct: boolean,
        hadMistake: boolean,
        responseMs: number | null,
        usedHint: boolean,
    ) => void;
    onSuccess: () => void;
};

export default function Card({
    item,
    currentInput,
    isPaused = false,
    onAnswer,
    onSuccess,
}: Readonly<Props>) {
    // ItemView is keyed by presentation, including consecutive repeats.
    const [phase, setPhase] = useState<Phase>("hidden");
    const phaseRef = useRef<Phase>("hidden");
    const completed = useRef(false);
    const questionRef = useRef<HTMLDivElement>(null);
    const nextButtonRef = useRef<HTMLDivElement>(null);
    const moveFocusToNext = useRef(false);
    const clock = useRef(createActiveResponseClock());
    const responseMs = useRef<number | null>(null);
    const disabled = currentInput !== null || isPaused;
    const hidden = phase === "hidden";

    useEffect(() => {
        const syncClock = () =>
            setResponseClockActive(
                clock.current,
                !disabled && hidden && document.visibilityState === "visible",
                performance.now(),
            );
        syncClock();
        document.addEventListener("visibilitychange", syncClock);
        return () => {
            document.removeEventListener("visibilitychange", syncClock);
            setResponseClockActive(clock.current, false, performance.now());
        };
    }, [disabled, hidden]);

    const reveal = useCallback(
        (unknown: boolean) => {
            if (disabled || completed.current || phaseRef.current !== "hidden")
                return;
            const now = performance.now();
            responseMs.current = readActiveResponseMs(clock.current, now);
            setResponseClockActive(clock.current, false, now);
            // WebKit can retain focus on the disabled mask after it is hidden.
            // Move focus to the replacement action only if this question owned it.
            moveFocusToNext.current = unknown &&
                questionRef.current?.contains(document.activeElement) === true;
            const next = unknown ? "unknown" : "revealed";
            phaseRef.current = next;
            setPhase(next);
        },
        [disabled],
    );

    useLayoutEffect(() => {
        if (phase !== "unknown" || !moveFocusToNext.current) return;
        moveFocusToNext.current = false;
        nextButtonRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    }, [phase]);

    const finish = useCallback(
        (remembered: boolean) => {
            if (disabled || completed.current || phaseRef.current === "hidden")
                return;
            if (remembered && phaseRef.current !== "revealed") return;
            completed.current = true;
            // The selection callback expects one completed question. An incorrect
            // self-rating and an unknown answer both use the ordinary missed-
            // selection path, never the additional unknown/hint penalty.
            onAnswer(
                true,
                !remembered,
                remembered ? responseMs.current : null,
                false,
            );
            onSuccess();
        },
        [disabled, onAnswer, onSuccess],
    );

    const revealHint = useCallback(() => reveal(true), [reveal]);
    const onOtherKeyDown = useCallback(
        (event: KeyboardEvent) => {
            if (completed.current) return;

            const current = phaseRef.current;
            if (event.key === "Enter" && current !== "revealed") {
                event.preventDefault();
                if (current === "hidden") reveal(false);
                else finish(false);
            } else if (current === "revealed") {
                if (event.key === "ArrowLeft" || event.key === "1") {
                    event.preventDefault();
                    finish(false);
                } else if (event.key === "ArrowRight" || event.key === "2") {
                    event.preventDefault();
                    finish(true);
                }
            }
        },
        [reveal, finish],
    );

    useSelectionShortcuts({
        questionRef,
        disabled,
        allowHint: true,
        hintUsed: !hidden,
        revealHint,
        onOtherKeyDown,
    });

    return (
        <div
            ref={questionRef}
            className="flex w-full flex-col items-center gap-4"
        >
            <div
                data-question-slide-width
                className="leading-loose text-xl text-center w-fit border border-(--color-border) px-3 rounded-lg py-1 font-serif"
                data-cursor="text"
            >
                {item.prompt}
            </div>
            <div
                data-question-slide-width
                className="flex w-full max-w-md flex-col items-center gap-4"
            >
                {/* Constant mask width and answer viewport avoid revealing
                    answer length or moving the prompt when it is uncovered. */}
                <div className="card-answer relative grid w-full place-items-center">
                    <div
                        aria-live="polite"
                        className={`card-answer-text col-start-1 row-start-1 max-h-full max-w-full overflow-y-auto whitespace-pre-wrap wrap-break-word text-center font-serif text-xl leading-loose ${hidden ? "opacity-0" : "opacity-100"}`}
                        data-cursor={hidden ? undefined : "text"}
                    >
                        {hidden ? null : item.answer}
                    </div>
                    <button
                        type="button"
                        aria-label="解答を表示"
                        aria-hidden={!hidden}
                        tabIndex={hidden ? 0 : -1}
                        disabled={disabled || !hidden}
                        data-cursor={hidden ? "button" : undefined}
                        data-cursor-shape={
                            hidden ? (disabled ? "2" : "0") : undefined
                        }
                        onClick={() => reveal(false)}
                        className={`card-mask col-start-1 row-start-1 h-12 w-56 max-w-full rounded-lg bg-(--color-background-secondary) focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-600 ${hidden ? "cursor-pointer opacity-100" : "pointer-events-none opacity-0"}`}
                        style={{
                            backgroundImage:
                                "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--color-foreground) 13%, transparent) 5px 7px)",
                        }}
                    />
                </div>
                <div ref={nextButtonRef} className="min-h-12 w-full">
                    {phase === "hidden" ? (
                        <Button
                            className="w-full"
                            font="mono"
                            disabled={disabled}
                            onClick={() => reveal(true)}
                        >
                            分からない
                        </Button>
                    ) : phase === "unknown" ? (
                        <Button
                            className="w-full"
                            disabled={disabled}
                            iconName="arrowRight"
                            onClick={() => finish(false)}
                        >
                            次へ
                        </Button>
                    ) : (
                        <div className="w-full flex gap-4">
                            <Button
                                className="w-full"
                                aria-label="不正解"
                                iconName="x"
                                disabled={disabled}
                                onClick={() => finish(false)}
                            />
                            <Button
                                className="w-full"
                                aria-label="正解"
                                iconName="check"
                                disabled={disabled}
                                onClick={() => finish(true)}
                            />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
