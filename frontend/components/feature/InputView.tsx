import {
    correctPrefixLength,
    getInitialCueLength,
    hintCoversError,
} from "@/lib/playground/recall-input";
import { useEffect, useRef, useState } from "react";
import KanaTypingBoxes from "@/components/feature/KanaTypingBoxes";
import {
    decodeKanaProgress,
    editKanaCell,
    hasHiragana,
    nextKanaCursor,
} from "@/lib/romaji-input.mjs";
import { io } from "@/lib/room/socket";
import { getAuthToken } from "@/lib/room/auth";
import type {
    LearningMode,
    RecallObservation,
    RecallProgress,
} from "@/lib/playground/memory";

const DEFAULT_CUE_STEPS = [0.2, 0.4, 0.7, 1];
const DEFAULT_HINT_DELAYS_MS = [1_000, 1_500, 2_000, 2_500];

const isSoundEffectsEnabled = () => {
    if (typeof document === "undefined") return true;

    return document.cookie
        .split(";")
        .some(
            (cookie) =>
                cookie.trim() === "sound-effects=true" ||
                cookie.trim() === "sound-effects",
        );
};

function TypingAttempt({
    japanese,
    english,
    onSuccess,
    onChangeInput,
    failureCount = 0,
    currentInput,
    bombStatus,
    hasDuplicateMeaning = false,
    enableRemoteTypingSync = true,
    learningMode,
    initialCueRatio = 0,
    cueSteps = DEFAULT_CUE_STEPS,
    hintDelaysMs = DEFAULT_HINT_DELAYS_MS,
    onRecallProgress,
    onRecallComplete,
    remoteHintLength,
    onHintChange,
}: {
    japanese: string;
    english: string | null;
    onSuccess: () => void;
    onChangeInput: (input: string, failed?: boolean) => void;
    currentInput: string | null;
    failureCount?: number;
    bombStatus?: number | null;
    hasDuplicateMeaning?: boolean;
    enableRemoteTypingSync?: boolean;
    learningMode?: LearningMode;
    initialCueRatio?: number;
    cueSteps?: number[];
    hintDelaysMs?: number[] | null;
    onRecallProgress?: (progress: RecallProgress) => void;
    onRecallComplete?: (observation: RecallObservation) => void;
    remoteHintLength?: number;
    onHintChange?: (length: number) => void;
}) {
    // Adaptive practice must offer a genuinely unaided attempt.
    const baseHintCount = hasDuplicateMeaning && !learningMode ? 1 : 0;
    const initialCueLength = english
        ? getInitialCueLength(english.length, initialCueRatio, baseHintCount)
        : baseHintCount;
    const [timedHintCount, setTimedHintCount] = useState(0);
    const [revealedHintLength, setRevealedHintLength] =
        useState(initialCueLength);
    const [input, setInput] = useState<string[]>(
        english ? Array(english.length).fill("") : [],
    );
    const [kanaComposing, setKanaComposing] = useState("");
    const kanaCommitSpansRef = useRef<number[]>([]);
    const isKanaAnswer = Boolean(english && hasHiragana(english));
    const inputStateRef = useRef(input);
    const revealedHintLengthRef = useRef(initialCueLength);
    const onChangeInputRef = useRef(onChangeInput);
    const onHintChangeRef = useRef(onHintChange);
    const [currentSelection, setCurrentSelection] = useState(0);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const inputFrameRef = useRef<HTMLDivElement | null>(null);
    const [charInput, setCharInput] = useState("");
    const [isFailAnimating, setIsFailAnimating] = useState(false);
    const [syncedInput, setSyncedInput] = useState("");
    const wordKey = JSON.stringify([japanese, english]);
    const recallStartedAtRef = useRef(0);
    const firstKeyAtRef = useRef<number | null>(null);
    const attemptCountRef = useRef(1);
    const incorrectInputCountRef = useRef(0);
    const maxCorrectPrefixRef = useRef(0);
    const lastCorrectProgressAtRef = useRef(0);
    const lastHintAtRef = useRef(0);
    const cueStepsKey = cueSteps.join(",");
    const hintDelaysKey = hintDelaysMs?.join(",") ?? "disabled";

    const isReadonly = currentInput !== null;
    const manualHints = Boolean(learningMode) && !isReadonly;
    // Duplicate prompts may start with a visible cue before any timed hint.
    // Publish that initial cue too, so read-only spectators see the same letters.
    useEffect(() => {
        if (!isReadonly && english && initialCueLength > 0)
            onHintChangeRef.current?.(initialCueLength);
    }, [isReadonly, english, initialCueLength, wordKey]);

    const [answerRevealed, setAnswerRevealed] = useState(false);
    const lastKeyWasSpaceRef = useRef(false);
    const hintEventsRef = useRef<NonNullable<RecallProgress["hintEvents"]>>([]);
    const completedRef = useRef(false);

    useEffect(() => {
        inputStateRef.current = input;
        onChangeInputRef.current = onChangeInput;
        onHintChangeRef.current = onHintChange;
    }, [input, onChangeInput, onHintChange]);

    useEffect(() => {
        if (isReadonly || !english) return;

        recallStartedAtRef.current = performance.now();
        firstKeyAtRef.current = null;
        attemptCountRef.current = 1;
        incorrectInputCountRef.current = 0;
        maxCorrectPrefixRef.current = 0;
    }, [english, isReadonly, wordKey]);

    useEffect(() => {
        if (isReadonly || !english) return;
        revealedHintLengthRef.current = initialCueLength;
        lastCorrectProgressAtRef.current = performance.now();
        lastHintAtRef.current = 0;

        const activeHintDelays = hintDelaysMs;
        if (
            manualHints ||
            activeHintDelays === null ||
            activeHintDelays.length === 0 ||
            initialCueRatio >= 1
        )
            return;

        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let hintIndex = 0;

        const getHintDelay = () =>
            Math.max(
                250,
                activeHintDelays[
                    Math.min(hintIndex, activeHintDelays.length - 1)
                ] ?? 250,
            );

        const schedule = () => {
            if (cancelled) return;

            const now = performance.now();
            const anchorAt = Math.max(
                lastCorrectProgressAtRef.current,
                lastHintAtRef.current,
            );
            const waitMs = Math.max(25, anchorAt + getHintDelay() - now);

            timer = setTimeout(() => {
                if (cancelled) return;

                const firedAt = performance.now();
                const latestAnchorAt = Math.max(
                    lastCorrectProgressAtRef.current,
                    lastHintAtRef.current,
                );

                // Correct user progress may have happened while this timer was waiting.
                if (firedAt - latestAnchorAt < getHintDelay()) {
                    schedule();
                    return;
                }

                const currentLength = revealedHintLengthRef.current;
                if (currentLength >= english.length) return;

                const prefixLength = correctPrefixLength(
                    inputStateRef.current,
                    english,
                );
                const nextRatio =
                    cueSteps.find(
                        (ratio) =>
                            ratio >
                            Math.max(currentLength, prefixLength) /
                                english.length,
                    ) ?? 1;
                const nextLength = Math.min(
                    english.length,
                    Math.max(
                        currentLength,
                        Math.ceil(english.length * nextRatio),
                        prefixLength,
                    ),
                );

                if (nextLength <= currentLength) return;

                revealedHintLengthRef.current = nextLength;
                setRevealedHintLength(nextLength);
                onHintChangeRef.current?.(nextLength);
                setTimedHintCount((count) => count + 1);
                lastHintAtRef.current = firedAt;
                hintIndex += 1;

                if (
                    hintCoversError(inputStateRef.current, english, nextLength)
                ) {
                    attemptCountRef.current += 1;
                    inputStateRef.current = Array(english.length).fill("");
                    setInput(inputStateRef.current);
                    setKanaComposing("");
                    kanaCommitSpansRef.current = [];
                    setCurrentSelection(0);
                    setCharInput("");
                    setIsFailAnimating(true);
                    onChangeInputRef.current("");
                }

                if (nextLength < english.length) schedule();
            }, waitMs);
        };

        schedule();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [
        manualHints,
        cueSteps,
        cueStepsKey,
        english,
        hintDelaysKey,
        hintDelaysMs,
        initialCueLength,
        initialCueRatio,
        isReadonly,
        wordKey,
    ]);
    useEffect(() => {
        if (!isReadonly) {
            inputRef.current?.focus();
            return;
        }

        if (!enableRemoteTypingSync) return;

        let socket: ReturnType<typeof io> | null = null;
        let cancelled = false;

        const connect = async () => {
            const authToken = await getAuthToken();
            if (!authToken || cancelled) return;

            socket = io(
                typeof window === "undefined"
                    ? undefined
                    : process.env.NEXT_PUBLIC_RENDER_URL,
            );

            socket.on("auth:request", () => {
                socket?.emit("auth:response", {
                    jwtToken: authToken,
                    displayName: "",
                });
            });

            socket.on("typing:input", ({ input }: { input: string }) => {
                setSyncedInput(input);
            });
        };

        connect();

        return () => {
            cancelled = true;
            socket?.disconnect();
            socket = null;
        };
    }, [enableRemoteTypingSync, isReadonly]);

    // Explicit failures avoid confusing Backspace corrections with wrong answers.
    const previousFailureCountRef = useRef(failureCount);
    useEffect(() => {
        if (!isReadonly || previousFailureCountRef.current === failureCount) return;
        previousFailureCountRef.current = failureCount;
        inputFrameRef.current?.getAnimations().forEach((animation) => {
            animation.currentTime = 0;
        });
        setIsFailAnimating(true);
    }, [failureCount, isReadonly]);

    const triggerFailAnimation = () => {
        // Restart an in-flight shake without an older timer stopping it early.
        inputFrameRef.current?.getAnimations().forEach((animation) => {
            animation.currentTime = 0;
        });
        setIsFailAnimating(true);
    };

    const resetInput = () => {
        if (!english) return;
        if (kanaComposing || input.some((character) => character !== "")) {
            attemptCountRef.current += 1;
        }
        setInput(Array(english.length).fill(""));
        setKanaComposing("");
        kanaCommitSpansRef.current = [];
        setCurrentSelection(0);
        setCharInput("");
        triggerFailAnimation();
        onChangeInput("", true);
    };

    const hintCount = manualHints
        ? Number(answerRevealed)
        : baseHintCount + timedHintCount;
    const localHintLength = manualHints
        ? answerRevealed
            ? (english?.length ?? 0)
            : 0
        : revealedHintLength;

    const hintLength = isReadonly && remoteHintLength !== undefined
        ? Math.max(0, Math.min(english?.length ?? 0, remoteHintLength))
        : localHintLength;

    const requestHint = () => {
        if (!manualHints || !english || answerRevealed || completedRef.current)
            return;
        hintEventsRef.current.push({
            kind: "answer",
            source: "manual",
            atMs: Math.max(0, performance.now() - recallStartedAtRef.current),
            position: null,
            correctBefore: input.filter(
                (char, i) => char === english[i] && english[i] !== " ",
            ).length,
        });
        lastKeyWasSpaceRef.current = false;
        setAnswerRevealed(true);
        onHintChange?.(english.length);

        // A correctly committed kana prefix stays on screen when hints are
        // revealed, even if the user is still composing its roman letters.
        const hasIncorrectInput = isKanaAnswer
            ? !english.startsWith(input.join(""))
            : input.some(
                  (char, index) => char !== "" && char !== english[index],
              );
        if (hasIncorrectInput) {
            resetInput();
        }
    };

    useEffect(() => {
        if (isReadonly || !english) return;

        onRecallProgress?.({
            attemptCount: attemptCountRef.current,
            incorrectInputCount: incorrectInputCountRef.current,
            hintCount,
            revealedHintChars: hintLength,
            assistedPositions: manualHints ? [] : undefined,
            hintEvents: manualHints ? [...hintEventsRef.current] : undefined,
            answerWasFullyRevealed: manualHints
                ? answerRevealed
                : hintLength >= english.length,
            maxCorrectPrefixLength: maxCorrectPrefixRef.current,
            recallLatencyMs:
                firstKeyAtRef.current === null
                    ? null
                    : Math.max(
                          0,
                          firstKeyAtRef.current - recallStartedAtRef.current,
                      ),
            elapsedMs: Math.max(
                0,
                performance.now() - recallStartedAtRef.current,
            ),
        });
    }, [
        english,
        hintCount,
        hintLength,
        input,
        isReadonly,
        onRecallProgress,
        manualHints,
        answerRevealed,
    ]);

    if (!english) return null;

    const moveToNext = (next: string[], advance = 1, pendingRoman = "") => {
        if (completedRef.current) return;
        // Kana combinations such as ちゃ may confirm two cells at once.
        for (let offset = 0; offset < advance; offset++) {
            if (next[currentSelection + offset] !== english[currentSelection + offset])
                incorrectInputCountRef.current += 1;
        }
        const nextIndex = currentSelection + advance;
        const nextCorrectPrefixLength = correctPrefixLength(next, english);
        if (nextCorrectPrefixLength > maxCorrectPrefixRef.current) {
            maxCorrectPrefixRef.current = nextCorrectPrefixLength;
            lastCorrectProgressAtRef.current = performance.now();
        }
        const typedInsideHint = Array.from({ length: advance }, (_, offset) => currentSelection + offset)
            .some((index) => index < hintLength && next[index] !== english[index]);

        if (typedInsideHint && (!manualHints || answerRevealed)) {
            resetInput();
            return;
        }

        // Kana cells may be edited out of order. A wrong answer is only
        // evaluated after all cells are filled, not at the first mistake
        // or merely because the cursor reached the last position.
        const needsMoreInput = isKanaAnswer
            ? next.some((character) => character === "")
            : nextIndex < english.length &&
              !(manualHints && next.join("") === english);
        if (needsMoreInput) {
            setCurrentSelection(Math.min(english.length - 1, nextIndex));
            onChangeInput(next.join("") + pendingRoman);
        } else {
            const result = next.join("");
            if (result === english) {
                completedRef.current = true;
                const finalCueRatio = hintLength / Math.max(1, english.length);
                const outcome =
                    learningMode === "encoding"
                        ? "encoding"
                        : finalCueRatio >= 1
                          ? "relearned"
                          : finalCueRatio === 0
                            ? "free_recall"
                            : "cued_recall";
                const observation: RecallObservation = {
                    success: true,
                    answerLength: english.length,
                    outcome,
                    finalCueRatio,
                    initialCueRatio,
                    additionalHintCount: manualHints
                        ? hintCount
                        : timedHintCount,
                    answerWasFullyRevealed: manualHints
                        ? answerRevealed
                        : hintLength >= english.length,
                    assistedPositions: manualHints ? [] : undefined,
                    hintEvents: manualHints
                        ? [...hintEventsRef.current]
                        : undefined,
                    firstAttemptCorrect:
                        attemptCountRef.current === 1 &&
                        incorrectInputCountRef.current === 0 &&
                        hintLength === 0,
                    attemptCount: attemptCountRef.current,
                    incorrectInputCount: incorrectInputCountRef.current,
                    hintCount,
                    revealedHintChars: hintLength,
                    maxCorrectPrefixLength: maxCorrectPrefixRef.current,
                    recallLatencyMs:
                        firstKeyAtRef.current === null
                            ? null
                            : Math.max(
                                  0,
                                  firstKeyAtRef.current -
                                      recallStartedAtRef.current,
                              ),
                    elapsedMs: Math.max(
                        0,
                        performance.now() - recallStartedAtRef.current,
                    ),
                };
                onRecallComplete?.(observation);
                onSuccess();
                const next = Array(english.length).fill("");
                setInput(next);
                setKanaComposing("");
                kanaCommitSpansRef.current = [];
                setCurrentSelection(0);
                console.log("bombStatus", bombStatus);
                setTimedHintCount(0);
                setRevealedHintLength(initialCueLength);
                onChangeInput(next.join(""));

                if (isSoundEffectsEnabled()) {
                    const audio = new Audio("/Blip_select_36.wav");
                    audio.volume = 1;
                    audio.play().catch(() => {
                        console.log(
                            "Audio playback prevented by browser policy.",
                        );
                    });
                }
            } else {
                console.log("Wrong answer. Query:", result);
                if (manualHints) {
                    attemptCountRef.current += 1;
                    setCurrentSelection(
                        next.findIndex((char, i) => char !== english[i]),
                    );
                    onChangeInput(next.join(""));
                    setInput([]);
                    setCurrentSelection(0);
                    triggerFailAnimation();
                    onChangeInput("", true);
                } else resetInput();
            }
        }
    };

    const displayInput = isReadonly
        ? enableRemoteTypingSync && currentInput === ""
            ? syncedInput
            : currentInput
        : input.join("");
    const displayChars = isReadonly ? [...displayInput] : input;
    const remoteKanaProgress = isKanaAnswer && isReadonly
        ? decodeKanaProgress(english, displayInput)
        : null;
    const confirmedKana = remoteKanaProgress?.committed ?? input.join("");
    const composingKana = remoteKanaProgress?.composing ?? kanaComposing;

    const selectKanaIndex = (index: number) => {
        if (isReadonly || index < 0 || index >= english.length) return;
        if (index !== currentSelection) {
            setCurrentSelection(index);
            // The roman prefix belongs to its original cell. Changing the
            // selected cell cancels only that unfinished prefix, not any
            // previously confirmed answer cells.
            if (kanaComposing) {
                setKanaComposing("");
                onChangeInput(input.join(""));
            }
        }
        inputRef.current?.focus();
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col items-center">
                <div
                    className="font-bold text-xl text-center w-fit border border-(--color-border) px-2 rounded-lg py-1"
                    data-cursor="text"
                >
                    {japanese}
                </div>
            </div>
            <div className="w-full flex justify-center">
                <div
                    ref={inputFrameRef}
                    className={`w-fit relative rounded-lg border border-(--color-border) p-1 overflow-clip gap-y-3 flex-wrap flex justify-start ${isFailAnimating ? "wrong-answer" : ""}`}
                    onAnimationEnd={(event) => {
                        if (event.target === event.currentTarget)
                            setIsFailAnimating(false);
                    }}
                    onClick={() => {
                        if (!isReadonly) inputRef.current?.focus();
                    }}
                    onKeyDown={(e) => {
                        if (isKanaAnswer) {
                            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                                e.preventDefault();
                                const direction = e.key === "ArrowLeft" ? -1 : 1;
                                selectKanaIndex(
                                    nextKanaCursor(currentSelection, direction, english.length),
                                );
                                return;
                            }
                            if (e.key === "Backspace") {
                                e.preventDefault();
                                if (kanaComposing) {
                                    const pending = kanaComposing.slice(0, -1);
                                    setKanaComposing(pending);
                                    onChangeInput(input.join("") + pending);
                                } else {
                                    const target = input[currentSelection] !== ""
                                        ? currentSelection
                                        : Math.max(0, currentSelection - 1);
                                    const next = [...input];
                                    next[target] = "";
                                    setInput(next);
                                    setCurrentSelection(target);
                                    onChangeInput(next.join(""));
                                }
                                return;
                            }
                        }
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
                                onChangeInput(next.join(""));
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
                >
                    {isKanaAnswer ? (
                        <KanaTypingBoxes
                            answer={english}
                            confirmed={confirmedKana}
                            cells={isReadonly ? undefined : input}
                            composing={composingKana}
                            activeIndex={currentSelection}
                            hintLength={hintLength}
                            readonly={isReadonly}
                            onSelect={selectKanaIndex}
                        />
                    ) : [...english].map((char, index) => {
                        const isSelected =
                            !isReadonly && index === currentSelection;
                        if (char === " ")
                            return (
                                <button
                                    key={index}
                                    className={`relative cursor-text z-20 font-bold w-4 h-16 active:scale-95 rounded-sm text-2xl transition-all p-1 duration-150 ease-etb ${isSelected ? "bg-(--color-border)" : ""}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (currentInput === null)
                                            setCurrentSelection(index);
                                        inputRef.current?.focus();
                                    }}
                                >
                                    <div className="flex items-center justify-center h-full w-full" />
                                </button>
                            );
                        return (
                            <button
                                key={index}
                                className={`relative cursor-text z-20 font-bold font-mono w-8 h-16 rounded-sm text-3xl transition-all p-1 duration-150 ease-etb ${isSelected ? "bg-(--color-border)" : ""} ${currentInput == null ? "active:scale-95" : ""}`}
                                data-cursor="button"
                                data-cursor-shape={
                                    currentInput === null ? "1" : "2"
                                }
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (currentInput === null)
                                        setCurrentSelection(index);
                                    inputRef.current?.focus();
                                }}
                            >
                                {(manualHints
                                    ? answerRevealed
                                    : index < hintLength) && (
                                    <div className="absolute inset-1 pointer-events-none opacity-25 border-b border-(--color-border) flex items-center justify-center">
                                        {char}
                                    </div>
                                )}
                                <div className="relative border-b border-(--color-border) flex items-center justify-center h-full w-full">
                                    {displayChars?.[index] ?? ""}
                                </div>
                            </button>
                        );
                    })}
                    {!isReadonly && (
                        <input
                            ref={inputRef}
                            value={charInput}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (!value) return;
                                const char = value.slice(-1);
                                if (manualHints) {
                                    if (char === " ") {
                                        if (lastKeyWasSpaceRef.current) {
                                            setCharInput("");
                                            requestHint();
                                            return;
                                        }
                                        lastKeyWasSpaceRef.current = true;
                                        // In kana mode, the first Space of the
                                        // double-Space hint shortcut must not be
                                        // passed to the roman parser as an error.
                                        // A real space in the answer still works.
                                        if (isKanaAnswer && english[currentSelection] !== " ") {
                                            setCharInput("");
                                            return;
                                        }
                                    } else {
                                        lastKeyWasSpaceRef.current = false;
                                    }
                                }
                                if (firstKeyAtRef.current === null) {
                                    firstKeyAtRef.current = performance.now();
                                }
                                if (isKanaAnswer) {
                                    const edit = editKanaCell(
                                        english,
                                        input,
                                        currentSelection,
                                        kanaComposing,
                                        char,
                                    );
                                    if (edit.accepted) {
                                        setKanaComposing(edit.composing);
                                        if (edit.advance > 0) {
                                            setInput(edit.cells);
                                            moveToNext(edit.cells, edit.advance, edit.composing);
                                        } else {
                                            // Invalid or incomplete roman prefixes stay visible
                                            // for Backspace correction; no premature failure.
                                            onChangeInput(edit.cells.join("") + edit.composing);
                                        }
                                    }
                                    setCharInput("");
                                    return;
                                }
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
                            onFocus={() => {
                                setTimeout(() => {
                                    inputRef.current?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "center",
                                    });
                                }, 300);
                            }}
                            className="absolute inset-0 w-full h-full opacity-[0.01] z-10"
                            aria-label={isKanaAnswer ? "日本語の回答" : "英語の回答"}
                            autoComplete="off"
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

export default function TypingView(props: Parameters<typeof TypingAttempt>[0]) {
    return (
        <TypingAttempt
            key={JSON.stringify([
                props.japanese,
                props.english,
                props.currentInput === null,
                props.learningMode,
                props.initialCueRatio,
                props.hasDuplicateMeaning,
            ])}
            {...props}
        />
    );
}
