"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Item } from "@/type";
import Button from "@/components/ui/Button";
import { isGameSpaceKeyDown } from "@/lib/selection-shortcut";
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
    const clock = useRef(createActiveResponseClock());
    const responseMs = useRef<number | null>(null);
    const disabled = currentInput !== null || isPaused;
    const hidden = phase === "hidden";

    useEffect(() => {
        const syncClock = () => setResponseClockActive(
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

    const reveal = useCallback((unknown: boolean) => {
        if (disabled || completed.current || phaseRef.current !== "hidden") return;
        const now = performance.now();
        responseMs.current = readActiveResponseMs(clock.current, now);
        setResponseClockActive(clock.current, false, now);
        const next = unknown ? "unknown" : "revealed";
        phaseRef.current = next;
        setPhase(next);
    }, [disabled]);

    const finish = useCallback((remembered: boolean) => {
        if (disabled || completed.current || phaseRef.current === "hidden") return;
        if (remembered && phaseRef.current !== "revealed") return;
        completed.current = true;
        // The selection callback expects one completed question. An incorrect
        // self-rating and an unknown answer both use the ordinary missed-
        // selection path, never the additional unknown/hint penalty.
        onAnswer(true, !remembered, remembered ? responseMs.current : null, false);
        onSuccess();
    }, [disabled, onAnswer, onSuccess]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (disabled || completed.current || event.defaultPrevented ||
                event.repeat || event.isComposing || event.altKey ||
                event.ctrlKey || event.metaKey || event.shiftKey) return;
            const target = event.target;
            if (target instanceof HTMLElement &&
                (target.isContentEditable || target.closest("input, textarea, select"))) return;
            const interactive = target instanceof Element &&
                target.closest("button, a, summary, [role='button'], [role='link']");
            if (interactive && !questionRef.current?.contains(interactive)) return;
            // Focused buttons retain their standard Space/Enter activation.
            // When focus is on the page, Space reveals or advances an unknown.
            if (isGameSpaceKeyDown(event) && !interactive) {
                if (phaseRef.current === "hidden") {
                    event.preventDefault();
                    reveal(false);
                } else if (phaseRef.current === "unknown") {
                    event.preventDefault();
                    finish(false);
                }
            } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                if (phaseRef.current === "hidden") reveal(true);
                else if (phaseRef.current === "revealed") finish(false);
            } else if (event.key === "ArrowRight" && phaseRef.current === "revealed") {
                event.preventDefault();
                finish(true);
            }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [disabled, reveal, finish]);

    return (
        <div ref={questionRef} className="flex w-full flex-col items-center gap-4">
            <div
                data-question-slide-width
                data-cursor="text"
                className="max-w-full w-fit wrap-break-word whitespace-pre-wrap text-center font-serif text-xl leading-loose"
            >
                {item.prompt}
            </div>
            <div
                data-question-slide-width
                className="flex w-full max-w-lg flex-col items-center gap-4"
            >
                {/* Constant mask width and answer viewport avoid revealing
                    answer length or moving the prompt when it is uncovered. */}
                <div className="relative grid h-32 w-full place-items-center">
                    <div
                        aria-live="polite"
                        className={`col-start-1 row-start-1 max-h-full max-w-full overflow-y-auto whitespace-pre-wrap wrap-break-word text-center font-serif text-xl leading-loose transition-opacity duration-(--duration-etb) motion-reduce:transition-none ${hidden ? "opacity-0" : "opacity-100"}`}
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
                        data-cursor-shape={hidden ? (disabled ? "2" : "0") : undefined}
                        onClick={() => reveal(false)}
                        className={`col-start-1 row-start-1 h-12 w-56 max-w-full rounded-lg bg-(--color-background-secondary) transition-opacity duration-(--duration-etb) motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-600 ${hidden ? "cursor-pointer opacity-100" : "pointer-events-none opacity-0"}`}
                        style={{
                            backgroundImage: "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--color-foreground) 13%, transparent) 5px 7px)",
                        }}
                    />
                </div>
                <div className="min-h-12 w-full">
                    {phase === "hidden" ? (
                        <Button className="w-full" font="mono" disabled={disabled} onClick={() => reveal(true)}>
                            分からない
                        </Button>
                    ) : phase === "unknown" ? (
                        <Button className="w-full" disabled={disabled} onClick={() => finish(false)}>
                            次へ
                        </Button>
                    ) : (
                        <div className="grid w-full grid-cols-2 gap-2">
                            <Button className="w-full" aria-label="不正解" iconName="x" disabled={disabled} onClick={() => finish(false)} />
                            <Button className="w-full" aria-label="正解" iconName="check" disabled={disabled} onClick={() => finish(true)} />
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
