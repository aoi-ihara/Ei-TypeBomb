"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Item, Position, Room, User } from "@/type";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import GameView from "@/components/feature/GameView";
import Button from "@/components/ui/Button";
import { newPositions } from "@/lib/ui/position";
import { useFeatureFlagVariantKey } from "@posthog/react";
import posthog from "posthog-js";
import { advanceBombClock } from "@/lib/playground/bomb-clock";
import {
    applyRecallObservation,
    createTurnPlan,
    shouldRecommendStop,
    evaluateRecall,
    recordAnswerExposure,
    MEMORY_MODEL_VERSION,
    type ItemMemoryState,
    type RecallObservation,
    type RecallProgress,
} from "@/lib/playground/memory";
import {
    createScheduler,
    chooseNextUserItem,
    chooseBotItem,
    recordUserAnswer,
    recordBotPresentation,
    type SchedulerState,
} from "@/lib/playground/scheduler";
import {
    loadPlaygroundMemory,
    syncPlaygroundMemory,
} from "@/lib/playground/memory-client";

type Props = {
    room: Room;
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
};

const LOCAL_USER_ID = "playground-player";
const BOT_USERS: User[] = [{ id: "playground-bot-1", displayName: "練習相手" }];

const DEFAULT_TYPING_DELAY_MS = 220;
const MIN_TYPING_DELAY_MS = 80;
const MAX_TYPING_DELAY_MS = 600;
const TYPING_SPEED_SMOOTHING = 0.3;

const clampTypingDelay = (delayMs: number) =>
    Math.min(MAX_TYPING_DELAY_MS, Math.max(MIN_TYPING_DELAY_MS, delayMs));

export default function Client({
    room: sourceRoom,
    initialBackgroundMusic,
    initialSounDeffects,
}: Readonly<Props>) {
    const bombDuration =
        Number(useFeatureFlagVariantKey("bomb-duration")) || 20;
    const router = useRouter();
    const { bombRef, explode, resetExplosion, explosionLayer } =
        useBombExplosion();

    const [displayName, setDisplayName] = useState("あなた");
    const users = useMemo<User[]>(
        () => [{ id: LOCAL_USER_ID, displayName }, ...BOT_USERS],
        [displayName],
    );
    const room = useMemo<Room>(
        () => ({
            ...sourceRoom,
            maxPlayers: 2,
        }),
        [sourceRoom],
    );
    const items = useMemo(() => room.items ?? [], [room.items]);

    const [memoryByItem, setMemoryByItem] = useState<
        Record<string, ItemMemoryState>
    >({});
    const memoryByItemRef = useRef<Record<string, ItemMemoryState>>({});
    const pendingMemoryRef = useRef(new Map<string, ItemMemoryState>());
    const syncInFlightRef = useRef<Promise<void> | null>(null);
    const schedulerRef = useRef<SchedulerState | null>(null);
    const exposureGapAtStartRef = useRef<number | null>(null);
    const expectedTypingAtStartRef = useRef(0);
    const [saveError, setSaveError] = useState(false);
    const authenticatedUserIdRef = useRef<string | null>(null);
    const [memoryReady, setMemoryReady] = useState(false);
    const [memoryError, setMemoryError] = useState<string | null>(null);

    const [currentItem, setCurrentItem] = useState<Item | null>(null);
    const currentItemRef = useRef<Item | null>(null);
    const [currentTurn, setCurrentTurn] = useState(0);
    const currentTurnRef = useRef(0);
    const [bombStatus, setBombStatus] = useState(0);
    const bombStageProgressRef = useRef(0);
    const bombPlanRef = useRef<{ duration: number; paused: boolean }>({
        duration: bombDuration,
        paused: true,
    });
    const [isStarted, setIsStarted] = useState(false);
    const [result, setResult] = useState<boolean | null>(null);
    const [currentInput, setCurrentInput] = useState("");
    const [lostDisplayName, setLostDisplayName] = useState<string | null>(null);
    const [stopRecommended, setStopRecommended] = useState(false);
    const [recallPressurePaused, setRecallPressurePaused] = useState(false);

    const sessionTurnNumberRef = useRef(0);
    const [itemPresentationKey, setItemPresentationKey] = useState(0);
    const recallProgressRef = useRef<RecallProgress | null>(null);
    const userReviewCountRef = useRef(0);
    const sessionStartedAtRef = useRef(0);
    const initialGameStartedRef = useRef(false);
    const countdownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const usersRef = useRef(users);
    const userTypingDelayRef = useRef(DEFAULT_TYPING_DELAY_MS);
    const previousInputAtRef = useRef<number | null>(null);
    const previousInputLengthRef = useRef(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const successAudioRef = useRef<HTMLAudioElement | null>(null);

    const userPositions = useMemo<Position[]>(
        () =>
            newPositions(
                users,
                Array.from({ length: users.length }, () => ({
                    x: 0,
                    y: 0,
                    w: 24,
                    h: 24,
                    opacity: 0,
                })),
            ),
        [users],
    );

    useEffect(() => {
        const timer = setTimeout(
            () =>
                setDisplayName(
                    localStorage.getItem("display-name") || "あなた",
                ),
            0,
        );
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        usersRef.current = users;
    }, [users]);

    useEffect(() => {
        let cancelled = false;

        const loadMemory = async () => {
            const loaded = await loadPlaygroundMemory(room.id);
            if (cancelled) return;

            if (!loaded.userId) {
                router.replace(getSignInUrl());
                return;
            }

            if (loaded.error) {
                console.error("Failed to load playground memory", loaded.error);
                posthog.capture("playground_memory_load_failed", {
                    room_id: room.id,
                });
                setMemoryError(
                    "学習データを取得できませんでした。もう一度お試しください。",
                );
                return;
            }

            authenticatedUserIdRef.current = loaded.userId;
            // Recover unsent observations after reload, scoped to the authenticated user.
            try {
                const queued: ItemMemoryState[] = JSON.parse(
                    localStorage.getItem(
                        `playground-pending:${loaded.userId}:${room.id}`,
                    ) ?? "[]",
                );
                for (const pending of queued) {
                    if (
                        pending.userId !== loaded.userId ||
                        pending.roomId !== room.id ||
                        !items.some((item) => item.id === pending.itemId) ||
                        !Number.isFinite(pending.stability) ||
                        !Number.isFinite(pending.difficulty)
                    )
                        continue;
                    const remote = loaded.memoryByItem[pending.itemId];
                    if (
                        !remote ||
                        Date.parse(pending.updatedAt ?? "") >=
                            Date.parse(remote.updatedAt ?? "")
                    ) {
                        loaded.memoryByItem[pending.itemId] = pending;
                        pendingMemoryRef.current.set(pending.itemId, pending);
                    }
                }
            } catch {
                // A damaged/unavailable local cache must not prevent practice.
            }
            memoryByItemRef.current = loaded.memoryByItem;
            setMemoryByItem(loaded.memoryByItem);
            setMemoryReady(true);
        };

        void loadMemory();

        return () => {
            cancelled = true;
        };
    }, [room.id, router, items]);

    const saveBotExposure = useCallback((item: Item) => {
        const memory = memoryByItemRef.current[item.id];
        if (!memory) return;
        const exposed = recordAnswerExposure(memory);
        memoryByItemRef.current = {
            ...memoryByItemRef.current,
            [item.id]: exposed,
        };
        pendingMemoryRef.current.set(item.id, exposed);
        setMemoryByItem(memoryByItemRef.current);
    }, []);

    const setTrackedItem = useCallback(
        (item: Item | null) => {
            currentItemRef.current = item;
            setCurrentItem(item);
            recallProgressRef.current = null;
            setRecallPressurePaused(false);
            if (!item) return;
            sessionTurnNumberRef.current += 1;
            setItemPresentationKey(sessionTurnNumberRef.current);
            const local =
                usersRef.current[currentTurnRef.current]?.id === LOCAL_USER_ID;
            if (local) {
                const memory = memoryByItemRef.current[item.id];
                const exposure =
                    memory?.lastPresentedAt ?? memory?.lastReviewedAt;
                // Measure before answering: a long typing delay does not undo a BOT preview.
                exposureGapAtStartRef.current = exposure
                    ? Math.max(0, Date.now() - Date.parse(exposure))
                    : null;
                expectedTypingAtStartRef.current =
                    item.answer.length * userTypingDelayRef.current;
            } else {
                if (schedulerRef.current)
                    recordBotPresentation(schedulerRef.current, item.id);
                saveBotExposure(item);
            }
        },
        [saveBotExposure],
    );

    const chooseItemForTurn = useCallback(
        (turnIndex: number) => {
            const scheduler =
                schedulerRef.current ??
                (schedulerRef.current = createScheduler(
                    items.map((item) => item.id),
                ));
            const id =
                usersRef.current[turnIndex]?.id === LOCAL_USER_ID
                    ? chooseNextUserItem(scheduler, memoryByItemRef.current)
                          ?.itemId
                    : chooseBotItem(scheduler);
            return items.find((item) => item.id === id) ?? null;
        },
        [items],
    );

    const resolveTurnWithItem = useCallback(
        (requestedTurnIndex: number) => {
            const requestedItem = chooseItemForTurn(requestedTurnIndex);
            if (requestedItem) {
                return {
                    turnIndex: requestedTurnIndex,
                    item: requestedItem,
                };
            }

            const localTurnIndex = usersRef.current.findIndex(
                (user) => user.id === LOCAL_USER_ID,
            );
            if (localTurnIndex < 0) {
                return {
                    turnIndex: requestedTurnIndex,
                    item: null,
                };
            }

            return {
                turnIndex: localTurnIndex,
                item: chooseItemForTurn(localTurnIndex),
            };
        },
        [chooseItemForTurn],
    );

    const setTrackedTurn = useCallback((turnIndex: number) => {
        currentTurnRef.current = turnIndex;
        setCurrentTurn(turnIndex);
    }, []);

    const startGame = useCallback(() => {
        if (!memoryReady || items.length === 0) return;

        if (countdownTimerRef.current) {
            clearTimeout(countdownTimerRef.current);
        }

        if (sessionStartedAtRef.current === 0)
            sessionStartedAtRef.current = Date.now();
        resetExplosion();
        setIsStarted(true);
        setBombStatus(0);
        bombStageProgressRef.current = 0;
        setCurrentInput("");
        setResult(null);
        setLostDisplayName(null);
        setStopRecommended(false);
        setTrackedItem(null);

        const requestedFirstTurn = Math.floor(
            Math.random() * usersRef.current.length,
        );

        countdownTimerRef.current = setTimeout(() => {
            const resolved = resolveTurnWithItem(requestedFirstTurn);
            setTrackedTurn(resolved.turnIndex);
            setTrackedItem(resolved.item);
            countdownTimerRef.current = null;
        }, 3000);
    }, [
        items.length,
        resolveTurnWithItem,
        memoryReady,
        resetExplosion,
        setTrackedItem,
        setTrackedTurn,
    ]);

    useEffect(() => {
        successAudioRef.current = new Audio("/Blip_select_8.wav");

        return () => {
            if (countdownTimerRef.current) {
                clearTimeout(countdownTimerRef.current);
            }
            successAudioRef.current?.pause();
        };
    }, []);

    useEffect(() => {
        if (!memoryReady || initialGameStartedRef.current) {
            return;
        }

        initialGameStartedRef.current = true;
        posthog.capture("playground_game_started", {
            room_id: room.id,
            player_count: users.length,
        });
        startGame();
    }, [memoryReady, room.id, startGame, users.length]);

    const updateLocalMemory = useCallback(
        (item: Item, observation: RecallObservation) => {
            const userId = authenticatedUserIdRef.current;
            if (!userId) return;

            const scheduler = schedulerRef.current;
            const selected = scheduler?.current;
            const evidence: RecallObservation = {
                ...observation,
                incorrectInputCount:
                    observation.incorrectInputCount ??
                    Math.max(0, observation.attemptCount - 1),
                initialCueRatio: observation.initialCueRatio ?? 0,
                additionalHintCount:
                    observation.additionalHintCount ?? observation.hintCount,
                finalCueRatio:
                    observation.finalCueRatio ??
                    observation.revealedHintChars /
                        Math.max(1, observation.answerLength),
                answerWasFullyRevealed:
                    observation.answerWasFullyRevealed ??
                    observation.revealedHintChars >= observation.answerLength,
                elapsedSincePresentationMs: exposureGapAtStartRef.current,
                expectedTypingMs: expectedTypingAtStartRef.current,
                schedulerReason: selected?.reason ?? "cycle",
            };
            const evaluation = evaluateRecall(evidence);
            if (scheduler) recordUserAnswer(scheduler, evaluation);
            const nextMemory = applyRecallObservation({
                memory: memoryByItemRef.current[item.id],
                observation: evidence,
                userId,
                roomId: room.id,
                itemId: item.id,
            });

            const nextMemoryByItem = {
                ...memoryByItemRef.current,
                [item.id]: nextMemory,
            };

            memoryByItemRef.current = nextMemoryByItem;
            setMemoryByItem(nextMemoryByItem);
            pendingMemoryRef.current.set(item.id, nextMemory);
            userReviewCountRef.current += 1;

            posthog.capture("playground_item_recalled", {
                room_id: room.id,
                item_id: item.id,
                success: observation.success,
                correct: observation.success,
                source: "user",
                expected_typing_ms: evidence.expectedTypingMs,
                model_version: MEMORY_MODEL_VERSION,
                scheduler_reason: evidence.schedulerReason,
                scheduler_turn: selected?.turn,
                scheduler_cycle: selected?.cycle,
                retry_earliest_turn: selected?.retry?.earliestTurn,
                retry_latest_turn: selected?.retry?.latestTurn,
                memory_evidence: evaluation.memoryEvidence,
                retry_need: evaluation.retryNeed,
                independent_recall: evaluation.independent,
                first_attempt_correct: evidence.firstAttemptCorrect,
                incorrect_input_count: evidence.incorrectInputCount,
                answer_was_fully_revealed: evidence.answerWasFullyRevealed,
                elapsed_ms: observation.elapsedMs,
                elapsed_since_presentation_ms:
                    evidence.elapsedSincePresentationMs,
                initial_cue_ratio: evidence.initialCueRatio,
                additional_hint_count: evidence.additionalHintCount,
                recall_latency_ms: observation.recallLatencyMs,
                hint_count: observation.hintCount,
                hint_policy: "manual-letter-v1",
                assisted_positions: observation.assistedPositions,
                hint_events: observation.hintEvents,
                revealed_hint_chars: observation.revealedHintChars,
                max_correct_prefix_length: observation.maxCorrectPrefixLength,
                attempt_count: observation.attemptCount,
                recall_outcome: observation.outcome,
                final_cue_ratio: evidence.finalCueRatio,
                stability_after: nextMemory.stability,
                difficulty_after: nextMemory.difficulty,
            });
        },
        [room.id],
    );

    const cachePendingMemory = useCallback(() => {
        const userId = authenticatedUserIdRef.current;
        if (!userId) return;
        try {
            localStorage.setItem(
                `playground-pending:${userId}:${room.id}`,
                JSON.stringify([...pendingMemoryRef.current.values()]),
            );
        } catch {
            // Network sync still works when local storage is unavailable.
        }
    }, [room.id]);

    const flushPendingMemory = useCallback(async () => {
        cachePendingMemory();
        if (syncInFlightRef.current) return syncInFlightRef.current;
        const sync = async () => {
            // Serialize requests so an older write cannot overtake a newer one.
            while (pendingMemoryRef.current.size > 0) {
                const snapshot = [...pendingMemoryRef.current.values()];
                try {
                    const error = await syncPlaygroundMemory(snapshot);
                    if (error) throw error;
                    for (const synced of snapshot) {
                        if (
                            pendingMemoryRef.current.get(synced.itemId) ===
                            synced
                        )
                            pendingMemoryRef.current.delete(synced.itemId);
                    }
                    cachePendingMemory();
                    setSaveError(false);
                } catch (error) {
                    console.error("Failed to sync playground memory", error);
                    setSaveError(true);
                    posthog.capture("playground_memory_sync_failed", {
                        room_id: room.id,
                    });
                    break;
                }
            }
        };
        const promise = sync();
        syncInFlightRef.current = promise;
        try {
            await promise;
        } finally {
            syncInFlightRef.current = null;
        }
    }, [room.id, cachePendingMemory]);

    useEffect(() => {
        if (!memoryReady) return;
        cachePendingMemory();
        const timer = setTimeout(() => {
            void flushPendingMemory();
        }, 300);
        return () => clearTimeout(timer);
    }, [memoryByItem, memoryReady, cachePendingMemory, flushPendingMemory]);

    useEffect(() => {
        const retry = () => {
            void flushPendingMemory();
        };
        const leaving = () => {
            cachePendingMemory();
            void flushPendingMemory();
        };
        const hidden = () => {
            if (document.visibilityState === "hidden") leaving();
        };
        const interval = setInterval(retry, 5_000);
        window.addEventListener("online", retry);
        window.addEventListener("pagehide", leaving);
        document.addEventListener("visibilitychange", hidden);
        return () => {
            clearInterval(interval);
            window.removeEventListener("online", retry);
            window.removeEventListener("pagehide", leaving);
            document.removeEventListener("visibilitychange", hidden);
            cachePendingMemory();
        };
    }, [cachePendingMemory, flushPendingMemory]);

    const handleRecallProgress = useCallback((progress: RecallProgress) => {
        if (usersRef.current[currentTurnRef.current]?.id !== LOCAL_USER_ID) {
            return;
        }

        recallProgressRef.current = progress;
        const item = currentItemRef.current;
        if (
            item?.type === "typed_recall" &&
            (progress.hintCount > 0 ||
                progress.answerWasFullyRevealed ||
                progress.revealedHintChars >= item.answer.length)
        ) {
            setRecallPressurePaused(true);
        }
    }, []);

    const handleRecallComplete = useCallback(
        (observation: RecallObservation) => {
            const item = currentItemRef.current;
            if (
                usersRef.current[currentTurnRef.current]?.id !==
                    LOCAL_USER_ID ||
                !item
            ) {
                return;
            }

            updateLocalMemory(item, observation);
        },
        [updateLocalMemory],
    );

    const handleInputChange = useCallback((input: string) => {
        const now = Date.now();
        const previousLength = previousInputLengthRef.current;
        const previousInputAt = previousInputAtRef.current;
        const addedCharacters = input.length - previousLength;

        if (addedCharacters > 0 && previousInputAt !== null) {
            const sampleDelay = (now - previousInputAt) / addedCharacters;

            if (sampleDelay > 0 && sampleDelay < 2000) {
                const clampedSample = clampTypingDelay(sampleDelay);
                userTypingDelayRef.current =
                    userTypingDelayRef.current * (1 - TYPING_SPEED_SMOOTHING) +
                    clampedSample * TYPING_SPEED_SMOOTHING;
            }
        }

        previousInputLengthRef.current = input.length;
        previousInputAtRef.current = input.length === 0 ? null : now;
        setCurrentInput(input);
    }, []);

    const handleSuccess = useCallback(() => {
        const wasAnswerRevealed =
            usersRef.current[currentTurnRef.current]?.id === LOCAL_USER_ID &&
            recallProgressRef.current?.answerWasFullyRevealed === true;
        if (
            !wasAnswerRevealed &&
            successAudioRef.current &&
            initialSounDeffects
        ) {
            successAudioRef.current.currentTime = 0;
            successAudioRef.current.volume = 1;
            successAudioRef.current.play().catch(() => {});
        }

        const presentedItem = currentItemRef.current;
        if (
            presentedItem &&
            usersRef.current[currentTurnRef.current]?.id !== LOCAL_USER_ID
        ) {
            saveBotExposure(presentedItem);
        }
        setCurrentInput("");
        previousInputAtRef.current = null;
        previousInputLengthRef.current = 0;

        const requestedNextTurn =
            (currentTurnRef.current + 1) % usersRef.current.length;
        const resolved = resolveTurnWithItem(requestedNextTurn);
        setTrackedTurn(resolved.turnIndex);
        setTrackedItem(resolved.item);

        posthog.capture(
            wasAnswerRevealed ? "word_reviewed" : "word_succeeded",
            {
                mode: "playground",
                room_id: room.id,
            },
        );
    }, [
        initialSounDeffects,
        saveBotExposure,
        resolveTurnWithItem,
        room.id,
        setTrackedItem,
        setTrackedTurn,
    ]);

    const currentTurnUser = users[currentTurn];

    const currentTurnPlan = useMemo(() => {
        if (currentTurnUser?.id !== LOCAL_USER_ID || !currentItem) {
            return null;
        }

        return createTurnPlan(memoryByItem[currentItem.id]);
    }, [currentItem, currentTurnUser?.id, memoryByItem]);

    useEffect(() => {
        bombPlanRef.current = {
            duration:
                (currentTurnPlan?.retrievalWindowMs ?? 32_000) *
                (currentTurnPlan?.bombPressure === "low" ? 1.35 : 1),
            paused:
                !currentItem ||
                currentTurnPlan?.bombPressure === "paused" ||
                recallPressurePaused,
        };
    }, [currentItem, currentTurnPlan, recallPressurePaused]);

    useEffect(() => {
        if (!memoryReady || !isStarted || result !== null) return;
        let previousTick = performance.now();
        const resetTick = () => {
            previousTick = performance.now();
        };
        document.addEventListener("visibilitychange", resetTick);
        const jitter = 0.94 + Math.random() * 0.12;
        const timer = setInterval(() => {
            const now = performance.now();
            const elapsed = now - previousTick;
            previousTick = now;
            const duration = bombPlanRef.current.duration * jitter;
            bombStageProgressRef.current = advanceBombClock(
                bombStageProgressRef.current,
                elapsed,
                duration,
                bombPlanRef.current.paused ||
                    document.visibilityState === "hidden",
            );
            if (bombStageProgressRef.current < 1) return;
            bombStageProgressRef.current = 0;
            if (bombStatus === 4) {
                const lostUser = usersRef.current[currentTurnRef.current];
                const didLose = lostUser?.id === LOCAL_USER_ID;
                const item = currentItemRef.current;

                if (didLose && item?.type === "typed_recall") {
                    const progress = recallProgressRef.current ?? {
                        attemptCount: 1,
                        hintCount: 0,
                        revealedHintChars: 0,
                        maxCorrectPrefixLength: 0,
                        recallLatencyMs: null,
                        elapsedMs: duration,
                    };

                    updateLocalMemory(item, {
                        ...progress,
                        success: false,
                        answerLength: item.answer.length,
                        firstAttemptCorrect: false,
                    });
                }

                const recommendStop = shouldRecommendStop({
                    sessionStartedAt: sessionStartedAtRef.current,
                });

                setStopRecommended(recommendStop);
                explode();
                setResult(didLose);
                setLostDisplayName(lostUser?.displayName ?? "練習相手");
                setBombStatus(0);

                posthog.capture(didLose ? "game_lost" : "game_won", {
                    mode: "playground",
                    room_id: room.id,
                    stop_recommended: recommendStop,
                });

                void flushPendingMemory();
                return;
            }

            setBombStatus((previous) => previous + 1);
        }, 200);

        return () => {
            clearInterval(timer);
            document.removeEventListener("visibilitychange", resetTick);
        };
    }, [
        bombStatus,
        explode,
        flushPendingMemory,
        isStarted,
        items,
        memoryReady,
        result,
        room.id,
        updateLocalMemory,
    ]);

    useEffect(() => {
        if (
            !isStarted ||
            result !== null ||
            !currentItem ||
            currentTurnUser?.id === LOCAL_USER_ID ||
            currentItem.type !== "typed_recall"
        ) {
            return;
        }

        const charDelay = clampTypingDelay(userTypingDelayRef.current);
        const initialDelay = Math.min(1000, Math.max(250, charDelay * 2.5));

        const target = currentItem.answer;
        let charIndex = 0;
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout>;

        const typeNextCharacter = () => {
            if (cancelled) return;

            if (charIndex < target.length) {
                charIndex += 1;
                setCurrentInput(target.slice(0, charIndex));
                const jitter = 0.9 + Math.random() * 0.2;
                timer = setTimeout(
                    typeNextCharacter,
                    Math.round(charDelay * jitter),
                );
                return;
            }

            timer = setTimeout(() => {
                if (!cancelled) handleSuccess();
            }, 200);
        };

        timer = setTimeout(typeNextCharacter, initialDelay);

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [currentItem, currentTurnUser, handleSuccess, isStarted, result]);

    useEffect(() => {
        audioRef.current = new Audio("/MT-RD_17_for_Loop.wav");
        audioRef.current.loop = true;

        const startAudio = () => {
            if (!initialBackgroundMusic || !audioRef.current) return;

            audioRef.current
                .play()
                .then(removeListeners)
                .catch(() => {});
        };

        const addListeners = () => {
            window.addEventListener("click", startAudio);
            window.addEventListener("touchstart", startAudio);
            window.addEventListener("keydown", startAudio);
        };

        const removeListeners = () => {
            window.removeEventListener("click", startAudio);
            window.removeEventListener("touchstart", startAudio);
            window.removeEventListener("keydown", startAudio);
        };

        startAudio();
        addListeners();

        return () => {
            removeListeners();
            audioRef.current?.pause();
        };
    }, [initialBackgroundMusic]);

    const activeLearningPlan =
        currentTurnUser?.id === LOCAL_USER_ID ? currentTurnPlan : null;

    return (
        <GameView
            room={memoryReady ? room : null}
            users={users}
            positions={userPositions}
            userId={LOCAL_USER_ID}
            currentTurn={currentTurn}
            bombStatus={bombStatus}
            currentItem={currentItem}
            itemPresentationKey={itemPresentationKey}
            currentInput={currentInput}
            isStarted={isStarted}
            serverError={memoryError}
            result={result}
            lostDisplayName={lostDisplayName}
            bombRef={bombRef}
            explosionLayer={explosionLayer}
            onSuccess={handleSuccess}
            onChangeInput={handleInputChange}
            onRecallProgress={handleRecallProgress}
            onRecallComplete={handleRecallComplete}
            learningMode={activeLearningPlan?.mode}
            initialCueRatio={activeLearningPlan?.initialCueRatio}
            cueSteps={activeLearningPlan?.cueSteps}
            hintDelaysMs={activeLearningPlan?.hintDelaysMs}
            onPlayAgain={startGame}
            onCreateRoom={() => router.push(getSignInUrl())}
            enableRemoteTypingSync={false}
            stopRecommended={stopRecommended}
            onStop={() => {
                void flushPendingMemory().finally(() => {
                    router.push("/room");
                });
            }}
            resultExtraActions={
                <>
                    {saveError && (
                        <p role="status">
                            学習データは保存待ちです。接続が戻ると再送します。
                        </p>
                    )}
                    <Button
                        iconName="link"
                        className="w-full"
                        onClick={() => {
                            void flushPendingMemory().finally(() =>
                                router.push("/room"),
                            );
                        }}
                    >
                        別のルームを選択
                    </Button>
                </>
            }
        />
    );
}
