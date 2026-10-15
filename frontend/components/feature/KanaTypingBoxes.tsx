"use client";

import {
    isHiragana,
    kanaCompositionLayout,
} from "@/lib/romaji-input.mjs";

type Props = {
    answer: string;
    confirmed: string;
    composing: string;
    activeIndex: number;
    hintLength?: number;
    readonly?: boolean;
    onSelect?: () => void;
};

/**
 * Reuses the English h-16 / w-8 / font-mono key styling, while idle kana are
 * w-10 in the app font. The stable outer wrapper animates width changes.
 */
export default function KanaTypingBoxes({
    answer,
    confirmed,
    composing,
    activeIndex,
    hintLength = 0,
    readonly = false,
    onSelect,
}: Readonly<Props>) {
    const filled = Array.from(confirmed);
    const compositionStart = filled.length;
    const layout = kanaCompositionLayout(
        answer,
        compositionStart,
        composing,
        hintLength,
    );

    return (
        <>
            {Array.from(answer).map((char, index) => {
                const isActive = !readonly && index === activeIndex;
                const composingHere = isHiragana(char) &&
                    index === compositionStart && composing.length > 0;
                // Once "ty"/"ch" identifies ちゃ, the small ゃ is already
                // represented by the same roman-key group and must disappear.
                const occupiedByPrevious =
                    composing.length > 0 &&
                    index > compositionStart &&
                    index < compositionStart + layout.occupies;
                const width = occupiedByPrevious
                    ? 0
                    : composingHere
                      ? layout.slots * 32
                      : char === " " ? 16 : isHiragana(char) ? 40 : 32;

                return (
                    <div
                        key={index}
                        aria-hidden={occupiedByPrevious}
                        className={`relative z-20 h-16 shrink-0 overflow-hidden transition-[width] duration-200 ease-etb motion-reduce:transition-none ${occupiedByPrevious ? "pointer-events-none" : ""}`}
                        style={{ width }}
                    >
                        {composingHere ? (
                            <div className="flex h-16 w-max">
                                {Array.from({ length: layout.slots }, (_, slot) => (
                                    <button
                                        key={slot}
                                        type="button"
                                        data-cursor="button"
                                        data-cursor-shape={readonly ? "2" : "1"}
                                        onClick={onSelect}
                                        tabIndex={-1}
                                        className={`relative h-16 w-8 shrink-0 cursor-text rounded-sm p-1 font-mono text-3xl font-bold transition-colors duration-150 ease-etb ${isActive && slot === composing.length ? "bg-(--color-border)" : ""}`}
                                        aria-label={`ローマ字 ${slot + 1}`}
                                    >
                                        {layout.hintRoman[slot] && !composing[slot] && (
                                            <div className="pointer-events-none absolute inset-1 flex items-center justify-center border-b border-(--color-border) opacity-25">
                                                {layout.hintRoman[slot]}
                                            </div>
                                        )}
                                        <div className="relative flex h-full w-full items-center justify-center border-b border-(--color-border)">
                                            {composing[slot] ?? ""}
                                        </div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <button
                                type="button"
                                tabIndex={-1}
                                data-cursor="button"
                                data-cursor-shape={readonly ? "2" : "1"}
                                onClick={onSelect}
                                className={`relative h-16 cursor-text rounded-sm p-1 font-bold transition-colors duration-150 ease-etb ${char === " " ? "w-4 text-2xl" : isHiragana(char) ? "w-10 text-3xl" : "w-8 font-mono text-3xl"} ${isActive ? "bg-(--color-border)" : ""}`}
                                aria-label={`文字 ${index + 1}`}
                            >
                                {index < hintLength && (
                                    <div className="pointer-events-none absolute inset-1 flex items-center justify-center border-b border-(--color-border) opacity-25">
                                        {char}
                                    </div>
                                )}
                                <div className="relative flex h-full w-full items-center justify-center border-b border-(--color-border)">
                                    {filled[index] ?? ""}
                                </div>
                            </button>
                        )}
                    </div>
                );
            })}
        </>
    );
}
