"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import type { Item, Room, User } from "@/type";
import GameView from "@/components/game/GameView";
import type { GameNoticeProps } from "@/components/game/GameNotice";
import Button from "@/components/ui/Button";
import GameSettings from "@/components/settings/GameSettings";
import type { OfflineVoiceReading } from "@/lib/settings";
import posthog from "posthog-js";
import {
    applyRecallObservation,
    createTurnPlan,
    evaluateRecall,
    getRetrievability,
    MEMORY_MODEL_VERSION,
    type ItemMemoryState,
    type RecallObservation,
    type RecallProgress,
} from "@/lib/playground/memory";
import {
    createScheduler,
    loadSchedulerState,
    saveSchedulerState,
    nextSuspendedReviewAt,
    chooseNextUserItem,
    recordUserAnswer,
    type SchedulerState,
} from "@/lib/playground/scheduler";
import {
    loadPlaygroundMemory,
    syncPlaygroundMemory,
} from "@/lib/playground/memory-client";
import OfflineVoicePicker from "@/components/settings/OfflineVoicePicker";
import { Icon } from "@/components/ui/Icon";

type Props = {
    room: Room;
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
    initialOfflineVoiceReading: OfflineVoiceReading;
};

const LOCAL_USER_ID = "playground-player";
const GUEST_MEMORY_USER_ID = "playground-guest";
const guestMemoryKey = (roomId: string) => `playground-memory:guest:${roomId}`;

const loadGuestMemory = (
    roomId: string,
    itemIds: Set<string>,
): Record<string, ItemMemoryState> => {
    try {
        const parsed: unknown = JSON.parse(
            localStorage.getItem(guestMemoryKey(roomId)) ?? "{}",
        );
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return {};
        return Object.fromEntries(
            Object.entries(parsed).filter(([id, value]) => {
                if (!itemIds.has(id) || !value || typeof value !== "object")
                    return false;
                const m = value as Partial<ItemMemoryState>;
                return (
                    m.itemId === id &&
                    m.roomId === roomId &&
                    m.userId === GUEST_MEMORY_USER_ID &&
                    Number.isFinite(m.stability) &&
                    Number.isFinite(m.difficulty) &&
                    Number.isFinite(m.reviewCount) &&
                    (m.lastReviewedAt == null ||
                        !Number.isNaN(Date.parse(m.lastReviewedAt))) &&
                    (m.lastPresentedAt == null ||
                        !Number.isNaN(Date.parse(m.lastPresentedAt))) &&
                    (m.updatedAt == null ||
                        !Number.isNaN(Date.parse(m.updatedAt)))
                );
            }),
        ) as Record<string, ItemMemoryState>;
    } catch {
        // Ignore corrupted or blocked storage.
        return {};
    }
};

// Preserve newer updates from other tabs instead of overwriting the whole room.
const mergeGuestMemory = (
    current: Record<string, ItemMemoryState>,
    incoming: Record<string, ItemMemoryState>,
): Record<string, ItemMemoryState> => {
    const merged = { ...current };
    for (const [id, memory] of Object.entries(incoming)) {
        const previous = merged[id];
        if (
            !previous ||
            (Date.parse(memory.updatedAt ?? "") || 0) >=
                (Date.parse(previous.updatedAt ?? "") || 0)
        ) {
            merged[id] = memory;
        }
    }
    return merged;
};

const saveGuestMemory = (
    roomId: string,
    memory: Record<string, ItemMemoryState>,
): Record<string, ItemMemoryState> => {
    const merged = mergeGuestMemory(
        loadGuestMemory(
            roomId,
            new Set([
                ...Object.keys(memory),
                ...Object.keys(readGuestMemoryKeys(roomId)),
            ]),
        ),
        memory,
    );
    try {
        localStorage.setItem(guestMemoryKey(roomId), JSON.stringify(merged));
    } catch {
        // Storage may be unavailable or full; practice remains playable.
    }
    return merged;
};

// Read only keys here; loadGuestMemory validates the actual values.
const readGuestMemoryKeys = (roomId: string): Record<string, unknown> => {
    try {
        const value: unknown = JSON.parse(
            localStorage.getItem(guestMemoryKey(roomId)) ?? "{}",
        );
        return value && typeof value === "object" && !Array.isArray(value)
            ? (value as Record<string, unknown>)
            : {};
    } catch {
        return {};
    }
};
const SOLO_USERS: User[] = [{ id: LOCAL_USER_ID, displayName: "あなた" }];

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
    initialOfflineVoiceReading,
}: Readonly<Props>) {
    const router = useRouter();

    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [soundEffects, setSoundEffects] = useState(initialSounDeffects);
    const offlineVoiceReading = initialOfflineVoiceReading;
    const users = SOLO_USERS;
    const room = useMemo<Room>(
        () => ({
            ...sourceRoom,
            maxPlayers: 1,
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
    const predictedRetrievabilityAtPromptRef = useRef<number | null>(null);
    const authenticatedUserIdRef = useRef<string | null>(null);
    const [memoryReady, setMemoryReady] = useState(false);
    const [memoryError, setMemoryError] = useState<string | null>(null);

    const [currentItem, setCurrentItem] = useState<Item | null>(null);
    const [nextReviewAt, setNextReviewAt] = useState<number | null>(null);
    const currentItemRef = useRef<Item | null>(null);
    const [isStarted, setIsStarted] = useState(false);
    const [showInstructions, setShowInstructions] = useState(true);
    const [notice, setNotice] = useState<GameNoticeProps>({
        visible: true,
        iconName: "keyboard",
        title: "半角で入力してください",
        description: "単語は日本語でも英語でも、半角で入力してください。",
    });
    const [isPaused, setIsPaused] = useState(false);
    const [currentInput, setCurrentInput] = useState("");

    const sessionTurnNumberRef = useRef(0);
    const [itemPresentationKey, setItemPresentationKey] = useState(0);
    const recallProgressRef = useRef<RecallProgress | null>(null);
    const userReviewCountRef = useRef(0);
    const initialGameStartedRef = useRef(false);
    const userTypingDelayRef = useRef(DEFAULT_TYPING_DELAY_MS);
    const previousInputAtRef = useRef<number | null>(null);
    const previousInputLengthRef = useRef(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const successAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            setNotice((current) => ({ ...current, visible: false }));
        }, 5000);
        return () => window.clearTimeout(timer);
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadMemory = async () => {
            const loaded = await loadPlaygroundMemory(room.id);
            if (cancelled) return;

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

            if (!loaded.userId) {
                const saved = loadGuestMemory(
                    room.id,
                    new Set(items.map((item) => item.id)),
                );
                memoryByItemRef.current = saved;
                schedulerRef.current =
                    loadSchedulerState(
                        "playground",
                        GUEST_MEMORY_USER_ID,
                        room.id,
                        items.map((item) => item.id),
                        saved,
                    ) ?? createScheduler(items.map((item) => item.id));
                setMemoryByItem(saved);
                setMemoryReady(true);
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
            schedulerRef.current =
                loadSchedulerState(
                    "playground",
                    loaded.userId,
                    room.id,
                    items.map((item) => item.id),
                    loaded.memoryByItem,
                ) ?? createScheduler(items.map((item) => item.id));
            setMemoryByItem(loaded.memoryByItem);
            setMemoryReady(true);
        };

        void loadMemory();

        return () => {
            cancelled = true;
        };
    }, [room.id, items]);

    const setTrackedItem = useCallback((item: Item | null) => {
        currentItemRef.current = item;
        setCurrentItem(item);
        recallProgressRef.current = null;
        if (!item) return;

        sessionTurnNumberRef.current += 1;
        setItemPresentationKey(sessionTurnNumberRef.current);
        const memory = memoryByItemRef.current[item.id];
        predictedRetrievabilityAtPromptRef.current =
            memory && memory.reviewCount > 0 && memory.lastReviewedAt
                ? getRetrievability(memory)
                : null;
        const exposure = memory?.lastPresentedAt ?? memory?.lastReviewedAt;
        exposureGapAtStartRef.current = exposure
            ? Math.max(0, Date.now() - Date.parse(exposure))
            : null;
        expectedTypingAtStartRef.current =
            item.answer.length * userTypingDelayRef.current;
    }, []);

    const chooseItemForTurn = useCallback(() => {
        const scheduler =
            schedulerRef.current ??
            (schedulerRef.current = createScheduler(
                items.map((item) => item.id),
            ));
        const id = chooseNextUserItem(
            scheduler,
            memoryByItemRef.current,
        )?.itemId;
        saveSchedulerState(
            "playground",
            authenticatedUserIdRef.current ?? GUEST_MEMORY_USER_ID,
            room.id,
            scheduler,
        );
        return items.find((item) => item.id === id) ?? null;
    }, [items, room.id]);

    const resolveTurnWithItem = useCallback(() => {
        const item = chooseItemForTurn();
        if (!item) {
            setNextReviewAt(
                schedulerRef.current
                    ? nextSuspendedReviewAt(schedulerRef.current)
                    : null,
            );
            setIsStarted(false);
        }
        return item;
    }, [chooseItemForTurn]);

    const startGame = useCallback(() => {
        if (!memoryReady || items.length === 0) return;

        setIsStarted(true);
        setIsPaused(false);
        setNextReviewAt(null);
        setCurrentInput("");
        previousInputAtRef.current = null;
        previousInputLengthRef.current = 0;
        setTrackedItem(resolveTurnWithItem());
    }, [items.length, memoryReady, resolveTurnWithItem, setTrackedItem]);

    useEffect(() => {
        successAudioRef.current = new Audio("/Blip_select_8.wav");
        return () => {
            successAudioRef.current?.pause();
        };
    }, []);

    const startFromInstructions = useCallback(() => {
        if (
            !memoryReady ||
            items.length === 0 ||
            initialGameStartedRef.current
        ) {
            return;
        }

        initialGameStartedRef.current = true;
        setShowInstructions(false);
        posthog.capture("playground_game_started", {
            room_id: room.id,
            player_count: users.length,
        });

        // The instruction screen replaces the initial three-second start screen.
        startGame();
    }, [items.length, memoryReady, room.id, startGame]);

    useEffect(() => {
        if (
            !memoryReady ||
            !showInstructions ||
            initialGameStartedRef.current
        ) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (
                initialGameStartedRef.current ||
                (event.code !== "Space" && event.key !== " ") ||
                event.repeat ||
                event.isComposing
            ) {
                return;
            }

            const target = event.target;
            if (
                target instanceof HTMLElement &&
                target.closest(
                    "button, input, textarea, select, [contenteditable='true']",
                )
            ) {
                return;
            }

            event.preventDefault();
            startFromInstructions();
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [memoryReady, showInstructions, startFromInstructions]);

    const updateLocalMemory = useCallback(
        (item: Item, observation: RecallObservation) => {
            const userId =
                authenticatedUserIdRef.current ?? GUEST_MEMORY_USER_ID;

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
            const predictedRetrievabilityBefore =
                predictedRetrievabilityAtPromptRef.current;
            predictedRetrievabilityAtPromptRef.current = null;
            const evaluation = evaluateRecall(evidence);
            const previousHoldUntil =
                scheduler?.struggles[item.id]?.suspendedUntil ?? null;
            if (scheduler) recordUserAnswer(scheduler, evaluation);
            const currentStruggle = scheduler?.struggles[item.id];
            if (
                currentStruggle?.suspendedUntil != null &&
                currentStruggle.suspendedUntil !== previousHoldUntil
            ) {
                posthog.capture("playground_item_suspended", {
                    room_id: room.id,
                    item_id: item.id,
                    suspension_level: currentStruggle.suspensionLevel,
                    suspended_until: new Date(currentStruggle.suspendedUntil).toISOString(),
                });
            }
            const freshestMemory = authenticatedUserIdRef.current
                ? memoryByItemRef.current
                : mergeGuestMemory(
                      memoryByItemRef.current,
                      loadGuestMemory(
                          room.id,
                          new Set(items.map((entry) => entry.id)),
                      ),
                  );
            const nextMemory = applyRecallObservation({
                memory: freshestMemory[item.id],
                observation: evidence,
                userId,
                roomId: room.id,
                itemId: item.id,
            });

            let nextMemoryByItem = {
                ...freshestMemory,
                [item.id]: nextMemory,
            };

            if (authenticatedUserIdRef.current) {
                pendingMemoryRef.current.set(item.id, nextMemory);
                // Persist the observation immediately, before a rapid reload.
                // The existing debounced sync still sends it to the server.
                try {
                    localStorage.setItem(
                        `playground-pending:${authenticatedUserIdRef.current}:${room.id}`,
                        JSON.stringify([...pendingMemoryRef.current.values()]),
                    );
                } catch {
                    // Local storage may be unavailable; the current game continues.
                }
            } else {
                nextMemoryByItem = saveGuestMemory(room.id, nextMemoryByItem);
            }
            memoryByItemRef.current = nextMemoryByItem;
            setMemoryByItem(nextMemoryByItem);
            if (scheduler)
                saveSchedulerState("playground", userId, room.id, scheduler);
            userReviewCountRef.current += 1;

            posthog.capture("playground_item_recalled", {
                room_id: room.id,
                item_id: item.id,
                success: observation.success,
                correct: observation.success,
                source: "user",
                expected_typing_ms: evidence.expectedTypingMs,
                model_version: MEMORY_MODEL_VERSION,
                predicted_retrievability_before: predictedRetrievabilityBefore,
                memory_stability_before:
                    freshestMemory[item.id]?.stability ?? null,
                memory_difficulty_before:
                    freshestMemory[item.id]?.difficulty ?? null,
                memory_review_count_before:
                    freshestMemory[item.id]?.reviewCount ?? 0,
                scheduler_reason: evidence.schedulerReason,
                scheduler_turn: selected?.turn,
                scheduler_cycle: selected?.cycle,
                retry_earliest_turn: selected?.retry?.earliestTurn,
                retry_latest_turn: selected?.retry?.latestTurn,
                memory_evidence: evaluation.memoryEvidence,
                retry_need: evaluation.retryNeed,
                struggle_failures: currentStruggle?.consecutiveFailures ?? 0,
                suspension_level: currentStruggle?.suspensionLevel ?? 0,
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
        [room.id, items],
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
        if (!authenticatedUserIdRef.current) return;
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
                } catch (error) {
                    console.error("Failed to sync playground memory", error);
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
        if (!memoryReady || !authenticatedUserIdRef.current) return;
        cachePendingMemory();
        const timer = setTimeout(() => {
            void flushPendingMemory();
        }, 300);
        return () => clearTimeout(timer);
    }, [memoryByItem, memoryReady, cachePendingMemory, flushPendingMemory]);

    useEffect(() => {
        if (!memoryReady || !authenticatedUserIdRef.current) return;
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
    }, [memoryReady, cachePendingMemory, flushPendingMemory]);

    const handleRecallProgress = useCallback((progress: RecallProgress) => {
        recallProgressRef.current = progress;
    }, []);

    const handleRecallComplete = useCallback(
        (observation: RecallObservation) => {
            const item = currentItemRef.current;
            if (!item || isPaused) return;

            // Pausing must not make the learner's response look slower.
            updateLocalMemory(item, observation);
        },
        [isPaused, updateLocalMemory],
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
        if (isPaused || !currentItemRef.current) return;

        const wasAnswerRevealed =
            recallProgressRef.current?.answerWasFullyRevealed === true;
        if (!wasAnswerRevealed && successAudioRef.current && soundEffects) {
            successAudioRef.current.currentTime = 0;
            successAudioRef.current.volume = 1;
            successAudioRef.current.play().catch(() => {});
        }

        const presentedItem = currentItemRef.current;
        // Speech also plays when the answer was entered after a full hint.
        if (
            offlineVoiceReading === "answer" &&
            presentedItem.answer.trim() &&
            typeof window !== "undefined" &&
            "speechSynthesis" in window &&
            typeof SpeechSynthesisUtterance !== "undefined"
        ) {
            const synthesis = window.speechSynthesis;
            synthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(presentedItem.answer);
            utterance.lang = "en-US";
            synthesis.speak(utterance);
        }

        setCurrentInput("");
        previousInputAtRef.current = null;
        previousInputLengthRef.current = 0;
        setTrackedItem(resolveTurnWithItem());

        posthog.capture(
            wasAnswerRevealed ? "word_reviewed" : "word_succeeded",
            { mode: "playground", room_id: room.id },
        );
    }, [
        isPaused,
        soundEffects,
        offlineVoiceReading,
        resolveTurnWithItem,
        room.id,
        setTrackedItem,
    ]);

    useEffect(() => {
        if (
            !isStarted ||
            isPaused ||
            !currentItem ||
            offlineVoiceReading !== "question"
        ) {
            return;
        }

        if (
            typeof window === "undefined" ||
            !("speechSynthesis" in window) ||
            typeof SpeechSynthesisUtterance === "undefined"
        ) {
            return;
        }

        const text = currentItem.prompt;
        if (!text.trim()) return;

        const synthesis = window.speechSynthesis;
        synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "ja-JP";
        synthesis.speak(utterance);

        return () => synthesis.cancel();
    }, [
        currentItem,
        isStarted,
        itemPresentationKey,
        offlineVoiceReading,
        isPaused,
    ]);

    const currentTurnPlan = useMemo(
        () => (currentItem ? createTurnPlan(memoryByItem[currentItem.id]) : null),
        [currentItem, memoryByItem],
    );

    useEffect(() => {
        audioRef.current = new Audio("/MT-RD_17_for_Loop.wav");
        audioRef.current.loop = true;

        const startAudio = () => {
            if (!backgroundMusic || !audioRef.current) return;

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
    }, [backgroundMusic]);

    const activeLearningPlan = currentTurnPlan;

    return (
        <>
            <GameView
                room={memoryReady ? room : null}
                users={users}
                positions={[]}
                userId={LOCAL_USER_ID}
                currentTurn={0}
                bombStatus={0}
                currentItem={currentItem}
                itemPresentationKey={itemPresentationKey}
                currentInput={currentInput}
                isStarted={isStarted}
                preGameContent={
                    memoryReady && nextReviewAt !== null ? (
                        <div className="flex flex-col gap-4 px-2" role="status">
                            <p className="font-bold">すべての単語が復習待ちです</p>
                            <p>
                                難しい単語はいったん保留しました。
                                次の復習は
                                {new Date(nextReviewAt).toLocaleString(
                                    "ja-JP",
                                    {
                                        month: "numeric",
                                        day: "numeric",
                                        hour: "2-digit",
                                        minute: "2-digit",
                                    },
                                )}
                                以降にできます。
                            </p>
                            <Button
                                className="w-full"
                                variant="primary"
                                iconName="rotateCcw"
                                onClick={startGame}
                            >
                                復習を確認
                            </Button>
                            <Button
                                className="w-full"
                                iconName="arrowLeft"
                                onClick={() => router.push("/" + (room.link ?? room.id))}
                            >
                                ルームへ戻る
                            </Button>
                        </div>
                    ) : memoryReady && showInstructions ? (
                        <div
                            className="flex flex-col gap-4 px-2"
                            role="region"
                            aria-labelledby="offline-instructions-title"
                        >
                            <div className="flex flex-col gap-4">
                                <div className="flex gap-2">
                                    <span className="shrink-0">
                                        <Icon name="keyboard" />
                                    </span>
                                    <span data-cursor="text">
                                        単語は英語でも日本語でも、
                                        <strong>半角</strong>
                                        で入力してください。
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <span className="shrink-0">
                                        <Icon name="lightbulb" />
                                    </span>
                                    <span data-cursor="text">
                                        オフラインプレイの場合は、
                                        <strong>スペースキーを2回押す</strong>
                                        と解答を見ることができます。
                                    </span>
                                </div>
                            </div>

                            <div className="flex flex-col gap-4">
                                <Button
                                    className="w-full"
                                    variant="primary"
                                    iconName="play"
                                    onClick={startFromInstructions}
                                    loading={!memoryReady}
                                    disabled={items.length === 0}
                                >
                                    ゲームを開始
                                </Button>
                                <p className="text-center opacity-50">
                                    またはスペースキーを押して開始。
                                </p>
                            </div>
                        </div>
                    ) : undefined
                }
                serverError={memoryError}
                notice={notice}
                result={null}
                soloMode
                isPaused={isPaused}
                onResume={() => setIsPaused(false)}
                onSuccess={handleSuccess}
                onChangeInput={handleInputChange}
                onRecallProgress={handleRecallProgress}
                onRecallComplete={handleRecallComplete}
                learningMode={activeLearningPlan?.mode}
                initialCueRatio={activeLearningPlan?.initialCueRatio}
                cueSteps={activeLearningPlan?.cueSteps}
                hintDelaysMs={activeLearningPlan?.hintDelaysMs}
                onPlayAgain={startGame}
                onCreateRoom={() => {
                    startNavigationProgress();
                    router.push(getSignInUrl());
                }}
                enableRemoteTypingSync={false}
                onStop={() => {
                    void flushPendingMemory().finally(() => {
                        startNavigationProgress();
                        router.push("/" + (room.link ?? room.id));
                    });
                }}
                resultExtraActions={
                    <Button
                        iconName="link"
                        className="w-full"
                        onClick={() => {
                            void flushPendingMemory().finally(() => {
                                startNavigationProgress();
                                router.push("/");
                            });
                        }}
                    >
                        別のルームを選択
                    </Button>
                }
            />
            <header className="w-full flex absolute justify-end p-4 gap-4">
                <Button
                    iconName="pause"
                    padding="small"
                    aria-label="一時停止"
                    className="w-10 shrink-0"
                    disabled={!isStarted || !currentItem || isPaused}
                    onClick={() => {
                        previousInputAtRef.current = null;
                        setIsPaused(true);
                        void flushPendingMemory();
                    }}
                />
                <div>
                    <OfflineVoicePicker
                        initialValue={initialOfflineVoiceReading}
                    />
                </div>
                <GameSettings
                    backgroundMusic={backgroundMusic}
                    soundEffects={soundEffects}
                    onBackgroundMusicChange={(next) => {
                        setBackgroundMusic(next);
                        document.cookie =
                            "background-music=" +
                            String(next) +
                            "; path=/; max-age=31536000; SameSite=Lax";
                        posthog.capture("settings_changed", {
                            setting: "background_music",
                            value: next,
                        });
                    }}
                    onSoundEffectsChange={(next) => {
                        setSoundEffects(next);
                        document.cookie =
                            "sound-effects=" +
                            String(next) +
                            "; path=/; max-age=31536000; SameSite=Lax";
                        posthog.capture("settings_changed", {
                            setting: "sound_effects",
                            value: next,
                        });
                    }}
                />
            </header>
        </>
    );
}
