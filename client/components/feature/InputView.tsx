import { useEffect, useRef, useState } from "react";

export default function TypingView({
    japanese,
    english,
    onSuccess,
    onChangeInput,
    currentInput,
}: {
    japanese: string;
    english: string | null;
    onSuccess: () => void;
    onChangeInput: (input: string) => void;
    currentInput: string | null;
}) {
    const [missCount, setMissCount] = useState(0);
    const [input, setInput] = useState<string[]>(
        english ? Array(english.length).fill("") : [],
    );

    const [currentSelection, setCurrentSelection] = useState(0);

    const inputRef = useRef<HTMLInputElement | null>(null);

    const [charInput, setCharInput] = useState("");
    const [isFailAnimating, setIsFailAnimating] = useState(false);

    const isReadonly = currentInput !== null;

    useEffect(() => {
        if (!isReadonly) {
            inputRef.current?.focus();
        }
    }, [isReadonly]);

    const triggerFailAnimation = () => {
        setIsFailAnimating(false);

        requestAnimationFrame(() => {
            setIsFailAnimating(true);
        });

        setTimeout(() => {
            setIsFailAnimating(false);
        }, 400);
    };

    if (!english) return null;

    const moveToNext = (next: string[]) => {
        const nextIndex = currentSelection + 1;

        if (nextIndex < english.length) {
            if (nextIndex < missCount + 1) {
                const input = next.slice(0, nextIndex).join("");
                const target = english.slice(0, nextIndex);

                if (input !== target) {
                    setInput(Array(english.length).fill(""));
                    setCurrentSelection(0);
                    triggerFailAnimation();
                    onChangeInput("");
                } else {
                    setCurrentSelection(nextIndex);
                    onChangeInput(next.join(""));
                }
            } else {
                setCurrentSelection(nextIndex);
                onChangeInput(next.join(""));
            }
        } else {
            const result = next.join("");

            if (result === english) {
                onSuccess();

                const next = Array(english.length).fill("");
                setInput(next);
                setCurrentSelection(0);

                setMissCount(0);
                onChangeInput(next.join(""));

                const audio = new Audio("/Blip_select_36.wav");
                audio.volume = 1;
                audio.play();
            } else {
                console.log("Wrong answer. Query:", result);

                setInput(Array(english.length).fill(""));
                setCurrentSelection(0);
                triggerFailAnimation();
                onChangeInput("");
                setMissCount(missCount + 3);
            }
        }
    };

    const displayChars = isReadonly ? [...currentInput] : input;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center">
                <div
                    className="font-bold text-center w-fit border border-(--color-border) px-2 rounded-lg py-1"
                    data-cursor="text"
                >
                    {japanese}
                </div>
            </div>

            <div className="w-full flex justify-center">
                <div
                    className={`w-fit relative rounded-lg border border-(--color-border) p-1 overflow-clip gap-y-3 flex-wrap flex justify-start ${
                        isFailAnimating
                            ? "animate-[wrongAnswer_400ms_ease-out]"
                            : ""
                    }`}
                    onClick={() => {
                        if (!isReadonly) {
                            inputRef.current?.focus();
                        }
                    }}
                >
                    <div className="absolute top-1 left-1 pointer-events-none">
                        {[...english].slice(0, missCount).map((char, index) => {
                            if (char == " ") {
                                return (
                                    <button
                                        key={index}
                                        className={`font-bold w-4 h-12 active:scale-95 rounded-sm text-2xl transition-all p-1 duration-150 ease-out`}
                                    >
                                        <div className="flex items-center justify-center h-full w-full" />
                                    </button>
                                );
                            } else {
                                return (
                                    <button
                                        key={index}
                                        className={`font-bold opacity-25 w-6 h-12 rounded-sm text-2xl transition-all p-1 duration-150 ease-out $${currentInput == null && "active:scale-95"}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setCurrentSelection(index);
                                            inputRef.current?.focus();
                                        }}
                                    >
                                        <div className="border-b border-(--color-border) flex items-center justify-center h-full w-full">
                                            {char}
                                        </div>
                                    </button>
                                );
                            }
                        })}
                    </div>

                    {[...english].map((char, index) => {
                        const isSelected =
                            !isReadonly && index === currentSelection;

                        if (char == " ") {
                            return (
                                <button
                                    key={index}
                                    className={`font-bold w-4 h-12 active:scale-95 rounded-sm text-2xl transition-all p-1 duration-150 ease-out ${isSelected ? "bg-(--color-border)" : ""}`}
                                >
                                    <div className="flex items-center justify-center h-full w-full" />
                                </button>
                            );
                        } else {
                            return (
                                <button
                                    key={index}
                                    className={`font-bold w-6 h-12 rounded-sm text-2xl transition-all p-1 duration-150 ease-out ${isSelected ? "bg-(--color-border)" : ""} ${currentInput == null && "active:scale-95"}`}
                                    data-cursor="button"
                                    data-cursor-shape={
                                        currentInput == null ? "1" : "2"
                                    }
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setCurrentSelection(index);
                                        inputRef.current?.focus();
                                    }}
                                >
                                    <div className="border-b border-(--color-border) flex items-center justify-center h-full w-full">
                                        {displayChars?.[index] ?? ""}
                                    </div>
                                </button>
                            );
                        }
                    })}

                    {!isReadonly && (
                        <input
                            ref={inputRef}
                            value={charInput}
                            onChange={(e) => {
                                const value = e.target.value;

                                if (!value) return;

                                const char = value.slice(-1);

                                const targetChar = english[currentSelection];

                                if (targetChar === " ") {
                                    if (char === " ") {
                                        const next = [...input];
                                        next[currentSelection] = " ";
                                        setInput(next);
                                        moveToNext(next);
                                    }
                                    setCharInput("");
                                    return;
                                }

                                if (char !== " ") {
                                    const next = [...input];
                                    next[currentSelection] = char;

                                    setInput(next);
                                    moveToNext(next);
                                }
                                setCharInput("");
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "ArrowLeft") {
                                    e.preventDefault();
                                    setCurrentSelection(
                                        Math.max(0, currentSelection - 1),
                                    );
                                }

                                if (e.key === "ArrowRight") {
                                    e.preventDefault();
                                    setCurrentSelection(
                                        Math.min(
                                            english.length - 1,
                                            currentSelection + 1,
                                        ),
                                    );
                                }

                                if (e.key === "Backspace") {
                                    e.preventDefault();

                                    const next = [...input];

                                    if (next[currentSelection]) {
                                        next[currentSelection] = "";

                                        setInput(next);
                                        return;
                                    }

                                    const prev = currentSelection - 1;

                                    if (prev >= 0) {
                                        next[prev] = "";

                                        setInput(next);
                                        setCurrentSelection(prev);
                                    }
                                    onChangeInput(next.join(""));
                                }
                            }}
                            onFocus={() => {
                                setTimeout(() => {
                                    inputRef.current?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "center",
                                    });
                                }, 300);
                            }}
                            className="absolute inset-0 w-full h-full opacity-[0.01] z-10"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                            inputMode="text"
                            enterKeyHint="next"
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
