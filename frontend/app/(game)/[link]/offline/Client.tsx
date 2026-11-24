"use client";
import { createSpeechLanguageResolver } from "@/lib/speech-language";
import { getMasteryGraph } from "@/lib/playground/mastery-graph";
import { LEARNING_DIAGNOSTICS_ENABLED, captureDecision, diagnosticJSON, type CapturedDecision, type AnswerEvent } from "@/lib/playground/diagnostics";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import { isGameSpaceKeyDown } from "@/lib/selection-shortcut";
import type { Item, Room, User } from "@/type";
import GameView from "@/components/game/GameView";
import OfflineMasteryProgress from "@/components/game/OfflineMasteryProgress";
import type { GameNoticeProps } from "@/components/game/GameNotice";
import Button from "@/components/ui/Button";
import GameSettings from "@/components/settings/GameSettings";
import posthog from "posthog-js";
import {
    applyRecallObservation,
    recordAnswerModeResult,
    isValidAnswerModeStats,
    createTurnPlan,
    evaluateRecall,
    getRetrievability,
    getExposureGap,
    evaluateRecognition,
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
    nextMemoryReviewAt,
    chooseNextUserItem,
    recordUserAnswer,
    recordRecognitionAnswer,
    type SchedulerState,
} from "@/lib/playground/scheduler";
import {
    loadPlaygroundMemory,
    startMemorySync,
} from "@/lib/playground/memory-client";
import { Icon } from "@/components/ui/Icon";
import { getEffectiveAnswerMode, getTypingAnswer, getRecognitionChoiceCount, toLearningAnswerMode, type OfflineAnswerMode } from "@/lib/answer-mode";

type Props = {
    room: Room;
    answerMode: OfflineAnswerMode;
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
};

const LOCAL_USER_ID = "playground-player";
const GUEST_MEMORY_USER_ID = "playground-guest";
const SESSION_MEMORY_USER_ID = "playground-session";
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
                        !Number.isNaN(Date.parse(m.updatedAt))) &&
                    (m.answerModeStats == null ||
                        isValidAnswerModeStats(m.answerModeStats))
                );
            }),
        ) as Record<string, ItemMemoryState>;
    } catch {
        return {};
    }
};

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
    } catch {}
    return merged;
};

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
    answerMode: requestedAnswerMode,
    initialBackgroundMusic,
    initialSounDeffects,
}: Readonly<Props>) {
    const router = useRouter();
    const answerMode = toLearningAnswerMode(requestedAnswerMode);

    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [soundEffects, setSoundEffects] = useState(initialSounDeffects);
    const [readQuestion, setReadQuestion] = useState(true);
    const [readAnswer, setReadAnswer] = useState(true);
    const [voiceSettingsReady, setVoiceSettingsReady] = useState(false);

    useEffect(() => {
        try {
            setReadQuestion(localStorage.getItem("offline-voice-question") !== "false");
            setReadAnswer(localStorage.getItem("offline-voice-answer") !== "false");
        } catch {
            // Keep both enabled if local storage is unavailable.
        }
        setVoiceSettingsReady(true);
    }, []);

    const updateVoiceSetting = (kind: "question" | "answer", enabled: boolean) => {
        if (kind === "question") setReadQuestion(enabled);
        else setReadAnswer(enabled);
        try {
            localStorage.setItem(`offline-voice-${kind}`, String(enabled));
        } catch {
            // The current session still uses the selected value.
        }
        posthog.capture("settings_changed", {
            setting: `offline_voice_${kind}`,
            value: enabled,
        });
    };
    const users = SOLO_USERS;
    const room = useMemo<Room>(
        () => ({
            ...sourceRoom,
            maxPlayers: 1,
        }),
        [sourceRoom],
    );
    const items = useMemo(() => room.items ?? [], [room.items]);
    const getSpeechLanguage = useMemo(() => createSpeechLanguageResolver(items), [items]);
    const masteryItemIds = useMemo(() => items.map(item => item.id), [items]);
    const itemModes = useMemo(() => Object.fromEntries(items.map(item =>
        [item.id, getEffectiveAnswerMode(item, answerMode)])), [items, answerMode]);
    const choiceCount = useMemo(() => getRecognitionChoiceCount(
        requestedAnswerMode,
        new Set(items.map(item => item.answer).filter(Boolean)).size,
    ), [items, requestedAnswerMode]);


    const [memoryByItem, setMemoryByItem] = useState<
        Record<string, ItemMemoryState>
    >({});
    const memoryByItemRef = useRef<Record<string, ItemMemoryState>>({});
    const [masteryNow, setMasteryNow] = useState(() => Date.now());
    const memorySyncRef = useRef<ReturnType<typeof startMemorySync> | null>(null);
    const flushPendingMemory = useCallback(async () => {
        await memorySyncRef.current?.queue.flush();
    }, []);
    const decisionRef = useRef<CapturedDecision | null>(null);
    const answerDiagnosticRef = useRef<AnswerEvent | null>(null);
    const schedulerRef = useRef<SchedulerState | null>(null);
    const exposureGapAtStartRef = useRef<number | null>(null);
    const expectedTypingAtStartRef = useRef(0);
    const predictedRetrievabilityAtPromptRef = useRef<number | null>(null);
    const authenticatedUserIdRef = useRef<string | null>(null);
    const memoryReadFailedRef = useRef(false);
    const [memoryReady, setMemoryReady] = useState(false);
    const [memoryError, setMemoryError] = useState<string | null>(null);

    const [currentItem, setCurrentItem] = useState<Item | null>(null);
    const [nextReviewAt, setNextReviewAt] = useState<number | null>(null);
    const currentItemRef = useRef<Item | null>(null);
    const [isStarted, setIsStarted] = useState(false);
    const [showInstructions, setShowInstructions] = useState(true);
    const [notice, setNotice] = useState<GameNoticeProps>();
    const [isPaused, setIsPaused] = useState(false);
    const [currentInput, setCurrentInput] = useState("");

    const sessionTurnNumberRef = useRef(0);
    const [itemPresentationKey, setItemPresentationKey] = useState(0);
    const [slidePresentationKey, setSlidePresentationKey] = useState<number | null>(null);
    const recallProgressRef = useRef<RecallProgress | null>(null);
    const [isSignedIn, setIsSignedIn] = useState(false);
    const userReviewCountRef = useRef(0);
    const initialGameStartedRef = useRef(false);
    const userTypingDelayRef = useRef(DEFAULT_TYPING_DELAY_MS);
    const previousInputAtRef = useRef<number | null>(null);
    const previousInputLengthRef = useRef(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const successAudioRef = useRef<HTMLAudioElement | null>(null);
    const answerSpeechRef = useRef<SpeechSynthesisUtterance | null>(null);
    const [answerSpeechVersion, setAnswerSpeechVersion] = useState(0);

    useEffect(() => {
        if (!notice?.visible) return;

        const timer = window.setTimeout(() => {
            setNotice((current) =>
                current ? { ...current, visible: false } : undefined,
            );
        }, 5000);

        return () => window.clearTimeout(timer);
    }, [notice?.visible, notice?.title, notice?.description]);

    useEffect(() => {
        let cancelled = false;
        const itemIds = items.map((item) => item.id);
        const itemIdSet = new Set(itemIds);

        const initializeFallback = (userId: string | null) => {
            authenticatedUserIdRef.current = userId;
            // A failed read means the existing history is unknown. Keep this
            // session's observations local until a later read can reconcile it.
            memoryReadFailedRef.current = true;

            const fallbackMemory: Record<string, ItemMemoryState> = {};
            if (userId) {
                memorySyncRef.current = startMemorySync(userId, room.id, "offline", false);
                memorySyncRef.current.queue.restore(fallbackMemory, itemIdSet);
                schedulerRef.current =
                    loadSchedulerState(
                        "playground",
                        userId,
                        room.id,
                        itemIds,
                        Date.now(),
                    ) ?? createScheduler(itemIds);
            } else {
                schedulerRef.current = createScheduler(itemIds);
            }

            memoryByItemRef.current = fallbackMemory;
            setMemoryByItem(fallbackMemory);
            setMemoryError(null);
            setMemoryReady(true);
            setNotice({
                visible: true,
                iconName: "info",
                title: "学習データを取得できませんでした",
                description: userId
                    ? "プレイは続けられます。学習履歴を保護するため、このセッションの進捗は保存されません。通信復旧後に再読み込みしてください。"
                    : "プレイは続けられますが、学習データを保存できません。通信復旧後に再読み込みしてください。",
            });
        };

        const loadMemory = async () => {
            let loaded: Awaited<ReturnType<typeof loadPlaygroundMemory>>;
            try {
                loaded = await loadPlaygroundMemory(room.id, itemIds);
            } catch (error) {
                if (cancelled) return;
                const message =
                    error instanceof Error ? error.message : String(error);
                console.error("Failed to load playground memory", message);
                posthog.capture("playground_memory_load_failed", {
                    room_id: room.id,
                });
                initializeFallback(null);
                return;
            }
            if (cancelled) return;

            if (loaded.error) {
                const message = loaded.error.message || "Unknown error";
                console.error("Failed to load playground memory", message);
                posthog.capture("playground_memory_load_failed", {
                    room_id: room.id,
                });
                if (loaded.userId) setIsSignedIn(true);
                initializeFallback(loaded.userId);
                return;
            }

            setIsSignedIn(Boolean(loaded.userId));
            // A legacy schema can be read, but must not be overwritten until
            // answer_mode_stats has been migrated into the database.
            const legacySchema =
                "persistenceDisabled" in loaded &&
                loaded.persistenceDisabled === true;
            memoryReadFailedRef.current = false;

            if (!loaded.userId) {
                authenticatedUserIdRef.current = null;
                const saved = loadGuestMemory(room.id, itemIdSet);
                memoryByItemRef.current = saved;
                schedulerRef.current =
                    loadSchedulerState(
                        "playground",
                        GUEST_MEMORY_USER_ID,
                        room.id,
                        itemIds,
                        Date.now(),
                    ) ?? createScheduler(itemIds);
                setMemoryByItem(saved);
                setMemoryReady(true);
                return;
            }

            authenticatedUserIdRef.current = loaded.userId;
            if (legacySchema) {
                setNotice({
                    visible: true,
                    iconName: "info",
                    title: "データベースの更新が必要です",
                    description:
                        "今回の進捗は端末に保存されます。データベースの更新後に同期されます。",
                });
            }
            memorySyncRef.current = startMemorySync(loaded.userId, room.id, "offline", !legacySchema);
            memorySyncRef.current.queue.restore(loaded.memoryByItem, itemIdSet);
            memoryByItemRef.current = loaded.memoryByItem;
            schedulerRef.current =
                loadSchedulerState(
                    "playground",
                    loaded.userId,
                    room.id,
                    itemIds,
                    Date.now(),
                ) ?? createScheduler(itemIds);
            setMemoryByItem(loaded.memoryByItem);
            setMemoryReady(true);
        };

        void loadMemory();

        return () => {
            cancelled = true;
            memorySyncRef.current?.stop();
            memorySyncRef.current = null;
        };
    }, [room.id, items, answerMode]);

    const setTrackedItem = useCallback((item: Item | null, slide = false) => {
        currentItemRef.current = item;
        setCurrentItem(item);
        recallProgressRef.current = null;
        if (!item) return;

        sessionTurnNumberRef.current += 1;
        setItemPresentationKey(sessionTurnNumberRef.current);
        setSlidePresentationKey(slide ? sessionTurnNumberRef.current : null);
        const memory = memoryByItemRef.current[item.id];
        predictedRetrievabilityAtPromptRef.current =
            memory && memory.reviewCount > 0 && memory.lastReviewedAt
                ? getRetrievability(memory)
                : null;
        exposureGapAtStartRef.current = getExposureGap(
            memory,
            itemModes[item.id] ?? answerMode,
            Date.now(),
        );
        expectedTypingAtStartRef.current =
            (getTypingAnswer(item)?.length ?? item.answer.length) *
            userTypingDelayRef.current;
    }, [answerMode, itemModes]);

    const chooseItemForTurn = useCallback(() => {
        const scheduler =
            schedulerRef.current ??
            (schedulerRef.current = createScheduler(
                items.map((item) => item.id),
            ));
        const id = chooseNextUserItem(
            scheduler,
            memoryByItemRef.current,
            Math.random,
            Date.now(),
            answerMode,
            itemModes,
            LEARNING_DIAGNOSTICS_ENABLED ? trace => {
                try {
                    decisionRef.current = captureDecision(trace, memoryByItemRef.current, itemModes, answerDiagnosticRef.current);
                } catch { decisionRef.current = null; }
            } : undefined,
        )?.itemId;
        if (!memoryReadFailedRef.current) {
            saveSchedulerState(
                "playground",
                authenticatedUserIdRef.current ?? GUEST_MEMORY_USER_ID,
                room.id,
                scheduler,
            );
        }
        return items.find((item) => item.id === id) ?? null;
    }, [items, room.id, answerMode, itemModes]);

    const resolveTurnWithItem = useCallback(() => {
        const item = chooseItemForTurn();
        if (!item) {
            setNextReviewAt(
                schedulerRef.current
                    ? nextMemoryReviewAt(
                          schedulerRef.current,
                          memoryByItemRef.current,
                          Date.now(),
                          answerMode,
                          itemModes,
                      ) ?? nextSuspendedReviewAt(schedulerRef.current)
                    : null,
            );
            setIsStarted(false);
            void flushPendingMemory();
        }
        return item;
    }, [chooseItemForTurn, answerMode, itemModes, flushPendingMemory]);

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

        startGame();
    }, [items.length, memoryReady, room.id, startGame, users.length]);

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
                !isGameSpaceKeyDown(event)
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
                authenticatedUserIdRef.current ??
                (memoryReadFailedRef.current
                    ? SESSION_MEMORY_USER_ID
                    : GUEST_MEMORY_USER_ID);

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
                    suspended_until: new Date(
                        currentStruggle.suspendedUntil,
                    ).toISOString(),
                });
            }
            const freshestMemory =
                authenticatedUserIdRef.current ||
                memoryReadFailedRef.current
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

            if (LEARNING_DIAGNOSTICS_ENABLED) answerDiagnosticRef.current = {
                at: Date.now(), itemId: item.id, mode: "input", evaluation,
                evidence: { success: evidence.success, firstAttemptCorrect: evidence.firstAttemptCorrect,
                    hintCount: evidence.hintCount, answerWasFullyRevealed: evidence.answerWasFullyRevealed,
                    incorrectInputCount: evidence.incorrectInputCount, elapsedMs: evidence.elapsedMs,
                    exposureGapMs: evidence.elapsedSincePresentationMs, initialCueRatio: evidence.initialCueRatio,
                    finalCueRatio: evidence.finalCueRatio, recallLatencyMs: evidence.recallLatencyMs,
                    expectedTypingMs: evidence.expectedTypingMs },
                before: freshestMemory[item.id], after: nextMemory,
                schedulerAfter: scheduler ? structuredClone(scheduler) : null,
            };
            let nextMemoryByItem = {
                ...freshestMemory,
                [item.id]: nextMemory,
            };

            if (authenticatedUserIdRef.current && memorySyncRef.current && !memoryReadFailedRef.current) {
                memorySyncRef.current.queue.enqueue(nextMemory);
            } else if (
                !authenticatedUserIdRef.current &&
                !memoryReadFailedRef.current
            ) {
                nextMemoryByItem = saveGuestMemory(room.id, nextMemoryByItem);
            }
            memoryByItemRef.current = nextMemoryByItem;
            setMemoryByItem(nextMemoryByItem);
            setMasteryNow(Date.now());
            if (scheduler && !memoryReadFailedRef.current)
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

    const updateAnswerModeMemory = useCallback(
        (
            item: Item,
            mode: "selection" | "input",
            success: boolean,
            responseMs: number | null = null,
            usedHint = false,
            exposureGapMs?: number | null,
        ) => {
            const userId =
                authenticatedUserIdRef.current ??
                (memoryReadFailedRef.current
                    ? SESSION_MEMORY_USER_ID
                    : GUEST_MEMORY_USER_ID);
            const freshestMemory =
                authenticatedUserIdRef.current ||
                memoryReadFailedRef.current
                    ? memoryByItemRef.current
                    : mergeGuestMemory(
                          memoryByItemRef.current,
                          loadGuestMemory(
                              room.id,
                              new Set(items.map((entry) => entry.id)),
                          ),
                      );
            const updated = recordAnswerModeResult({
                memory: freshestMemory[item.id],
                userId,
                roomId: room.id,
                itemId: item.id,
                mode,
                success,
                responseMs,
                usedHint,
                choiceCount,
                exposureGapMs,
            });
            if (LEARNING_DIAGNOSTICS_ENABLED && mode === "selection") answerDiagnosticRef.current = {
                at: Date.now(), itemId: item.id, mode,
                evidence: { success, firstAttemptCorrect: success, hintCount: usedHint ? 1 : 0,
                    elapsedMs: responseMs ?? undefined, exposureGapMs, choiceCount },
                evaluation: evaluateRecognition(!success, exposureGapMs),
                before: freshestMemory[item.id], after: updated,
                schedulerAfter: schedulerRef.current ? structuredClone(schedulerRef.current) : null,
            };
            let nextMemoryByItem = {
                ...freshestMemory,
                [item.id]: updated,
            };
            if (authenticatedUserIdRef.current && memorySyncRef.current && !memoryReadFailedRef.current) {
                memorySyncRef.current.queue.enqueue(updated);
            } else if (
                !authenticatedUserIdRef.current &&
                !memoryReadFailedRef.current
            ) {
                nextMemoryByItem = saveGuestMemory(room.id, nextMemoryByItem);
            }
            memoryByItemRef.current = nextMemoryByItem;
            setMemoryByItem(nextMemoryByItem);
            setMasteryNow(Date.now());
            return updated;
        },
        [room.id, items, choiceCount],
    );

    const handleRecallProgress = useCallback((progress: RecallProgress) => {
        recallProgressRef.current = progress;
    }, []);

    const handleRecallComplete = useCallback(
        (observation: RecallObservation) => {
            const item = currentItemRef.current;
            if (!item || isPaused) return;

            updateLocalMemory(item, observation);
        },
        [isPaused, updateLocalMemory],
    );

    const handleInputChange = useCallback(
        (input: string, failed?: boolean) => {
            if (failed && !isPaused && currentItemRef.current) {
                updateAnswerModeMemory(currentItemRef.current, "input", false);
            }
            const now = Date.now();
            const previousLength = previousInputLengthRef.current;
            const previousInputAt = previousInputAtRef.current;
            const addedCharacters = input.length - previousLength;

            if (addedCharacters > 0 && previousInputAt !== null) {
                const sampleDelay = (now - previousInputAt) / addedCharacters;

                if (sampleDelay > 0 && sampleDelay < 2000) {
                    const clampedSample = clampTypingDelay(sampleDelay);
                    userTypingDelayRef.current =
                        userTypingDelayRef.current *
                            (1 - TYPING_SPEED_SMOOTHING) +
                        clampedSample * TYPING_SPEED_SMOOTHING;
                }
            }

            previousInputLengthRef.current = input.length;
            previousInputAtRef.current = input.length === 0 ? null : now;
            setCurrentInput(input);
        },
        [isPaused, updateAnswerModeMemory],
    );

    const handleSelectionAnswer = useCallback(
        (
            correct: boolean,
            hadMistake: boolean,
            responseMs: number | null,
            usedHint = false,
        ) => {
            const item = currentItemRef.current;
            if (!item || isPaused || !correct) return;
            const scheduler = schedulerRef.current;
            if (scheduler) {
                if (choiceCount < 2) scheduler.current = null;
                else recordRecognitionAnswer(
                    scheduler, item.id, hadMistake, Date.now(), exposureGapAtStartRef.current,
                );
                if (!memoryReadFailedRef.current) {
                    saveSchedulerState(
                        "playground",
                        authenticatedUserIdRef.current ?? GUEST_MEMORY_USER_ID,
                        room.id,
                        scheduler,
                    );
                }
            }
            recallProgressRef.current = null;
            // One completed question is one recognition attempt. A correct
            // answer reached after eliminating wrong options is not a clean hit.
            updateAnswerModeMemory(
                item,
                "selection",
                !hadMistake,
                responseMs,
                usedHint,
                exposureGapAtStartRef.current,
            );
        },
        [isPaused, room.id, updateAnswerModeMemory, choiceCount],
    );

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
            readAnswer &&
            presentedItem.answer.trim() &&
            typeof window !== "undefined" &&
            "speechSynthesis" in window &&
            typeof SpeechSynthesisUtterance !== "undefined"
        ) {
            const synthesis = window.speechSynthesis;
            answerSpeechRef.current = null;
            synthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(
                presentedItem.answer,
            );
            utterance.lang = getSpeechLanguage(presentedItem.answer, "answer", window.navigator?.language);
            answerSpeechRef.current = utterance;
            const finishAnswerSpeech = () => {
                if (answerSpeechRef.current !== utterance) return;
                answerSpeechRef.current = null;
                setAnswerSpeechVersion((version) => version + 1);
            };
            utterance.onend = finishAnswerSpeech;
            utterance.onerror = finishAnswerSpeech;
            synthesis.speak(utterance);
        }

        setCurrentInput("");
        previousInputAtRef.current = null;
        previousInputLengthRef.current = 0;
        setTrackedItem(resolveTurnWithItem(), true);

        posthog.capture(
            wasAnswerRevealed ? "word_reviewed" : "word_succeeded",
            { mode: "playground", room_id: room.id },
        );
    }, [
        isPaused,
        soundEffects,
        readAnswer,
        getSpeechLanguage,
        resolveTurnWithItem,
        room.id,
        setTrackedItem,
    ]);

    useEffect(() => {
        if (
            !isStarted ||
            isPaused ||
            !currentItem ||
            !voiceSettingsReady ||
            !readQuestion
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

        // The next question is visible immediately, but its audio waits
        // until the preceding answer has finished.
        if (answerSpeechRef.current) return;

        const synthesis = window.speechSynthesis;
        synthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = getSpeechLanguage(text, "prompt", window.navigator?.language);
        synthesis.speak(utterance);

        // Do not cancel the answer utterance when the item changes.
        return () => {
            if (!answerSpeechRef.current) synthesis.cancel();
        };
    }, [
        currentItem,
        isStarted,
        itemPresentationKey,
        readQuestion,
        getSpeechLanguage,
        voiceSettingsReady,
        isPaused,
        answerSpeechVersion,
    ]);

    useEffect(() => {
        if (
            (!isStarted || isPaused) &&
            typeof window !== "undefined" &&
            "speechSynthesis" in window
        ) {
            answerSpeechRef.current = null;
            window.speechSynthesis.cancel();
        }
    }, [isStarted, isPaused]);

    useEffect(() => {
        return () => {
            if (typeof window !== "undefined" && "speechSynthesis" in window)
                window.speechSynthesis.cancel();
        };
    }, []);

    // Recompute time-decayed predictions without answers; refresh on tab return.
    useEffect(() => {
        if (!memoryReady || !isStarted) return;
        const refresh = () => setMasteryNow(Date.now());
        refresh();
        const timer = window.setInterval(refresh, 30_000);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [memoryReady, isStarted]);

    const masteryGraph = useMemo(
        () =>
            getMasteryGraph(
                masteryItemIds,
                memoryByItem,
                masteryNow,
                answerMode,
                itemModes,
                LEARNING_DIAGNOSTICS_ENABLED,
            ),
        [masteryItemIds, memoryByItem, masteryNow, answerMode, itemModes],
    );

    const currentTurnPlan = useMemo(
        () =>
            currentItem ? createTurnPlan(memoryByItem[currentItem.id]) : null,
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
                slideQuestion={slidePresentationKey === itemPresentationKey}
                currentInput={currentInput}
                isStarted={isStarted}
                preGameContent={
                    memoryReady && nextReviewAt !== null ? (
                        <div className="flex flex-col gap-4 px-2" role="status">
                            <p className="font-bold">
                                すべての単語が復習待ちです
                            </p>
                            <p>
                                新しい単語の導入を止め、復習期限を待っています。 次の復習は
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
                                onClick={() =>
                                    router.push("/" + (room.link ?? room.id))
                                }
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
                                {requestedAnswerMode === "card" ? (
                                    <div className="flex gap-2">
                                        <span className="shrink-0">
                                            <Icon name="lightbulb" />
                                        </span>
                                        <span data-cursor="text">
                                            斜線部分をタップ、またはEnterキーで解答を表示します。
                                            不正解は左矢印キーまたは1、正解は右矢印キーまたは2で選択できます。
                                            分からない場合はスペースキーを2回押してください。
                                        </span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex gap-2">
                                            <span className="shrink-0">
                                                <Icon name="keyboard" />
                                            </span>
                                            <span data-cursor="text">
                                                入力問題では、英語・日本語ともに
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
                                    </>
                                )}
                                {!isSignedIn && (
                                    <div className="flex gap-2">
                                        <span className="shrink-0">
                                            <Icon name="user" />
                                        </span>
                                        <span data-cursor="text">
                                            サインインすることで、ブラウザを超えて単語の学習データが同期されます。
                                        </span>
                                    </div>
                                )}
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
                answerMode={requestedAnswerMode}
                masteryProgress={
                    <OfflineMasteryProgress
                        progress={masteryGraph.totals}
                        itemIds={masteryItemIds}
                        memories={memoryByItem}
                        answerMode={answerMode}
                        modes={itemModes}
                    />
                }
                onSelectionAnswer={handleSelectionAnswer}
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
            <header className="absolute top-0 right-0 flex justify-end p-4 gap-4">
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
                <GameSettings
                    getLearningDiagnostic={LEARNING_DIAGNOSTICS_ENABLED ? () =>
                        diagnosticJSON(decisionRef.current, masteryGraph, items.map(item => item.id)) : undefined}
                    backgroundMusic={backgroundMusic}
                    soundEffects={soundEffects}
                    readQuestion={readQuestion}
                    readAnswer={readAnswer}
                    onReadQuestionChange={(next) => updateVoiceSetting("question", next)}
                    onReadAnswerChange={(next) => updateVoiceSetting("answer", next)}
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
