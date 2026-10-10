"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useEffect, useState, useRef } from "react";
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
    const [lostDisplayName, setLostDisplayName] = useState<string | null>();
    const [userPositions, setUserPositions] = useState<Position[]>(
        Array.from({ length: 6 }, () => ({
            x: 0,
            y: 0,
            w: 24,
            h: 24,
            opacity: 0,
        })),
    );

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
                    setUserPositions(
                        newPositions(newRoom.users, userPositions),
                    );
                },
            );

            socket.on("typing:input", ({ input }: { input: string }) => {
                if (!selected || socketRef.current !== socket) return;
                setCurrentInput(input);
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
                }: {
                    holderUserId: string;
                    holderDisplayName: string;
                }) => {
                    if (!selected || socketRef.current !== socket) return;
                    explode();
                    const didLose = userIdRef.current === holderUserId;
                    setResult(didLose);
                    setLostDisplayName(holderDisplayName);

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
        setCurrentInput("");
        setIsSpectator(false);
    };

    const handleLeave = () => {
        socketRef.current?.emit("room:leave");
    };

    return (
        <GameView
            room={room}
            users={users}
            positions={userPositions}
            userId={userId}
            currentTurn={currentTurn}
            bombStatus={bombStatus ?? 0}
            currentItem={currentItem}
            currentInput={currentInput}
            isStarted={isStarted}
            isSpectator={isSpectator}
            serverError={serverError}
            notice={notice}
            result={result}
            lostDisplayName={lostDisplayName}
            bombRef={bombRef}
            explosionLayer={explosionLayer}
            onSuccess={() => {
                console.log("Success! Emitting to server...");
                posthog.capture("word_succeeded");
                socketRef.current?.emit("word:success");
            }}
            onChangeInput={(input) => {
                socketRef.current?.emit(
                    "currentInput",
                    input.slice(0, MAX_CURRENT_INPUT_LENGTH),
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
