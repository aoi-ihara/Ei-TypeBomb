"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";
import UsersView from "@/components/feature/UsersView";
import TypingView from "@/components/feature/InputView";
import { Room, Word, User } from "@/type";
import { getAuthToken } from "@/lib/room/auth";
import { isTrustedServerUrl, resolveServerUrl } from "@/lib/room/serverUrl";
import { Position } from "@/type";
import { newPositions } from "@/lib/ui/position";
import posthog from "posthog-js";
import Button from "@/components/ui/Button";

type Props = {
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
    initialServerUrl: string;
};

const SERVER_FAILOVER_TIMEOUT_MS = 5_000;

export default function Clinet({
    initialBackgroundMusic,
    initialSounDeffects,
    initialServerUrl,
}: Props) {
    const [userId, setUserId] = useState<string | null>(null);
    const userIdRef = useRef<string | null>(null);
    const gameNumberRef = useRef(0);

    const [room, setRoom] = useState<Room | null>(null);
    const [serverError, setServerError] = useState<string | null>(null);
    const [users, setUsers] = useState<User[]>([]);
    const [currentWord, setCurrentWord] = useState<Word | null>(null);
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
    const [connectionAlert, setConnectionAlert] = useState<null | number>(null);
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

    const currentTurnUser = users[currentTurn] as User | undefined;

    useEffect(() => {
        blipAudioRef.current = new Audio("/Blip_select_8.wav");
        powerupAudioRef.current = new Audio("/Powerup_1.wav");

        // SOCKET
        const primaryUrl = resolveServerUrl(initialServerUrl);
        const backupUrl = process.env.NEXT_PUBLIC_BACKUP_SERVER_URL;

        let selected = false;
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        let backupConnectionStartedAt: number | null = null;

        const primarySocket = io(primaryUrl, {
            reconnection: false,
        });
        const renderSocket =
            backupUrl && backupUrl !== primaryUrl
                ? io(backupUrl, { reconnection: false })
                : null;

        type Candidate = {
            socket: ReturnType<typeof io>;
            ready: boolean;
            url: string | undefined;
        };

        const primaryCandidate: Candidate = {
            socket: primarySocket,
            ready: false,
            url: primaryUrl,
        };
        const renderCandidate: Candidate | null = renderSocket
            ? { socket: renderSocket, ready: false, url: backupUrl }
            : null;

        const authenticate = async (candidate: Candidate) => {
            const socket = candidate.socket;
            setUserId(socket.id ?? null);
            userIdRef.current = socket.id ?? null;

            const authToken = await getAuthToken();
            if (!authToken || !selected || socketRef.current !== socket) return;

            // Never disclose the authentication token to an untrusted origin.
            if (!isTrustedServerUrl(candidate.url)) return;

            socket.emit("auth:response", {
                jwtToken: authToken,
                displayName: displayName,
            });
        };

        const selectCandidate = (candidate: Candidate, isFallback: boolean) => {
            if (selected) return;

            selected = true;
            if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                fallbackTimer = null;
            }

            socketRef.current = candidate.socket;

            const standbySocket =
                candidate.socket === primaryCandidate.socket
                    ? renderCandidate?.socket
                    : primaryCandidate.socket;
            standbySocket?.disconnect();

            if (isFallback) {
                console.warn(
                    "Primary server unavailable. Switching to Render.",
                );
                backupConnectionStartedAt = performance.now();
                posthog.capture("switched_to_backup_server");
            } else {
                console.info("Connected to primary server.");
                posthog.capture("primary_server_connected");
            }

            if (candidate.ready) {
                void authenticate(candidate);
            }
        };

        const attachSocketListeners = (candidate: Candidate) => {
            const { socket } = candidate;

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
                        users: User[];
                        isStart: boolean;
                        bombHolder: number;
                        wordIndex: number;
                        bombStatus: number;
                    },
                ) => {
                    if (!selected || socketRef.current !== socket) return;
                    setServerError(null);
                    setRoom(newRoom);
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
                    if (newRoom.wordIndex !== undefined && newRoom.words)
                        setCurrentWord(newRoom.words[newRoom.wordIndex]);
                    else setCurrentWord(null);
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
                setConnectionAlert(1);
                console.log("game quited");
                posthog.capture("game_quited");

                setTimeout(() => {
                    setConnectionAlert(null);
                }, 3000);
            });

            socket.on("auth:request", () => {
                candidate.ready = true;

                if (!selected) {
                    if (candidate.socket === primaryCandidate.socket) {
                        selectCandidate(primaryCandidate, false);
                    }
                    return;
                }

                if (socketRef.current === socket) {
                    if (
                        socket === renderSocket &&
                        backupConnectionStartedAt !== null
                    ) {
                        const connectionTimeMs = Math.round(
                            performance.now() - backupConnectionStartedAt,
                        );
                        posthog.capture("backup_server_connected", {
                            connection_time_ms: connectionTimeMs,
                        });
                        backupConnectionStartedAt = null;
                    }
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

        attachSocketListeners(primaryCandidate);
        if (renderCandidate) attachSocketListeners(renderCandidate);

        if (renderCandidate) {
            fallbackTimer = setTimeout(() => {
                selectCandidate(renderCandidate, true);
            }, SERVER_FAILOVER_TIMEOUT_MS);
        } else {
            fallbackTimer = null;
        }

        return () => {
            if (fallbackTimer) clearTimeout(fallbackTimer);
            blipAudioRef.current?.pause();
            powerupAudioRef.current?.pause();
            primarySocket.disconnect();
            renderSocket?.disconnect();
        };
    }, []);

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

    const handleJoin = () => {
        console.log("join request");
        posthog.capture("room_join_clicked");
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
        setResult(null);
        setLostDisplayName(null);
        setCurrentInput("");
    };

    const handleLeave = () => {
        socketRef.current?.emit("room:leave");
    };

    return (
        <div className="flex flex-col md:flex-row w-full h-full">
            <div
                className={`${connectionAlert === null && "opacity-0 scale-95"} transition-all duration-(--duration-etb) ease-etb fixed top-4 right-4 flex items-center gap-4 w-94 rounded-2xl bg-(--color-foreground) text-(--color-background) py-3 px-4`}
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    height="24px"
                    viewBox="0 -960 960 960"
                    width="24px"
                    fill="currentColor"
                >
                    <path d="m696-80-56-56 84-84-84-84 56-56 84 84 84-84 56 56-83 84 83 84-56 56-84-83-84 83Zm-216 0q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 10-.5 20t-1.5 20h-81q2-10 2.5-20t.5-20q0-20-2.5-40t-7.5-40H654q3 20 4.5 40t1.5 40v20q0 10-1 20h-80q1-10 1-20v-20q0-20-1.5-40t-4.5-40H386q-3 20-4.5 40t-1.5 40q0 20 1.5 40t4.5 40h174v80H404q12 43 31 82.5t45 75.5q18 0 35.5-2t35.5-4l18 78q-23 5-44.5 7.5T480-80ZM170-400h136q-3-20-4.5-40t-1.5-40q0-20 1.5-40t4.5-40H170q-5 20-7.5 40t-2.5 40q0 20 2.5 40t7.5 40Zm34-240h118q9-37 22.5-72.5T376-782q-55 18-99 54.5T204-640Zm172 462q-18-34-31.5-69.5T322-320H204q29 51 73 87.5t99 54.5Zm28-462h152q-12-43-31-82.5T480-798q-26 36-45 75.5T404-640Zm234 0h118q-29-51-73-87.5T584-782q18 34 31.5 69.5T638-640Z" />
                </svg>
                <div
                    className="flex flex-col"
                    data-cursor={`${connectionAlert !== null && "text"}`}
                >
                    <span className="font-bold">接続が切れました</span>
                    プレイヤーがルームから退出しました。
                </div>
            </div>
            {result !== null && (
                <div className="fixed flex items-center flex-col gap-4 justify-center bg-(--color-background)/75 z-1 top-0 left-0 w-screen h-screen">
                    <div className="w-sm flex flex-col gap-4 items-center animate-appear">
                        <div data-cursor="text" className="font-bold text-4xl">
                            {result === true
                                ? "あなたの負けです"
                                : `${lostDisplayName}の負けです`}
                        </div>
                        <Button
                            iconName="rotateCw"
                            className="w-full"
                            variant="primary"
                            onClick={handlePlayAgain}
                        >
                            もう一度プレイ
                        </Button>
                        <Button
                            iconName="plus"
                            className="w-full"
                            onClick={() =>
                                router.push(
                                    process.env.NEXT_PUBLIC_SIGN_IN_URL!,
                                )
                            }
                        >
                            ルームを作成
                        </Button>
                    </div>
                </div>
            )}
            <div className="max-w-3xl md:order-2 w-full px-4 gap-4 pb-4 pt-4 h-full justify-end flex flex-col">
                <div
                    className={`flex flex-col bg-(--color-background-secondary) transition-all duration-(--duration-etb) ease-etb ${serverError ? "min-h-14 h-auto justify-center" : isSpectator && !isStarted ? "opacity-0 scale-95" : users.some((user) => user.id === userId) ? (isStarted ? (currentTurnUser?.id === userId ? "h-full" : "h-64") : "h-48") : isStarted ? "h-64" : "h-14"} rounded-2xl p-2 w-full`}
                >
                    {serverError ? (
                        <div
                            className="flex justify-start animate-appear w-full"
                            role="alert"
                        >
                            <div
                                className="font-mono w-fit pl-4 font-bold"
                                data-cursor="text"
                            >
                                {serverError}
                            </div>
                        </div>
                    ) : room ? (
                        users.some((user) => user.id === userId) ? (
                            <div className="flex flex-col h-full animate-appear">
                                <div className="flex h-full">
                                    <div className="w-full flex flex-col items-center justify-center gap-4">
                                        {isStarted ? (
                                            currentWord === null ? (
                                                <div
                                                    className="font-mono w-fit font-bold text-2xl"
                                                    data-cursor="text"
                                                >
                                                    ゲーム開始
                                                </div>
                                            ) : (
                                                <div className="flex h-full items-center justify-center flex-col gap-2 w-full">
                                                    {currentTurnUser?.id ==
                                                    userId ? (
                                                        <div
                                                            className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                                                            data-cursor="text"
                                                        >
                                                            あなたの番です
                                                        </div>
                                                    ) : currentTurnUser ? (
                                                        <div
                                                            className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                                                            data-cursor="text"
                                                        >
                                                            {currentTurnUser.displayName +
                                                                "の番です"}
                                                        </div>
                                                    ) : null}
                                                    <TypingView
                                                        japanese={
                                                            currentWord.jp
                                                        }
                                                        bombStatus={
                                                            bombStatus ?? 0
                                                        }
                                                        english={currentWord.en}
                                                        onSuccess={() => {
                                                            console.log(
                                                                "Success! Emitting to server...",
                                                            );
                                                            posthog.capture(
                                                                "word_succeeded",
                                                            );
                                                            socketRef.current?.emit(
                                                                "word:success",
                                                            );
                                                        }}
                                                        onChangeInput={(
                                                            input,
                                                        ) => {
                                                            if (
                                                                userId ==
                                                                currentTurnUser?.id
                                                            )
                                                                socketRef.current?.emit(
                                                                    "cuttentInput",
                                                                    input,
                                                                );
                                                        }}
                                                        currentInput={
                                                            userId ==
                                                            currentTurnUser?.id
                                                                ? null
                                                                : currentInput
                                                        }
                                                    />
                                                </div>
                                            )
                                        ) : (
                                            <>
                                                <div
                                                    className="gradient-text h-fit px-2 py-1 font-bold flex"
                                                    data-cursor="text"
                                                >
                                                    ほかのプレイヤーを待っています…
                                                </div>
                                                <div
                                                    className="rounded-lg w-48 flex"
                                                    data-cursor="button"
                                                    data-cursor-shape={
                                                        users.length < 2
                                                            ? "2"
                                                            : "0"
                                                    }
                                                >
                                                    <button
                                                        className={`items-center cursor-pointer font-bold ${users.length < 2 ? "opacity-50" : "active:scale-95"} bg-cyan-600 disabled:opacity-50 w-full justify-center py-2 rounded-lg text-white h-fit flex transition-all duration-(--duration-etb) ease-etb`}
                                                        onClick={() => {
                                                            if (
                                                                users.length > 1
                                                            )
                                                                handleStartGame();
                                                        }}
                                                    >
                                                        ゲームを開始
                                                    </button>
                                                </div>
                                                <div
                                                    className="rounded-lg w-48 flex"
                                                    data-cursor="button"
                                                    data-cursor-shape="1"
                                                >
                                                    <button
                                                        className="items-center text-center justify-center cursor-pointer font-bold py-2 w-full text-cyan-600 h-fit flex transition-all duration-(--duration-etb) ease-etb active:scale-95"
                                                        onClick={() =>
                                                            handleLeave()
                                                        }
                                                    >
                                                        退出
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full w-full flex justify-center items-center">
                                {users.length < room.maxPlayers! ? (
                                    isStarted ? (
                                        currentWord === null ? (
                                            <div
                                                className="font-mono animate-appear w-fit font-bold text-2xl"
                                                data-cursor="text"
                                            >
                                                ゲーム開始
                                            </div>
                                        ) : (
                                            <div className="flex h-full animate-appear items-center justify-center flex-col gap-2 w-full">
                                                {currentTurnUser?.id ==
                                                userId ? (
                                                    <div
                                                        className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                                                        data-cursor="text"
                                                    >
                                                        あなたの番です
                                                    </div>
                                                ) : currentTurnUser ? (
                                                    <div
                                                        className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                                                        data-cursor="text"
                                                    >
                                                        {currentTurnUser.displayName +
                                                            "の番です"}
                                                    </div>
                                                ) : null}
                                                <TypingView
                                                    japanese={currentWord.jp}
                                                    english={currentWord.en}
                                                    onSuccess={() => {
                                                        console.log(
                                                            "Success! Emitting to server...",
                                                        );
                                                        socketRef.current?.emit(
                                                            "success",
                                                        );
                                                    }}
                                                    onChangeInput={(input) => {
                                                        if (
                                                            userId ==
                                                            currentTurnUser?.id
                                                        )
                                                            socketRef.current?.emit(
                                                                "cuttentInput",
                                                                input,
                                                            );
                                                    }}
                                                    bombStatus={bombStatus ?? 0}
                                                    currentInput={
                                                        userId ==
                                                        currentTurnUser?.id
                                                            ? null
                                                            : currentInput
                                                    }
                                                />
                                            </div>
                                        )
                                    ) : (
                                        !isSpectator && (
                                            <>
                                                <div className="w-full animate-appear">
                                                    <div
                                                        className="w-fit pl-4 font-bold"
                                                        data-cursor="text"
                                                    >
                                                        接続しました
                                                    </div>
                                                </div>
                                                <div className="flex gap-2 animate-appear">
                                                    <div
                                                        className="rounded-lg w-14 flex"
                                                        data-cursor="button"
                                                        data-cursor-shape="1"
                                                    >
                                                        <button
                                                            className="items-center text-center justify-center cursor-pointer font-bold py-2 w-full text-cyan-600 h-fit flex transition-all duration-(--duration-etb) ease-etb active:scale-95"
                                                            onClick={() =>
                                                                handleWatch()
                                                            }
                                                        >
                                                            観戦
                                                        </button>
                                                    </div>
                                                    <div
                                                        className="rounded-lg w-20 flex"
                                                        data-cursor="button"
                                                        data-cursor-shape="0"
                                                    >
                                                        <button
                                                            className="items-center font-bold bg-cyan-600 w-full justify-center py-2 rounded-lg text-white h-fit flex transition-all cursor-pointer duration-(--duration-etb) ease-etb active:scale-95"
                                                            onClick={() =>
                                                                handleJoin()
                                                            }
                                                        >
                                                            参加
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )
                                    )
                                ) : (
                                    <div className="flex justify-start animate-appear w-full">
                                        <div
                                            className="font-mono w-fit pl-4 font-bold"
                                            data-cursor="text"
                                        >
                                            このルームは満員です
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="w-full h-full flex animate-appear items-center">
                            <div
                                className="w-fit pl-4 font-bold gradient-text"
                                data-cursor="text"
                            >
                                サーバーに接続しています…
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <div className="w-full relative md:order-1 flex justify-center items-center h-full">
                <div
                    className="absolute top-0 left-0 pl-4 md:top-3 w-full flex truncate line-clamp-1 font-bold font-mono text-lg"
                    data-cursor="text"
                >
                    {room?.title}
                </div>
                <UsersView
                    users={users ?? []}
                    positions={userPositions}
                    userId={userId}
                    currentTurn={isStarted ? currentTurn : null}
                    bombStatus={bombStatus ?? 0}
                />
            </div>
        </div>
    );
}
