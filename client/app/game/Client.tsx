"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";
import UsersView from "@/components/feature/UsersView";
import TypingView from "@/components/feature/InputView";

type Word = {
    jp: string;
    en: string;
};

type User = {
    displayName: string;
    userId: string;
    pulse: string;
};

type Position = {
    x: number;
    y: number;
    w: number;
    h: number;
    opacity: number;
};

type Props = {
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
    initialServerUrl: string;
};

export default function Clinet({
    initialBackgroundMusic,
    initialSounDeffects,
    initialServerUrl,
}: Props) {
    const [userId, setUserId] = useState("");
    const userIdRef = useRef("");

    const [showCursor, setShowCursor] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [room, setRoom] = useState<User[]>([]);
    const [cameraAngle, setCameraAngle] = useState(1);
    const [currentWord, setCurrentWord] = useState<Word | null>(null);
    const [currentTurn, setCurrentTurn] = useState<number>(0);
    const [displayName, setDisplayName] = useState<string>(() => {
        if (typeof window === "undefined") return "";
        return localStorage.getItem("display-name") ?? "";
    });
    const [bombStatus, setBombStatus] = useState<number>(0);
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

    const currentTurnUser = room[currentTurn] as User | undefined;

    useEffect(() => {
        blipAudioRef.current = new Audio("/Blip_select_8.wav");
        powerupAudioRef.current = new Audio("/Powerup_1.wav");

        return () => {
            blipAudioRef.current?.pause();
            powerupAudioRef.current?.pause();
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
    }, [room.length, initialSounDeffects]);

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

        const socket = io(
            typeof window === "undefined" || initialServerUrl === ""
                ? "https://ei-typing.onrender.com"
                : initialServerUrl,
        );

        socketRef.current = socket;

        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        const intervalId2 = setInterval(() => {
            socket.emit("fetch", "");
        }, 1000);

        const showConnectionAlert = (alert: number) => {
            setConnectionAlert(alert);

            const alertIntervalId = setInterval(() => {
                setConnectionAlert(null);
            }, 4000);

            return () => {
                clearInterval(alertIntervalId);
            };
        };

        socket.on("endGame", () => {
            console.log("game end");
            showConnectionAlert(1);
        });

        socket.on("roomInfo", (roomInfo: User[]) => {
            setIsConnected(true);
            setRoom(roomInfo);
            setCameraAngle(
                roomInfo.length == 1 || roomInfo.length == 0 ? 3 : 1,
            );
            setUserPositions(
                userPositions.map((position, index) => {
                    if (roomInfo.length == 1 && index == 0) {
                        return {
                            x: 0,
                            y: 0,
                            w: 64,
                            h: 64,
                            opacity: 1,
                        };
                    } else if (index < roomInfo.length) {
                        const angle = (index / roomInfo.length) * 2 * Math.PI;
                        return {
                            x: Math.cos(angle) * (room.length * 6 + 25),
                            y: Math.sin(angle) * (room.length * 6 + 25),
                            w: 24,
                            h: 24,
                            opacity: 1,
                        };
                    } else {
                        return {
                            x: 0,
                            y: 0,
                            w: 24,
                            h: 24,
                            opacity: 0,
                        };
                    }
                }),
            );
        });

        socket.on(
            "bombExplosioned",
            ({
                explosionedUserId,
                currentRoom,
            }: {
                explosionedUserId: string;
                currentRoom: User[];
            }) => {
                if (initialSounDeffects) {
                    const audio = new Audio("/Explosion_7.wav");
                    audio.volume = 1;
                    audio.play().catch(() => {});
                }

                if (!isSpectator) {
                    if (userIdRef.current == explosionedUserId) {
                        setResult(true);
                    } else if (
                        currentRoom.find(
                            (item) => userIdRef.current == item.userId,
                        )
                    ) {
                        setResult(false);
                        setLostDisplayName(
                            currentRoom.find(
                                (user) => user.userId == explosionedUserId,
                            )?.displayName,
                        );
                    } else {
                        setLostDisplayName(
                            currentRoom.find(
                                (user) => user.userId == explosionedUserId,
                            )?.displayName,
                        );
                    }
                }

                const resultTimer = setTimeout(() => {
                    setResult(null);
                    setLostDisplayName(null);
                }, 3000);
            },
        );

        socket.on("joined", (myUuid: string) => {
            userIdRef.current = myUuid;
            setUserId(myUuid);
        });

        socket.on(
            "gameStatus",
            ({
                isStarted,
                currentTurn,
                currentWord,
                bombStatus,
                currentInput,
            }: {
                isStarted: boolean;
                currentTurn: number;
                currentWord: Word;
                bombStatus: number;
                currentInput: string;
            }) => {
                setIsStarted(isStarted);
                setCurrentTurn(currentTurn);
                setCurrentWord(currentWord);
                setBombStatus(bombStatus);
                setCurrentInput(currentInput);
            },
        );

        socket.on("pulse", (pulseUuid: string) => {
            if (userIdRef.current !== "") {
                socket.emit("pulseResponse", {
                    userId: userIdRef.current,
                    newPulse: pulseUuid,
                });
            }
        });

        return () => {
            socket.disconnect();
            clearInterval(intervalId);
            clearInterval(intervalId2);
            removeListeners();
            if (audioRef.current) {
                audioRef.current.pause();
            }
        };
    }, [router, initialBackgroundMusic, initialSounDeffects]);

    const handleConnect = () => {
        socketRef.current?.emit("joinRoom", displayName);
    };

    const handleWatch = () => {
        setIsSpectator(true);
    };

    const handleStartGame = () => {
        socketRef.current?.emit("startGame");
    };

    const handleLeave = () => {
        setUserId("");
        userIdRef.current = "";
        socketRef.current?.disconnect();
        socketRef.current?.connect();
    };

    return (
        <div className="flex flex-col md:flex-row w-full h-full">
            <div
                className={`${connectionAlert == null && "opacity-0 scale-95"} transition-all duration-200 ease-out fixed top-4 right-4 flex items-center gap-4 w-94 rounded-2xl bg-(--color-foreground) text-(--color-background) py-3 px-4`}
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
                    <span className="font-bold">Disconnected</span>A player has
                    left the room.
                </div>
            </div>
            {(result !== null || lostDisplayName) && (
                <div className="fixed flex items-center justify-center bg-(--color-background)/50 z-1000 top-0 left-0 w-screen h-screen">
                    <div
                        data-cursor="text"
                        className="font-bold text-4xl animate-[resultAnimation_1000ms_cubic-bezier(0.1,0.5,0,1)]"
                    >
                        {result === true
                            ? "You Lose"
                            : `${lostDisplayName} Lose`}
                    </div>
                </div>
            )}
            <div
                className={`max-w-2xl md:order-2 w-full px-4 gap-4 pb-4 pt-4 h-full justify-end flex flex-col`}
            >
                <div
                    className={`flex flex-col bg-(--color-background-secondary) transition-all duration-200 ease-[cubic-bezier(0.1,0.5,0,1)] ${
                        isSpectator && !isStarted
                            ? "opacity-0 scale-95"
                            : room.some((user) => user.userId === userId)
                              ? isStarted
                                  ? currentTurnUser?.userId == userId
                                      ? "h-full"
                                      : "h-64"
                                  : "h-48"
                              : isStarted
                                ? "h-64"
                                : "h-14"
                    } rounded-2xl p-2 w-full`}
                >
                    {isConnected ? (
                        room.some((user) => user.userId === userId) ? (
                            <div className="flex flex-col h-full">
                                <div className="flex h-full">
                                    <div className="w-full flex flex-col items-center justify-center gap-4">
                                        {isStarted ? (
                                            currentWord == null ? (
                                                <div
                                                    className="font-mono w-fit font-bold text-2xl"
                                                    data-cursor="text"
                                                >
                                                    Game started
                                                </div>
                                            ) : (
                                                <div className="flex h-full items-center justify-center flex-col gap-2 w-full">
                                                    {currentTurnUser?.userId ==
                                                    userId ? (
                                                        <>
                                                            <div
                                                                className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                                                                data-cursor="text"
                                                            >
                                                                YOUR TURN
                                                            </div>
                                                        </>
                                                    ) : currentTurnUser ? (
                                                        <div
                                                            className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                                                            data-cursor="text"
                                                        >
                                                            {currentTurnUser.displayName +
                                                                "'s Turn"}
                                                        </div>
                                                    ) : null}

                                                    <TypingView
                                                        japanese={
                                                            currentWord.jp
                                                        }
                                                        english={currentWord.en}
                                                        onSuccess={() => {
                                                            console.log(
                                                                "Success! Emitting to server...",
                                                            );
                                                            socketRef.current?.emit(
                                                                "success",
                                                            );
                                                        }}
                                                        onChangeInput={(
                                                            input,
                                                        ) => {
                                                            if (
                                                                userId ==
                                                                currentTurnUser?.userId
                                                            ) {
                                                                socketRef.current?.emit(
                                                                    "cuttentInput",
                                                                    input,
                                                                );
                                                            }
                                                        }}
                                                        currentInput={
                                                            userId ==
                                                            currentTurnUser?.userId
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
                                                    Waiting for other players…
                                                </div>
                                                <div
                                                    className="rounded-lg w-48 flex"
                                                    data-cursor="button"
                                                    data-cursor-shape={
                                                        room.length < 2
                                                            ? "2"
                                                            : "0"
                                                    }
                                                >
                                                    <button
                                                        className={`items-center font-bold ${room.length < 2 ? "opacity-50" : "active:scale-95"} bg-cyan-600 disabled:opacity-50 w-full justify-center py-2 rounded-lg text-white h-fit flex transition-all duration-200 ease-out`}
                                                        onClick={() => {
                                                            if (
                                                                room.length > 1
                                                            ) {
                                                                handleStartGame();
                                                            }
                                                        }}
                                                    >
                                                        Start Game
                                                    </button>
                                                </div>
                                                <div
                                                    className="rounded-lg w-48 flex"
                                                    data-cursor="button"
                                                    data-cursor-shape="1"
                                                >
                                                    <button
                                                        className="items-center text-center justify-center font-bold py-2 w-full text-cyan-600 h-fit flex transition-all duration-200 ease-out active:scale-95"
                                                        onClick={() =>
                                                            handleLeave()
                                                        }
                                                    >
                                                        Leave
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full w-full flex justify-center items-center">
                                {room.length < 6 ? (
                                    isStarted ? (
                                        currentWord == null ? (
                                            <div
                                                className="font-mono w-fit font-bold text-2xl"
                                                data-cursor="text"
                                            >
                                                Game started
                                            </div>
                                        ) : (
                                            <div className="flex h-full items-center justify-center flex-col gap-2 w-full">
                                                {currentTurnUser?.userId ==
                                                userId ? (
                                                    <>
                                                        <div
                                                            className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                                                            data-cursor="text"
                                                        >
                                                            YOUR TURN
                                                        </div>
                                                    </>
                                                ) : currentTurnUser ? (
                                                    <div
                                                        className="font-bold text-xl px-2 pt-1 pb-1 w-fit flex"
                                                        data-cursor="text"
                                                    >
                                                        {currentTurnUser.displayName +
                                                            "'s Turn"}
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
                                                            currentTurnUser?.userId
                                                        ) {
                                                            socketRef.current?.emit(
                                                                "cuttentInput",
                                                                input,
                                                            );
                                                        }
                                                    }}
                                                    currentInput={
                                                        userId ==
                                                        currentTurnUser?.userId
                                                            ? null
                                                            : currentInput
                                                    }
                                                />
                                            </div>
                                        )
                                    ) : (
                                        !isSpectator && (
                                            <>
                                                <div className="w-full">
                                                    <div
                                                        className="w-fit pl-4 font-bold"
                                                        data-cursor="text"
                                                    >
                                                        Connected
                                                    </div>
                                                </div>
                                                <div className="flex gap-2">
                                                    <div
                                                        className="rounded-lg w-32 flex"
                                                        data-cursor="button"
                                                        data-cursor-shape="1"
                                                    >
                                                        <button
                                                            className="items-center text-center justify-center font-bold py-2 w-full text-cyan-600 h-fit flex transition-all duration-200 ease-out active:scale-95"
                                                            onClick={() =>
                                                                handleWatch()
                                                            }
                                                        >
                                                            Watch Only
                                                        </button>
                                                    </div>
                                                    <div
                                                        className="rounded-lg w-24 flex"
                                                        data-cursor="button"
                                                        data-cursor-shape="0"
                                                    >
                                                        <button
                                                            className="items-center font-bold bg-cyan-600 w-full justify-center py-2 rounded-lg text-white h-fit flex transition-all duration-200 ease-out active:scale-95"
                                                            onClick={() =>
                                                                handleConnect()
                                                            }
                                                        >
                                                            Join
                                                        </button>
                                                    </div>
                                                </div>
                                            </>
                                        )
                                    )
                                ) : (
                                    <div
                                        className="font-mono opacity-50 w-fit pl-4 font-bold"
                                        data-cursor="text"
                                    >
                                        This room is full
                                    </div>
                                )}
                            </div>
                        )
                    ) : (
                        <div className="w-full h-full flex items-center">
                            <div
                                className="w-fit pl-4 font-bold gradient-text"
                                data-cursor="text"
                            >
                                Connecting to server…
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="w-full flex md:order-1">
                <UsersView
                    users={room ?? []}
                    positions={userPositions}
                    userId={userId}
                    currentTurn={isStarted ? currentTurn : null}
                    bombStatus={bombStatus}
                />
            </div>
        </div>
    );
}
