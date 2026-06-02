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

export default function Page() {
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
    const [isStarted, setIsStarted] = useState<boolean>(false);
    const router = useRouter();
    const [isSpectator, setIsSpectator] = useState<boolean>(false);
    const [result, setResult] = useState<boolean | null>(null);
    const [currentInput, setCurrentInput] = useState("");
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
        const url = localStorage.getItem("server-url") ?? "";

        const socket = io(
            typeof window === "undefined" || url === ""
                ? "https://ei-typing.onrender.com"
                : url,
        );

        console.log(url);
        socketRef.current = socket;

        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        const intervalId2 = setInterval(() => {
            socket.emit("fetch", "");
        }, 1000);

        socket.on("connect", () => {});

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

        socket.on("bombExplosioned", (explosionedUserId) => {
            console.log("FAILED USERNAME", explosionedUserId, "Mine:", userId);
            if (!isSpectator) {
                if (userIdRef.current == explosionedUserId) {
                    setResult(true);
                } else {
                    setResult(false);
                }
            }

            const resultTimer = setTimeout(() => {
                setResult(null);
            }, 3000);
        });

        socket.on("joined", (myUuid: string) => {
            userIdRef.current = myUuid;
            setUserId(myUuid);
            console.log("Joined:", myUuid);
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

                console.log("bomb: ", bombStatus);
            },
        );

        socket.on("pulse", (pulseUuid: string) => {
            console.log(pulseUuid);

            if (userIdRef.current !== null) {
                console.log("Sent pulse response📡:", pulseUuid);
                socket.emit("pulseResponse", {
                    userId: userIdRef.current,
                    newPulse: pulseUuid,
                });
            } else {
                console.log("not connected");
            }
        });

        return () => {
            socket.disconnect();
            clearInterval(intervalId);
            clearInterval(intervalId2);
        };
    }, [router]);

    const handleConnect = () => {
        socketRef.current?.emit("joinRoom", displayName);
    };

    const handleWatch = () => {
        setIsSpectator(true);
    };

    const handleStartGame = () => {
        socketRef.current?.emit("startGame");
    };

    return (
        <div className="flex w-full h-full">
            {result !== null && (
                <div className="fixed flex items-center justify-center bg-(--color-background)/50 z-1000 top-0 left-0 w-screen h-screen">
                    <div
                        data-cursor="text"
                        className="font-bold text-4xl animate-[resultAnimation_1000ms_cubic-bezier(0.1,0.5,0,1)]"
                    >
                        {result === false ? "You Survived" : "You Lose"}
                    </div>
                </div>
            )}
            <div className="w-full flex">
                <UsersView
                    users={room ?? []}
                    positions={userPositions}
                    userId={userId}
                    currentTurn={isStarted ? currentTurn : null}
                    bombStatus={bombStatus}
                />
            </div>
            <div
                className={`w-2xl pr-4 gap-4 py-4 h-full justify-end flex flex-col`}
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
        </div>
    );
}
