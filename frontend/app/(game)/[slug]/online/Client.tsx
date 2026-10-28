"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import { io } from "@/lib/room/socket";
import {
    connectionError,
    connectionErrorDetails,
    connectionLog,
    isTerminalConnectionError,
} from "@/lib/room/connectionLogger";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import GameView from "@/components/feature/GameView";
import GameSettings from "@/components/layout/GameSettings";
import type { GameNoticeProps } from "@/components/feature/GameNotice";
import { Item, LegacyWord, Room, User } from "@/type";
import { getAuthToken, getClientSessionToken } from "@/lib/room/auth";
import {
    getEffectiveClusterServers,
    isTrustedServerUrl,
    resolveServerUrl,
} from "@/lib/room/serverUrl";
import { Position } from "@/type";
import { newPositions } from "@/lib/ui/position";
import posthog from "posthog-js";
import { legacyWireWordsToItems } from "@/lib/item";
import {
    loadPlaygroundMemory,
    syncPlaygroundMemory,
} from "@/lib/playground/memory-client";
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
    clusterServers: string[];
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
};

// Connection internals belong in DevTools, never in student-facing UI.
const CONNECTING_MESSAGE = "接続中…";
const UNAVAILABLE_MESSAGE =
    "現在はプレイできません。時間をおいて再度お試しください。";
const SERVER_FAILOVER_TIMEOUT_MS = 5_000;
const MAX_CURRENT_INPUT_LENGTH = 32;

export default function Clinet({
    clusterServers,
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
    const [backgroundMusic, setBackgroundMusic] = useState(
        initialBackgroundMusic,
    );
    const [soundEffects, setSoundEffects] = useState(initialSounDeffects);
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
    const [sharedFocusPlayerId, setSharedFocusPlayerId] = useState<
        string | null
    >(null);
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
        const itemIds = (room.items ?? []).map((item) => item.id);
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
                memoryRoomId,
                itemIds,
                result.userId,
                memory,
            );
            if (result.userId) {
                // Playground and online play share the same unsent-write queue.
                for (const pending of loadOnlinePendingMemory(
                    memoryRoomId,
                    result.userId,
                    itemIds,
                )) {
                    const remote = session.memory[pending.itemId];
                    if (
                        !remote ||
                        (Date.parse(pending.updatedAt ?? "") || 0) >=
                            (Date.parse(remote.updatedAt ?? "") || 0)
                    ) {
                        session.memory[pending.itemId] = pending;
                        session.pending.set(pending.itemId, pending);
                    }
                }
            }
            onlineMemoryRef.current = session;
            setOnlineMemoryReady((n) => n + 1);
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
        if (
            !session ||
            session.roomId !== room?.id ||
            !userId ||
            !users.some((player) => player.id === userId)
        )
            return;
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
        const configuredServers = getEffectiveClusterServers(clusterServers);
        const primaryUrl = configuredServers[0] ?? resolveServerUrl();
        // One signed player identity per mounted page, shared across reconnects.
        const sessionTokenPromise = getClientSessionToken().catch(() => null);
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let disposed = false;
        const secondaryUrl = configuredServers.length
            ? configuredServers[1]
            : process.env.NEXT_PUBLIC_SECONDARY_SERVER_URL;
        const fallbackUrl = configuredServers.length
            ? configuredServers[2]
            : process.env.NEXT_PUBLIC_FALLBACK_SERVER_URL;
        const distributed =
            configuredServers.length > 0 ||
            process.env.NEXT_PUBLIC_DISTRIBUTED_ROOMS === "true";

        let selected = false;
        let firstSnapshotCaptured = false;
        let failoverStarted = false;
        let secondaryUnavailable = false;
        let primaryTimer: ReturnType<typeof setTimeout> | null = null;
        let secondaryTimer: ReturnType<typeof setTimeout> | null = null;
        let noticeTimer: ReturnType<typeof setTimeout> | null = null;
        let disconnectNoticeTimer: ReturnType<typeof setTimeout> | null = null;
        const cancelDisconnectNotice = () => {
            if (disconnectNoticeTimer) clearTimeout(disconnectNoticeTimer);
            disconnectNoticeTimer = null;
        };

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
            }, 5000);
        };

        showNotice({
            iconName: "keyboard",
            title: "半角で入力してください",
            description: "単語は日本語でも英語でも、半角で入力してください。",
        });

        type ServerTier = "primary" | "secondary" | "fallback";
        type Candidate = {
            socket: ReturnType<typeof io>;
            ready: boolean;
            url: string | undefined;
            tier: ServerTier;
            startedAt: number;
        };

        const primarySocket = io(primaryUrl, {
            clusterServers: configuredServers,
            sessionTokenPromise,
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
            let authToken: string | null | undefined;
            let sessionToken: string | null | undefined;
            try {
                [authToken, sessionToken] = await Promise.all([
                    getAuthToken(),
                    sessionTokenPromise,
                ]);
            } catch (error) {
                if (disposed || socketRef.current !== socket) return;
                connectionError(
                    "AUTH",
                    "Unable to retrieve authentication credentials",
                    {
                        server: candidate.url,
                        tier: candidate.tier,
                        ...connectionErrorDetails(error),
                    },
                );
                setServerError(UNAVAILABLE_MESSAGE);
                return;
            }
            if (!selected || socketRef.current !== socket || disposed) return;
            if (!authToken || !sessionToken) {
                connectionError(
                    "AUTH",
                    "Authentication credentials are unavailable",
                    {
                        server: candidate.url,
                        tier: candidate.tier,
                        reason: !authToken
                            ? "room_token_missing"
                            : "session_token_missing",
                    },
                );
                setServerError(UNAVAILABLE_MESSAGE);
                return;
            }

            // Never disclose the authentication token to an untrusted origin.
            if (
                !isTrustedServerUrl(
                    candidate.url,
                    primaryUrl,
                    configuredServers,
                )
            ) {
                connectionError(
                    "AUTH",
                    "Untrusted authentication destination blocked",
                    {
                        server: candidate.url,
                        tier: candidate.tier,
                    },
                );
                setServerError(UNAVAILABLE_MESSAGE);
                return;
            }

            if (!distributed)
                connectionLog("AUTH", "Sending authentication request", {
                    server: candidate.url,
                    tier: candidate.tier,
                });
            socket.emit("auth:response", {
                jwtToken: authToken,
                sessionToken,
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
                if (!distributed)
                    connectionLog("CONNECTED", "Connected to primary server", {
                        server: candidate.url,
                        tier: candidate.tier,
                        durationMs: connectionTimeMs,
                    });
                posthog.capture("primary_server_connected", {
                    connection_time_ms: connectionTimeMs,
                });
            } else if (candidate.tier === "secondary") {
                if (!distributed)
                    connectionLog("FALLBACK", "Switching to secondary server", {
                        server: candidate.url,
                        tier: candidate.tier,
                        durationMs: connectionTimeMs,
                        reason: "primary_unreachable",
                    });
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
                if (!distributed)
                    connectionLog("FALLBACK", "Switching to fallback server", {
                        server: candidate.url,
                        tier: candidate.tier,
                        durationMs: connectionTimeMs,
                        reason: "higher_priority_servers_unreachable",
                    });
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
            const retrySelectedConnection = () => {
                if (distributed) return;
                if (
                    disposed ||
                    !selected ||
                    socketRef.current !== socket ||
                    reconnectTimer
                )
                    return;
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    if (
                        !disposed &&
                        socketRef.current === socket &&
                        !socket.connected
                    ) {
                        socket.connect();
                    }
                }, 1_000);
            };

            socket.on("disconnect", () => {
                if (!selected || socketRef.current !== socket || disposed)
                    return;
                if (!distributed)
                    connectionLog("CONNECTION", "Transport disconnected", {
                        server: candidate.url,
                        tier: candidate.tier,
                        visibility: document.visibilityState,
                    });
                cancelDisconnectNotice();
                // Sleeping tabs may suspend the heartbeat and transport. Keep
                // transient background recovery silent; show errors only if a
                // foreground reconnection remains unsuccessful.
                disconnectNoticeTimer = setTimeout(
                    () => {
                        disconnectNoticeTimer = null;
                        if (
                            !disposed &&
                            socketRef.current === socket &&
                            !socket.connected &&
                            document.visibilityState === "visible"
                        )
                            setServerError(CONNECTING_MESSAGE);
                    },
                    document.visibilityState === "hidden" ? 6000 : 3000,
                );
                retrySelectedConnection();
            });
            socket.on("connect_error", (error: unknown) => {
                if (!distributed)
                    connectionError("CONNECTION", "Socket connection failed", {
                        server: candidate.url,
                        tier: candidate.tier,
                        ...connectionErrorDetails(error),
                    });
                if (selected) {
                    retrySelectedConnection();
                    return;
                }

                if (candidate.tier === "primary") {
                    startFailover();
                } else if (candidate.tier === "secondary") {
                    markSecondaryUnavailable();
                }
            });

            socket.on(
                "error",
                (
                    error: {
                        message?: unknown;
                        retryable?: boolean;
                        code?: string;
                    } | null,
                ) => {
                    if (!selected || socketRef.current !== socket) return;
                    const authFailed = error?.code === "AUTH_FAILED";
                    const terminal = isTerminalConnectionError(error);
                    if (!distributed)
                        connectionError(
                            authFailed ? "AUTH" : "CONNECTION",
                            authFailed
                                ? "Authentication failed"
                                : "Server returned an error",
                            {
                                server: candidate.url,
                                tier: candidate.tier,
                                ...connectionErrorDetails(error),
                            },
                        );
                    if (terminal) cancelDisconnectNotice();
                    setServerError(
                        terminal ? UNAVAILABLE_MESSAGE : CONNECTING_MESSAGE,
                    );
                },
            );

            socket.on(
                "room:broadcast",
                (
                    newRoom: Room & {
                        words?: LegacyWord[];
                        migrating?: boolean;
                        users: User[];
                        isStart: boolean;
                        bombHolder: number;
                        wordIndex: number;
                        bombStatus: number;
                    },
                ) => {
                    if (!selected || socketRef.current !== socket) return;
                    if (!firstSnapshotCaptured) {
                        firstSnapshotCaptured = true;
                        posthog.capture("game_first_snapshot_received", {
                            snapshot_time_ms: Math.round(
                                performance.now() - candidate.startedAt,
                            ),
                            migrating: newRoom.migrating === true,
                            tier: candidate.tier,
                        });
                    }
                    cancelDisconnectNotice();
                    setServerError(
                        newRoom.migrating ? CONNECTING_MESSAGE : null,
                    );
                    const normalizedItems =
                        newRoom.items ?? legacyWireWordsToItems(newRoom.words);
                    const normalizedRoom: Room = {
                        ...newRoom,
                        items: normalizedItems,
                    };
                    setRoom(normalizedRoom);
                    setHintLengths(
                        Object.fromEntries(
                            (newRoom.bombs ?? [])
                                .map((bomb) => [bomb.id, bomb.hintLength ?? 0])
                                .filter(([id]) => !!id),
                        ),
                    );
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
                    const sharedPlayerId =
                        newRoom.typingFocusPlayerId ??
                        newRoom.users[
                            newRoom.bombs?.[0]?.holder ?? newRoom.bombHolder
                        ]?.id ??
                        null;
                    setSharedFocusPlayerId(sharedPlayerId);
                    viewedHolderIdRef.current = sharedPlayerId;
                    setCurrentInput(newRoom.typingFocusInput ?? "");
                    setUserPositions(
                        newPositions(newRoom.users, userPositions),
                    );
                },
            );

            socket.on(
                "typing:input",
                ({
                    input,
                    failed,
                    focusPlayerId,
                }: {
                    input: string;
                    failed?: boolean;
                    focusPlayerId?: string;
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
                },
            );

            socket.on(
                "hint:updated",
                ({ bombId, length }: { bombId: string; length: number }) => {
                    if (!selected || socketRef.current !== socket) return;
                    setHintLengths((current) => ({
                        ...current,
                        [bombId]: length,
                    }));
                },
            );

            socket.on("game:quited", () => {
                if (!selected || socketRef.current !== socket) return;
                showNotice({
                    iconName: "globeOff",
                    title: "接続が切れました",
                    description: "プレイヤーがルームから退出しました。",
                });
                connectionLog("CONNECTION", "Player exited the room", {
                    reason: "player_left",
                });
                posthog.capture("game_quited");
            });

            socket.on(
                "cluster:recovery-started",
                ({
                    recoveryId,
                    fromDepth,
                    detectionHeartbeatAgeMs,
                }: {
                    recoveryId: string;
                    fromDepth: number;
                    detectionHeartbeatAgeMs: number;
                }) => {
                    if (!selected || socketRef.current !== socket) return;
                    posthog.capture("game_connection_recovery_started", {
                        recovery_id: recoveryId,
                        from_depth: fromDepth,
                        detection_heartbeat_age_ms: detectionHeartbeatAgeMs,
                    });
                },
            );

            socket.on(
                "cluster:recovery-failed",
                ({ code }: { code?: string }) => {
                    if (!selected || socketRef.current !== socket) return;
                    cancelDisconnectNotice();
                    setServerError(UNAVAILABLE_MESSAGE);
                    posthog.capture("game_connection_recovery_failed", {
                        code,
                    });
                },
            );

            socket.on(
                "cluster:recovered",
                (diagnostics: {
                    snapshotRecoveryMs: number;
                    recoveryId?: string;
                    snapshotBeforeAuth?: boolean;
                    detectionHeartbeatAgeMs?: number;
                    fromDepth?: number;
                    toDepth?: number;
                    retryWaitMs?: number;
                    routeMs?: number;
                    routeCalls?: number;
                    reportMs?: number;
                    reportCalls?: number;
                    serverReadMs?: number;
                    serverProbeMs?: number;
                    serverPromoteMs?: number;
                    serverResumeMs?: number;
                    serverAuthMs?: number;
                    serverTotalMs?: number;
                    serverResumeReadMs?: number;
                    serverResumeOpenMs?: number;
                    socketHandshakeMs?: number;
                    socketCalls?: number;
                    authenticationMs?: number;
                    snapshotAfterAuthMs?: number;
                    migrationWaitMs?: number;
                }) => {
                    if (!selected || socketRef.current !== socket) return;
                    const { snapshotRecoveryMs, ...phases } = diagnostics;
                    const timingProperties = Object.fromEntries(
                        Object.entries(phases).map(([key, value]) => [
                            // Keep the existing event name for backwards
                            // compatibility; new phase properties are additive.
                            key.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase()),
                            typeof value === "number"
                                ? Math.round(value)
                                : value,
                        ]),
                    );
                    posthog.capture("game_connection_snapshot_recovered", {
                        snapshot_recovery_time_ms: snapshotRecoveryMs,
                        ...timingProperties,
                    });
                },
            );

            socket.on("auth:session", ({ id }: { id: string }) => {
                if (!selected || socketRef.current !== socket) return;
                if (!distributed)
                    connectionLog("AUTH", "Authentication succeeded", {
                        server: candidate.url,
                        tier: candidate.tier,
                        durationMs: Math.round(
                            performance.now() - candidate.startedAt,
                        ),
                    });
                setServerError(null);
                setUserId(id);
                userIdRef.current = id;
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
                        ? losers.some((loser) => loser.id === userIdRef.current)
                        : userIdRef.current === holderUserId;
                    setResult(didLose);
                    setLostDisplayName(holderDisplayName ?? null);
                    setLoserNames(
                        losers?.map(
                            (loser) => loser.displayName ?? "プレイヤー",
                        ) ?? [],
                    );

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
                    clusterServers: configuredServers,
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
                    clusterServers: configuredServers,
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
        if (!distributed)
            primaryTimer = setTimeout(
                startFailover,
                SERVER_FAILOVER_TIMEOUT_MS,
            );

        return () => {
            disposed = true;
            if (reconnectTimer) clearTimeout(reconnectTimer);
            clearPrimaryTimer();
            clearSecondaryTimer();
            if (noticeTimer) clearTimeout(noticeTimer);
            cancelDisconnectNotice();
            blipAudioRef.current?.pause();
            powerupAudioRef.current?.pause();
            if ("closePage" in primaryCandidate.socket)
                primaryCandidate.socket.closePage();
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

        if (!soundEffects) return;

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
    }, [users?.length, soundEffects]);

    const isFirstBombRender = useRef(true);
    useEffect(() => {
        if (isFirstBombRender.current) {
            isFirstBombRender.current = false;
            return;
        }

        if (!soundEffects) return;

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
    }, [bombStatus, soundEffects]);

    useEffect(() => {
        audioRef.current = new Audio("/MT-RD_17_for_Loop.wav");
        audioRef.current.loop = true;

        const startAudio = () => {
            if (backgroundMusic && audioRef.current) {
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
    }, [backgroundMusic]);

    const handleJoin = (source: "join_button" | "play_again") => {
        connectionLog("CONNECTION", "Room join requested", { reason: source });
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

    const handleReload = () => {
        posthog.capture("game_reload_clicked", {
            has_room: room !== null,
            connection_failed: serverError === UNAVAILABLE_MESSAGE,
        });
        window.location.reload();
    };

    const focusedBomb =
        room?.bombs?.find((bomb) => users[bomb.holder]?.id === userId) ??
        room?.bombs?.find(
            (bomb) => users[bomb.holder]?.id === sharedFocusPlayerId,
        ) ??
        room?.bombs?.[0];
    const focusedItem = focusedBomb
        ? focusedBomb.wordIndex === undefined
            ? null
            : (room?.items?.[focusedBomb.wordIndex] ?? null)
        : currentItem;

    return (
        <>
            <GameView
                room={room}
                users={users}
                positions={userPositions}
                userId={userId}
                currentTurn={focusedBomb?.holder ?? currentTurn}
                bombStatus={focusedBomb?.status ?? bombStatus ?? 0}
                currentItem={focusedItem}
                itemPresentationKey={
                    focusedBomb ? focusedBomb.id + ":" + focusedBomb.turn : 0
                }
                currentInput={currentInput}
                remoteHintLength={
                    hintLengths[focusedBomb?.id ?? ""] ??
                    focusedBomb?.hintLength ??
                    0
                }
                onHintChange={(length) =>
                    socketRef.current?.emit("hint:update", { length })
                }
                failureCount={failureCount}
                isStarted={isStarted}
                isSpectator={isSpectator}
                serverError={serverError}
                connectionFailed={serverError === UNAVAILABLE_MESSAGE}
                onReload={handleReload}
                notice={notice}
                result={result}
                lostDisplayName={lostDisplayName}
                loserNames={loserNames}
                loserIds={room?.losers?.map((loser) => loser.id)}
                bombs={room?.bombs}
                enableRemoteTypingSync={false}
                bombRef={bombRef}
                explosionLayer={explosionLayer}
                onRecallComplete={(observation: RecallObservation) => {
                    if (
                        !focusedItem ||
                        !focusedBomb ||
                        !userId ||
                        users[focusedBomb.holder]?.id !== userId ||
                        !observation.success
                    )
                        return;
                    const session = onlineMemoryRef.current;
                    if (!session || session.roomId !== room?.id) return;
                    const updated = recordOnlineRecall(
                        session,
                        focusedItem.id,
                        observation,
                    );
                    if (!updated) return;
                    cacheOnlinePendingMemory(session);
                    const nextItemId = nextOnlineRecommendation(session);
                    if (nextItemId)
                        socketRef.current?.emit("item:recommend", {
                            itemId: nextItemId,
                        });
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
                onCreateRoom={() => {
                    startNavigationProgress();
                    router.push(getSignInUrl());
                }}
                onJoin={() => handleJoin("join_button")}
                onWatch={handleWatch}
                onStartGame={handleStartGame}
                onLeave={handleLeave}
            />
            <header className="w-full flex absolute justify-end p-4 gap-4">
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
