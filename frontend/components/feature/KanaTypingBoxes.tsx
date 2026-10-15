"use client";

import { isHiragana, romanSlotCount } from "@/lib/romaji-input.mjs";

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
 * Same h-16/border-bottom styling as the existing English input.
 * A stable wrapper animates each kana cell's actual width:
 * w-10 (40px) -> two w-8 cells (64px) -> three w-8 cells (96px).
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
    return (
        <>
            {Array.from(answer).map((char, index) => {
                const isActive = !readonly && index === activeIndex;
                const composingHere = isHiragana(char) &&
                    index === filled.length && composing.length > 0;
                const slots = composingHere ? romanSlotCount(composing) : 1;
                const width = composingHere
                    ? slots * 32
                    : char === " " ? 16 : isHiragana(char) ? 40 : 32;

                return (
                    <div
                        key={index}
                        className="relative z-20 h-16 shrink-0 overflow-hidden transition-[width] duration-200 ease-etb motion-reduce:transition-none"
                        style={{ width }}
                        onClick={onSelect}
                    >
                        {composingHere ? (
                            <div className="flex h-16 w-max">
                                {Array.from({ length: slots }, (_, slot) => (
                                    <div
                                        key={slot}
                                        className={`h-16 w-8 shrink-0 rounded-sm p-1 font-mono text-3xl font-bold transition-colors duration-150 ease-etb ${isActive && slot === composing.length ? "bg-(--color-border)" : ""}`}
                                    >
                                        <div className="flex h-full w-full items-center justify-center border-b border-(--color-border)">
                                            {composing[slot] ?? ""}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div
                                className={`relative h-16 rounded-sm p-1 font-bold transition-colors duration-150 ease-etb ${char === " " ? "w-4 text-2xl" : isHiragana(char) ? "w-10 text-3xl" : "w-8 font-mono text-3xl"} ${isActive ? "bg-(--color-border)" : ""}`}
                            >
                                {index < hintLength && (
                                    <div className="pointer-events-none absolute inset-1 flex items-center justify-center border-b border-(--color-border) opacity-25">
                                        {char}
                                    </div>
                                )}
                                <div className="relative flex h-full w-full items-center justify-center border-b border-(--color-border)">
                                    {filled[index] ?? ""}
                                </div>
                            </div>
                        )}
                    </div>
                );
            })}
        </>
    );
}
