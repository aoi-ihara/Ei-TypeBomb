"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { io } from "@/lib/room/socket";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import GameView from "@/components/feature/GameView";
import type { GameNoticeProps } from "@/components/feature/GameNotice";
import { Item, LegacyWord, Room, User } from "@/type";
import { getAuthToken } from "@/lib/room/auth";
import { isTrustedServerUrl, resolveServerUrl } from "@/lib/room/serverUrl";
import { Position } from "@/type";
import { newPositions } from "@/lib/ui/position";
import posthog from "posthog-js";
import { legacyWireWordsToItems } from "@/lib/item";
import { loadPlaygroundMemory, syncPlaygroundMemory } from "@/lib/playground/memory-client";
import type { RecallObservation } from "@/lib/playground/memory";
import {
    createOnlineMemorySession,
    cacheOnlinePendingMemory,
    loadOnlinePendingMemory,
    loadOnlineGuestMemory,
    nextOnlineRecommendation,
    recordOnlineRecall,
    type OnlineMemorySession,
} from "@/lib/online/memory-session";

type Props = {
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
};

const SERVER_FAILOVER_TIMEOUT_MS = 5_000;
const MAX_CURRENT_INPUT_LENGTH = 32;

export default function Clinet({
    initialBackgroundMusic,
    initialSounDeffects,
}: Props) {
    const { bombRef, explode, resetExplosion, explosionLayer } =
        useBombExplosion();
    const [userId, setUserId] = useState<string | null>(null);
    const userIdRef = useRef<string | null>(null);
    const gameNumberRef = useRef(0);

    const [room, setRoom] = useState<Room | null>(null);
    const [serverError, setServerError] = useState<string | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [currentItem, setCurrentItem] = useState<Item | null>(null);
    const [currentTurn, setCurrentTurn] = useState<number>(0);
    const [displayName] = useState<string>(() => {
        if (typeof window === "undefined") return "";
        return localStorage.getItem("display-name") ?? "";
    });
    const [bombStatus, setBombStatus] = useState<number | null>(0);

    const socketRef = useRef<ReturnType<typeof io> | null>(null);
    const onlineMemoryRef = useRef<OnlineMemorySession | null>(null);
    const memoryFlushRef = useRef<Promise<void> | null>(null);
    const [onlineMemoryReady, setOnlineMemoryReady] = useState(0);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blipAudioRef = useRef<HTMLAudioElement | null>(null);
    const powerupAudioRef = useRef<HTMLAudioElement | null>(null);

    const [isStarted, setIsStarted] = useState<boolean>(false);
    const router = useRouter();
    const [isSpectator, setIsSpectator] = useState<boolean>(false);
    const [notice, setNotice] = useState<GameNoticeProps>({
        visible: false,
        iconName: "globeOff",
        title: "接続が切れました",
        description: "プレイヤーがルームから退出しました。",
    });
    const [result, setResult] = useState<boolean | null>(null);
    const [currentInput, setCurrentInput] = useState("");
    const [hintLengths, setHintLengths] = useState<Record<string, number>>({});
    const [failureCount, setFailureCount] = useState(0);
    const [lostDisplayName, setLostDisplayName] = useState<string | null>();
    const [loserNames, setLoserNames] = useState<string[]>([]);
    const [sharedFocusPlayerId, setSharedFocusPlayerId] = useState<string | null>(null);
    const viewedHolderIdRef = useRef<string | null>(null);
    const [userPositions, setUserPositions] = useState<Position[]>(
        Array.from({ length: 6 }, () => ({
            x: 0,
            y: 0,
            w: 24,
            h: 24,
            opacity: 0,
        })),
    );

    // Upserts are serialized so a slow network response cannot overwrite a
    // newer answer. Failed writes remain queued for the next retry.
    const flushOnlineMemory = useCallback(async () => {
        if (memoryFlushRef.current) return memoryFlushRef.current;
        const session = onlineMemoryRef.current;
        if (!session?.userId || session.pending.size === 0) return;
        const operation = (async () => {
            while (session.pending.size > 0) {
                const snapshot = [...session.pending.values()];
                try {
                    const error = await syncPlaygroundMemory(snapshot);
                    if (error) throw error;
                    for (const saved of snapshot) {
                        if (session.pending.get(saved.itemId) === saved)
                            session.pending.delete(saved.itemId);
                    }
                    cacheOnlinePendingMemory(session);
                } catch (error) {
                    console.error("Online memory sync failed", error);
                    cacheOnlinePendingMemory(session);
                    break;
                }
            }
        })();
        memoryFlushRef.current = operation;
        try {
            await operation;
        } finally {
            memoryFlushRef.current = null;
        }
    }, []);

    // A room uses the very same memory rows (or guest localStorage key) as
    // Playground, but starts its own transient per-player scheduling session.
    const memoryRoomId = room?.id;
    useEffect(() => {
        if (!room || !memoryRoomId) return;
        let cancelled = false;
        const itemIds = (room.items ?? []).map(item => item.id);
        const load = async () => {
            const result = await loadPlaygroundMemory(memoryRoomId);
            if (cancelled) return;
            if (result.error) {
                console.error("Online memory load failed", result.error);
                return; // Keep the game's random fallback rather than overwriting data.
            }
            const memory = result.userId
                ? result.memoryByItem
                : loadOnlineGuestMemory(memoryRoomId, itemIds);
            const session = createOnlineMemorySession(
                memoryRoomId, itemIds, result.userId, memory,
            );
            if (result.userId) {
                // Playground and online play share the same unsent-write queue.
                for (const pending of loadOnlinePendingMemory(
                    memoryRoomId, result.userId, itemIds,
                )) {
                    const remote = session.memory[pending.itemId];
                    if (!remote ||
                        (Date.parse(pending.updatedAt ?? "") || 0) >=
                            (Date.parse(remote.updatedAt ?? "") || 0)) {
                        session.memory[pending.itemId] = pending;
                        session.pending.set(pending.itemId, pending);
                    }
                }
            }
            onlineMemoryRef.current = session;
            setOnlineMemoryReady(n => n + 1);
            void flushOnlineMemory();
        };
        void load();
        return () => {
            cancelled = true;
            if (onlineMemoryRef.current?.roomId === memoryRoomId)
                onlineMemoryRef.current = null;
        };
        // The item catalog is fixed within a room. Broadcast revisions must not
        // reset scheduler progress or restart the asynchronous memory load.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [memoryRoomId]);

    useEffect(() => {
        const session = onlineMemoryRef.current;
        if (!session || session.roomId !== room?.id || !userId ||
            !users.some(player => player.id === userId)) return;
        const itemId = nextOnlineRecommendation(session);
        if (itemId) socketRef.current?.emit("item:recommend", { itemId });
    }, [room, userId, users, onlineMemoryReady]);

    useEffect(() => {
        const retry = () => {
            const session = onlineMemoryRef.current;
            if (session) cacheOnlinePendingMemory(session);
            void flushOnlineMemory();
        };
        const interval = setInterval(retry, 5_000);
        const visibility = () => {
            if (document.visibilityState === "hidden") retry();
        };
        window.addEventListener("online", retry);
        window.addEventListener("pagehide", retry);
        document.addEventListener("visibilitychange", visibility);
        return () => {
            clearInterval(interval);
            window.removeEventListener("online", retry);
            window.removeEventListener("pagehide", retry);
            document.removeEventListener("visibilitychange", visibility);
            retry();
        };
    }, [flushOnlineMemory]);

    useEffect(() => {
        blipAudioRef.current = new Audio("/Blip_select_8.wav");
        powerupAudioRef.current = new Audio("/Powerup_1.wav");

        // SOCKET
        const primaryUrl = resolveServerUrl();
        const secondaryUrl = process.env.NEXT_PUBLIC_SECONDARY_SERVER_URL;
        const fallbackUrl = process.env.NEXT_PUBLIC_FALLBACK_SERVER_URL;

        let selected = false;
        let failoverStarted = false;
        let secondaryUnavailable = false;
        let primaryTimer: ReturnType<typeof setTimeout> | null = null;
        let secondaryTimer: ReturnType<typeof setTimeout> | null = null;
        let noticeTimer: ReturnType<typeof setTimeout> | null = null;

        const showNotice = (nextNotice: Omit<GameNoticeProps, "visible">) => {
            if (noticeTimer) clearTimeout(noticeTimer);

            setNotice({
                ...nextNotice,
                visible: true,
            });

            noticeTimer = setTimeout(() => {
                setNotice((current) => ({
                    ...current,
                    visible: false,
                }));
                noticeTimer = null;
            }, 3000);
        };

        type ServerTier = "primary" | "secondary" | "fallback";
        type Candidate = {
            socket: ReturnType<typeof io>;
            ready: boolean;
            url: string | undefined;
            tier: ServerTier;
            startedAt: number;
        };

        const primarySocket = io(primaryUrl, {
            reconnection: false,
            timeout: SERVER_FAILOVER_TIMEOUT_MS,
        });
        const primaryCandidate: Candidate = {
            socket: primarySocket,
            ready: false,
            url: primaryUrl,
            tier: "primary",
            startedAt: performance.now(),
        };

        let secondaryCandidate: Candidate | null = null;
        let fallbackCandidate: Candidate | null = null;

        const authenticate = async (candidate: Candidate) => {
            const socket = candidate.socket;
            setUserId(socket.id ?? null);
            userIdRef.current = socket.id ?? null;

            const authToken = await getAuthToken();
            if (!authToken || !selected || socketRef.current !== socket) return;

            // Never disclose the authentication token to an untrusted origin.
            if (!isTrustedServerUrl(candidate.url, primaryUrl)) return;

            socket.emit("auth:response", {
                jwtToken: authToken,
                displayName: displayName,
            });
        };

        const clearPrimaryTimer = () => {
            if (!primaryTimer) return;
            clearTimeout(primaryTimer);
            primaryTimer = null;
        };

        const clearSecondaryTimer = () => {
            if (!secondaryTimer) return;
            clearTimeout(secondaryTimer);
            secondaryTimer = null;
        };

        const selectCandidate = (candidate: Candidate) => {
            if (selected) return;

            selected = true;
            clearPrimaryTimer();
            clearSecondaryTimer();
            socketRef.current = candidate.socket;

            for (const other of [
                primaryCandidate,
                secondaryCandidate,
                fallbackCandidate,
            ]) {
                if (other && other.socket !== candidate.socket) {
                    other.socket.disconnect();
                }
            }

            const connectionTimeMs = Math.round(
                performance.now() - candidate.startedAt,
            );

            if (candidate.tier === "primary") {
                console.info("Connected to primary server.");
                posthog.capture("primary_server_connected", {
                    connection_time_ms: connectionTimeMs,
                });
            } else if (candidate.tier === "secondary") {
                console.warn(
                    "Primary server unavailable. Switching to secondary server.",
                );
                posthog.capture("secondary_server_connected", {
                    connection_time_ms: connectionTimeMs,
                });
                if (process.env.NEXT_PUBLIC_DEVELOPER_MODE === "true") {
                    showNotice({
                        iconName: "serverOff",
                        title: "セカンダリサーバーに切り替えました",
                        description:
                            "プライマリサーバーに接続できなかったため、セカンダリサーバーを使用しています。",
                    });
                }
            } else {
                console.warn(
                    "Primary and secondary servers unavailable. Switching to fallback server.",
                );
                posthog.capture("fallback_server_connected", {
                    connection_time_ms: connectionTimeMs,
                });
                if (process.env.NEXT_PUBLIC_DEVELOPER_MODE === "true") {
                    showNotice({
                        iconName: "serverOff",
                        title: "フォールバックサーバーに切り替えました",
                        description:
                            "プライマリとセカンダリに接続できなかったため、フォールバックサーバーを使用しています。",
                    });
                }
            }

            if (candidate.ready) {
                void authenticate(candidate);
            }
        };

        const maybeSelectFallback = () => {
            if (
                selected ||
                !secondaryUnavailable ||
                !fallbackCandidate?.ready
            ) {
                return;
            }

            selectCandidate(fallbackCandidate);
        };

        const markSecondaryUnavailable = () => {
            if (selected || secondaryUnavailable) return;

            secondaryUnavailable = true;
            clearSecondaryTimer();
            secondaryCandidate?.socket.disconnect();
            maybeSelectFallback();
        };

        const attachSocketListeners = (candidate: Candidate) => {
            const { socket } = candidate;

            socket.on("connect_error", () => {
                if (selected) return;

                if (candidate.tier === "primary") {
                    startFailover();
                } else if (candidate.tier === "secondary") {
                    markSecondaryUnavailable();
                }
            });

            socket.on("error", (error: { message?: unknown } | null) => {
                if (!selected || socketRef.current !== socket) return;
                if (typeof error?.message !== "string" || !error.message.trim())
                    return;
                setServerError(error.message);
            });

            socket.on(
                "room:broadcast",
                (
                    newRoom: Room & {
                        words?: LegacyWord[];
                        users: User[];
                        isStart: boolean;
                        bombHolder: number;
                        wordIndex: number;
                        bombStatus: number;
                    },
                ) => {
                    if (!selected || socketRef.current !== socket) return;
                    setServerError(null);
                    const normalizedItems =
                        newRoom.items ?? legacyWireWordsToItems(newRoom.words);
                    const normalizedRoom: Room = {
                        ...newRoom,
                        items: normalizedItems,
                    };
                    setRoom(normalizedRoom);
                    setHintLengths(Object.fromEntries((newRoom.bombs ?? []).map(bomb => [
                        bomb.id,
                        bomb.hintLength ?? 0,
                    ]).filter(([id]) => !!id)));
                    setUsers(
                        newRoom.users.map((item) => {
                            return {
                                id: item.id,
                                displayName: item.displayName,
                            };
                        }),
                    );
                    setIsStarted(newRoom.isStart);
                    setCurrentTurn(newRoom.bombHolder);
                    if (newRoom.wordIndex !== undefined) {
                        setCurrentItem(
                            normalizedItems[newRoom.wordIndex] ?? null,
                        );
                    } else {
                        setCurrentItem(null);
                    }
                    setBombStatus(newRoom.bombStatus);
                    const sharedPlayerId = newRoom.typingFocusPlayerId
                        ?? newRoom.users[newRoom.bombs?.[0]?.holder ?? newRoom.bombHolder]?.id
                        ?? null;
                    setSharedFocusPlayerId(sharedPlayerId);
                    viewedHolderIdRef.current = sharedPlayerId;
                    setCurrentInput(newRoom.typingFocusInput ?? "");
                    setUserPositions(
                        newPositions(newRoom.users, userPositions),
                    );
                },
            );

            socket.on("typing:input", ({
                input, failed, focusPlayerId,
            }: {
                input: string; failed?: boolean; focusPlayerId?: string;
            }) => {
                if (!selected || socketRef.current !== socket) return;
                // The server arbitrates the single shared display across typists.
                // All observers follow the same focus, not their own packet timing.
                if (focusPlayerId) {
                    viewedHolderIdRef.current = focusPlayerId;
                    setSharedFocusPlayerId(focusPlayerId);
                }
                setCurrentInput(input);
                if (failed) setFailureCount((count) => count + 1);
            });

            socket.on("hint:updated", ({ bombId, length }: { bombId: string; length: number }) => {
                if (!selected || socketRef.current !== socket) return;
                setHintLengths(current => ({ ...current, [bombId]: length }));
            });

            socket.on("game:quited", () => {
                if (!selected || socketRef.current !== socket) return;
                showNotice({
                    iconName: "globeOff",
                    title: "接続が切れました",
                    description: "プレイヤーがルームから退出しました。",
                });
                console.log("game quited");
                posthog.capture("game_quited");
            });

            socket.on("auth:request", () => {
                candidate.ready = true;

                if (!selected) {
                    if (candidate.tier === "primary") {
                        selectCandidate(candidate);
                    } else if (candidate.tier === "secondary") {
                        selectCandidate(candidate);
                    } else {
                        maybeSelectFallback();
                    }
                    return;
                }

                if (socketRef.current === socket) {
                    void authenticate(candidate);
                }
            });

            socket.on(
                "game:end",
                ({
                    holderUserId,
                    holderDisplayName,
                    losers,
                }: {
                    holderUserId: string;
                    holderDisplayName?: string;
                    losers?: { id: string; displayName?: string }[];
                }) => {
                    if (!selected || socketRef.current !== socket) return;
                    explode();
                    const didLose = losers
                        ? losers.some(loser => loser.id === userIdRef.current)
                        : userIdRef.current === holderUserId;
                    setResult(didLose);
                    setLostDisplayName(holderDisplayName ?? null);
                    setLoserNames(losers?.map(loser => loser.displayName ?? "プレイヤー") ?? []);

                    if (didLose) {
                        posthog.capture("game_lost", {
                            game_number: gameNumberRef.current,
                        });
                    } else {
                        posthog.capture("game_won", {
                            game_number: gameNumberRef.current,
                        });
                    }
                },
            );
        };

        const startFailover = () => {
            if (selected || failoverStarted) return;

            failoverStarted = true;
            clearPrimaryTimer();
            primarySocket.disconnect();

            if (secondaryUrl && secondaryUrl !== primaryUrl) {
                const socket = io(secondaryUrl, {
                    reconnection: false,
                    timeout: SERVER_FAILOVER_TIMEOUT_MS,
                });
                secondaryCandidate = {
                    socket,
                    ready: false,
                    url: secondaryUrl,
                    tier: "secondary",
                    startedAt: performance.now(),
                };
                attachSocketListeners(secondaryCandidate);
            } else {
                secondaryUnavailable = true;
            }

            if (
                fallbackUrl &&
                fallbackUrl !== primaryUrl &&
                fallbackUrl !== secondaryUrl
            ) {
                const socket = io(fallbackUrl, {
                    reconnection: false,
                    timeout: SERVER_FAILOVER_TIMEOUT_MS,
                });
                fallbackCandidate = {
                    socket,
                    ready: false,
                    url: fallbackUrl,
                    tier: "fallback",
                    startedAt: performance.now(),
                };
                attachSocketListeners(fallbackCandidate);
            }

            if (secondaryCandidate) {
                secondaryTimer = setTimeout(
                    markSecondaryUnavailable,
                    SERVER_FAILOVER_TIMEOUT_MS,
                );
            } else {
                maybeSelectFallback();
            }
        };

        attachSocketListeners(primaryCandidate);
        primaryTimer = setTimeout(startFailover, SERVER_FAILOVER_TIMEOUT_MS);

        return () => {
            clearPrimaryTimer();
            clearSecondaryTimer();
            if (noticeTimer) clearTimeout(noticeTimer);
            blipAudioRef.current?.pause();
            powerupAudioRef.current?.pause();
            primaryCandidate.socket.disconnect();
            secondaryCandidate?.socket.disconnect();
            fallbackCandidate?.socket.disconnect();
        };
    }, [explode]);

    const isFirstRoomRender = useRef(true);
    useEffect(() => {
        if (isFirstRoomRender.current) {
            isFirstRoomRender.current = false;
            return;
        }

        if (!initialSounDeffects) return;

        const audio = blipAudioRef.current;
        if (audio) {
            audio.currentTime = 0;
            audio.volume = 1;
            audio
                .play()
                .catch(() =>
                    console.log("Audio playback prevented by browser policy."),
                );
        }
    }, [users?.length, initialSounDeffects]);

    const isFirstBombRender = useRef(true);
    useEffect(() => {
        if (isFirstBombRender.current) {
            isFirstBombRender.current = false;
            return;
        }

        if (!initialSounDeffects) return;

        const audio = powerupAudioRef.current;
        if (audio) {
            audio.currentTime = 0;
            audio.volume = 1;
            audio
                .play()
                .catch(() =>
                    console.log("Audio playback prevented by browser policy."),
                );
        }
    }, [bombStatus, initialSounDeffects]);

    useEffect(() => {
        audioRef.current = new Audio("/MT-RD_17_for_Loop.wav");
        audioRef.current.loop = true;

        const startAudio = () => {
            if (initialBackgroundMusic && audioRef.current) {
                audioRef.current
                    .play()
                    .then(() => {
                        removeListeners();
                    })
                    .catch(() => {});
            }
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
            if (audioRef.current) {
                audioRef.current.pause();
            }
        };
    }, [router, initialBackgroundMusic, initialSounDeffects]);

    const handleJoin = (source: "join_button" | "play_again") => {
        console.log("join request");
        posthog.capture("room_join_clicked", { source });
        socketRef.current?.emit("room:join");
    };

    const handleWatch = () => {
        posthog.capture("room_watch_clicked");
        setIsSpectator(true);
    };

    const handleStartGame = () => {
        gameNumberRef.current += 1;
        posthog.capture("game_started", {
            player_count: users.length,
            game_number: gameNumberRef.current,
        });
        socketRef.current?.emit("game:start");
    };

    const handlePlayAgain = () => {
        resetExplosion();
        setResult(null);
        setLostDisplayName(null);
        setLoserNames([]);
        setCurrentInput("");
        setHintLengths({});
        setSharedFocusPlayerId(null);
        setIsSpectator(false);
    };

    const handleLeave = () => {
        socketRef.current?.emit("room:leave");
    };

    const focusedBomb = room?.bombs?.find(bomb => users[bomb.holder]?.id === userId)
        ?? room?.bombs?.find(bomb => users[bomb.holder]?.id === sharedFocusPlayerId)
        ?? room?.bombs?.[0];
    const focusedItem = focusedBomb
        ? (focusedBomb.wordIndex === undefined ? null : room?.items?.[focusedBomb.wordIndex] ?? null)
        : currentItem;

    return (
        <GameView
            room={room}
            users={users}
            positions={userPositions}
            userId={userId}
            currentTurn={focusedBomb?.holder ?? currentTurn}
            bombStatus={focusedBomb?.status ?? bombStatus ?? 0}
            currentItem={focusedItem}
            itemPresentationKey={focusedBomb ? focusedBomb.id + ":" + focusedBomb.turn : 0}
            currentInput={currentInput}
            remoteHintLength={hintLengths[focusedBomb?.id ?? ""] ?? focusedBomb?.hintLength ?? 0}
            onHintChange={(length) => socketRef.current?.emit("hint:update", { length })}
            failureCount={failureCount}
            isStarted={isStarted}
            isSpectator={isSpectator}
            serverError={serverError}
            notice={notice}
            result={result}
            lostDisplayName={lostDisplayName}
            loserNames={loserNames}
            loserIds={room?.losers?.map(loser => loser.id)}
            bombs={room?.bombs}
            enableRemoteTypingSync={false}
            bombRef={bombRef}
            explosionLayer={explosionLayer}
            onRecallComplete={(observation: RecallObservation) => {
                if (!focusedItem || !focusedBomb || !userId ||
                    users[focusedBomb.holder]?.id !== userId ||
                    !observation.success) return;
                const session = onlineMemoryRef.current;
                if (!session || session.roomId !== room?.id) return;
                const updated = recordOnlineRecall(session, focusedItem.id, observation);
                if (!updated) return;
                cacheOnlinePendingMemory(session);
                const nextItemId = nextOnlineRecommendation(session);
                // This is emitted before word:success, so the socket server
                // already has our next recommendation when the bomb returns.
                if (nextItemId)
                    socketRef.current?.emit("item:recommend", { itemId: nextItemId });
                void flushOnlineMemory();
            }}
            onSuccess={() => {
                console.log("Success! Emitting to server...");
                posthog.capture("word_succeeded");
                socketRef.current?.emit("word:success");
            }}
            onChangeInput={(input, failed) => {
                const value = input.slice(0, MAX_CURRENT_INPUT_LENGTH);
                socketRef.current?.emit(
                    "currentInput",
                    failed ? { input: value, failed: true } : value,
                );
            }}
            onPlayAgain={handlePlayAgain}
            onCreateRoom={() => router.push(getSignInUrl())}
            onJoin={() => handleJoin("join_button")}
            onWatch={handleWatch}
            onStartGame={handleStartGame}
            onLeave={handleLeave}
        />
    );
}
