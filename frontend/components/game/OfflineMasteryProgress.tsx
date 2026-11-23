"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { recognitionMemory, type AnswerModeResult, type ItemMemoryState, type MasteryProgress } from "@/lib/playground/memory";

const GRAPH_SAMPLES = 96;
const STABILITY_REFERENCE_DAYS = 180;
const REFRESH_INTERVAL_MS = 5_000;

/**
 * A bounded, single-background visualization: no DOM node per word.
 * Each position represents an equal share of the room's vocabulary, ranked
 * by the stability of the applicable (recall or recognition) memory track.
 */
function stabilityGradient(
    ids: readonly string[],
    memories: Readonly<Record<string, ItemMemoryState>>,
    defaultMode: AnswerModeResult,
    modes?: Readonly<Record<string, AnswerModeResult>>,
) {
    const sorted = [...new Set(ids)].map(id => {
        const memory = memories[id];
        if ((modes?.[id] ?? defaultMode) === "selection") {
            const track = memory?.answerModeStats?.recognition;
            const { anchor, stability } = recognitionMemory(track);
            return anchor !== null && Number.isFinite(stability) ? stability : 0;
        }
        const stability = memory?.stability;
        return memory?.lastReviewedAt && typeof stability === "number" && Number.isFinite(stability)
            ? Math.max(0, stability)
            : 0;
    }).sort((a, b) => b - a);

    if (!sorted.length) return "var(--color-background-secondary)";
    const samples = Math.min(GRAPH_SAMPLES, sorted.length);
    const stops: string[] = [];
    for (let i = 0; i < samples; i++) {
        const start = Math.floor(i * sorted.length / samples);
        const end = Math.max(start + 1, Math.floor((i + 1) * sorted.length / samples));
        let strength = 0;
        for (let j = start; j < end; j++) {
            const scaled = Math.log1p(sorted[j]) / Math.log1p(STABILITY_REFERENCE_DAYS);
            // Emphasize early progress without changing the stability ranking.
            strength += Math.sqrt(Math.min(1, Math.max(0, scaled)));
        }
        strength /= end - start;
        // Interpolate colors, not DOM boxes; each gradient stop is a percentile.
        const cyan = Math.round(strength * 1000) / 10;
        const color = `color-mix(in oklab, var(--color-background-secondary) ${100 - cyan}%, var(--color-cyan-600) ${cyan}%)`;
        const position = samples === 1 ? 0 : i / (samples - 1) * 100;
        stops.push(`${color} ${position}%`);
    }
    // A single sample should paint the whole bar.
    if (samples === 1) stops.push(`${stops[0].slice(0, -3)} 100%`);
    return `linear-gradient(to right, ${stops.join(", ")})`;
}

export default function OfflineMasteryProgress({
    progress, itemIds, memories, answerMode, modes,
}: Readonly<{
    progress: MasteryProgress;
    itemIds: readonly string[];
    memories: Readonly<Record<string, ItemMemoryState>>;
    answerMode: AnswerModeResult;
    modes?: Readonly<Record<string, AnswerModeResult>>;
}>) {
    const gradient = useMemo(
        () => stabilityGradient(itemIds, memories, answerMode, modes),
        [itemIds, memories, answerMode, modes],
    );
    const latestGradient = useRef(gradient);
    latestGradient.current = gradient;
    const [display, setDisplay] = useState(() => ({
        active: 0,
        gradients: [gradient, gradient],
    }));

    useEffect(() => {
        const timer = window.setInterval(() => {
            if (document.hidden) return;
            setDisplay(previous => {
                const current = previous.gradients[previous.active];
                if (current === latestGradient.current) return previous;
                const next = 1 - previous.active;
                const gradients = [...previous.gradients];
                gradients[next] = latestGradient.current;
                return { active: next, gradients };
            });
        }, REFRESH_INTERVAL_MS);
        return () => window.clearInterval(timer);
    }, []);

    const { total, masteredNow, masteredAfter3Hours, masteredAfter24Hours } = progress;
    return (
        <div
            className="relative flex w-full h-2.5 overflow-hidden rounded-full bg-(--color-background-secondary)"
            role="progressbar"
            aria-label="単語の記憶安定度の分布"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={total ? Math.round(masteredNow / total * 100) : 0}
            aria-valuetext={`${masteredNow} / ${total} 語を現在習得。3時間後も ${masteredAfter3Hours} 語、24時間後も ${masteredAfter24Hours} 語は維持する予測`}
        >
            {display.gradients.map((background, index) => (
                <div
                    key={index}
                    aria-hidden="true"
                    className="absolute inset-0 transition-opacity duration-700 ease-in-out motion-reduce:transition-none"
                    style={{
                        background,
                        opacity: display.active === index ? 1 : 0,
                    }}
                />
            ))}
        </div>
    );
}
