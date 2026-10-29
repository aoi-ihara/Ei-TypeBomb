"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import type { Item, Position, Room, User } from "@/type";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import GameView from "@/components/feature/GameView";
import type { GameNoticeProps } from "@/components/feature/GameNotice";
import Button from "@/components/ui/Button";
import GameSettings from "@/components/layout/GameSettings";
import OfflineVoicePicker from "@/components/layout/OfflineVoicePicker";
import type { OfflineVoiceReading } from "@/lib/settings";
import { newPositions } from "@/lib/ui/position";
import { useFeatureFlagPayload } from "@posthog/react";
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
import { getBotTypingFrames } from "@/lib/playground/bot-typing.mjs";

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
    } catch {
        // Storage may be unavailable or full; practice remains playable.
    }
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
    initialOfflineVoiceReading,
}: Readonly<Props>) {
    const bombDurationVariant = useFeatureFlagPayload("bomb-duration");
    const configuredBombDuration =
        typeof bombDurationVariant === "string"
            ? Number(bombDurationVariant)
            : Number.NaN;
    const bombDurationSeconds =
        Number.isFinite(configuredBombDuration) && configuredBombDuration > 0
            ? configuredBombDuration
            : 30;
    const router = useRouter();
    const { bombRef, explode, resetExplosion, explosionLayer } =
        useBombExplosion();

    const [displayName, setDisplayName] = useState("あなた");
    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [soundEffects, setSoundEffects] = useState(initialSounDeffects);
    const offlineVoiceReading = initialOfflineVoiceReading;
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

    // ...rest of existing game logic...

    const activeLearningPlan =
        currentTurnUser?.id === LOCAL_USER_ID ? currentTurnPlan : null;

    return (
        <>
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
                notice={notice}
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
                onCreateRoom={() => {
                    startNavigationProgress();
                    router.push(getSignInUrl());
                }}
                enableRemoteTypingSync={false}
                stopRecommended={stopRecommended}
                onStop={() => {
                    void flushPendingMemory().finally(() => {
                        startNavigationProgress();
                        router.push("/" + room.id);
                    });
                }}
                resultExtraActions={
                    <>
                        {guestMode && (
                            <p
                                role="status"
                                className="text-sm text-center opacity-70"
                            >
                                ゲストプレイ中：学習データはこのブラウザに保存されます。ブラウザのデータを削除すると失われ、他の端末には同期されません。
                            </p>
                        )}
                        {saveError && (
                            <p role="status">
                                学習データは保存待ちです。接続が戻ると再送します。
                            </p>
                        )}
                        <Button
                            iconName="link"
                            className="w-full"
                            onClick={() => {
                                void flushPendingMemory().finally(() => {
                                    startNavigationProgress();
                                    router.push("/room");
                                });
                            }}
                        >
                            別のルームを選択
                        </Button>
                    </>
                }
            />
            <header className="w-full flex absolute justify-end p-4 gap-4">
                <div className="w-18 shrink-0">
                    <OfflineVoicePicker initialValue={offlineVoiceReading} />
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
