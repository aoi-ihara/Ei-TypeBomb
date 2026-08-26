"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import UsersView from "@/components/feature/UsersView";
import TypingView from "@/components/feature/InputView";
import { Room, Word, User, Position } from "@/type";
import { newPositions } from "@/lib/ui/position";
import posthog from "posthog-js";
import Button from "@/components/ui/Button";

type Props = {
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
    initialServerUrl: string;
};

const MOCK_WORDS: Word[] = [
    { jp: "りんご", en: "apple" },
    { jp: "猫", en: "cat" },
    { jp: "犬", en: "dog" },
    { jp: "太陽", en: "sun" },
    { jp: "月", en: "moon" },
    { jp: "星", en: "star" },
    { jp: "水", en: "water" },
    { jp: "火", en: "fire" },
    { jp: "本", en: "book" },
    { jp: "学校", en: "school" },
    { jp: "未来", en: "future" },
    { jp: "技術", en: "technology" },
    { jp: "科学", en: "science" },
    { jp: "世界", en: "world" },
    { jp: "自然", en: "nature" },
    { jp: "冒険", en: "adventure" },
    { jp: "挑戦", en: "challenge" },
    { jp: "創造", en: "create" },
    { jp: "発見", en: "discover" },
    { jp: "成長", en: "growth" },
    { jp: "コンピューター", en: "computer" },
    { jp: "プログラム", en: "program" },
    { jp: "インターネット", en: "internet" },
    { jp: "人工知能", en: "ai" },
    { jp: "ロボット", en: "robot" },
    { jp: "ゲーム", en: "game" },
    { jp: "音楽", en: "music" },
    { jp: "映画", en: "movie" },
    { jp: "写真", en: "photo" },
    { jp: "旅行", en: "travel" },
    { jp: "素晴らしい", en: "amazing" },
    { jp: "楽しい", en: "fun" },
    { jp: "速い", en: "fast" },
    { jp: "強い", en: "strong" },
    { jp: "美しい", en: "beautiful" },
];

const LOCAL_USER_ID = "player-1";

export default function Client({
    initialBackgroundMusic,
    initialSounDeffects,
}: Props) {
    const [userId] = useState<string>(LOCAL_USER_ID);
    const [displayName] = useState<string>(() => {
        if (typeof window === "undefined") return "たま";
        return localStorage.getItem("display-name") || "たま";
    });

    const [users] = useState<User[]>(() => [
        { id: LOCAL_USER_ID, displayName: displayName },
        { id: "bot-1", displayName: "Bot 1" },
        { id: "bot-2", displayName: "Bot 2" },
    ]);

    const [room] = useState<Room>(() => ({
        id: "local-room",
        maxPlayers: 3,
        isStart: true,
        users: [
            { id: LOCAL_USER_ID, displayName: displayName },
            { id: "bot-1", displayName: "Bot 1" },
            { id: "bot-2", displayName: "Bot 2" },
        ],
        words: MOCK_WORDS,
    }));

    const [currentWord, setCurrentWord] = useState<Word | null>(null);
    const [currentTurn, setCurrentTurn] = useState<number>(0);
    const [bombStatus, setBombStatus] = useState<number>(0);
    const [isStarted, setIsStarted] = useState<boolean>(true);
    const [result, setResult] = useState<boolean | null>(null);
    const [currentInput, setCurrentInput] = useState("");
    const [lostDisplayName, setLostDisplayName] = useState<string | null>(null);

    const [userPositions] = useState<Position[]>(() =>
        newPositions(
            [
                { id: LOCAL_USER_ID, displayName: displayName },
                { id: "bot-1", displayName: "Bot 1" },
                { id: "bot-2", displayName: "Bot 2" },
            ],
            Array.from({ length: 3 }, () => ({
                x: 0,
                y: 0,
                w: 24,
                h: 24,
                opacity: 0,
            })),
        ),
    );

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const blipAudioRef = useRef<HTMLAudioElement | null>(null);
    const powerupAudioRef = useRef<HTMLAudioElement | null>(null);
    const router = useRouter();

    const currentTurnUser = users[currentTurn] as User | undefined;

    const currentTurnRef = useRef(currentTurn);
    const usersRef = useRef(users);

    useEffect(() => {
        currentTurnRef.current = currentTurn;
    }, [currentTurn]);

    useEffect(() => {
        usersRef.current = users;
    }, [users]);

    const startGame = useCallback(() => {
        setIsStarted(true);
        setBombStatus(0);
        setCurrentTurn(Math.floor(Math.random() * users.length));
        setCurrentWord(null);
        setCurrentInput("");
        setResult(null);
        setLostDisplayName(null);
        setTimeout(() => {
            setCurrentWord(
                MOCK_WORDS[Math.floor(Math.random() * MOCK_WORDS.length)],
            );
        }, 3000);
    }, [users.length]);

    useEffect(() => {
        blipAudioRef.current = new Audio("/Blip_select_8.wav");
        powerupAudioRef.current = new Audio("/Powerup_1.wav");

        posthog.capture("game_started_offline", {
            player_count: 3,
        });

        queueMicrotask(() => {
            startGame();
        });
    }, [startGame]);

    const handleSuccess = useCallback(() => {
        if (powerupAudioRef.current && initialSounDeffects) {
            powerupAudioRef.current.currentTime = 0;
            powerupAudioRef.current.volume = 1;
            powerupAudioRef.current.play().catch(() => {});
        }

        setCurrentInput("");
        setCurrentTurn((prev) => (prev + 1) % users.length);
        setCurrentWord(
            MOCK_WORDS[Math.floor(Math.random() * MOCK_WORDS.length)],
        );

        posthog.capture("word_succeeded");
    }, [users.length, initialSounDeffects]);

    useEffect(() => {
        if (!isStarted || result !== null) return;

        const duration = Math.floor(Math.random() * 10000) + 20000;

        const timer = setTimeout(() => {
            setBombStatus((prev) => {
                const nextStatus = prev + 1;

                if (nextStatus > 4) {
                    const lostUser = usersRef.current[currentTurnRef.current];
                    const didLose = lostUser?.id === userId;

                    setResult(didLose);
                    setLostDisplayName(lostUser?.displayName || "Unknown");

                    posthog.capture(didLose ? "game_lost" : "game_won");
                }

                return nextStatus;
            });
        }, duration);

        return () => clearTimeout(timer);
    }, [isStarted, result, bombStatus, userId, startGame]);

    useEffect(() => {
        if (
            !isStarted ||
            result !== null ||
            !currentWord ||
            currentTurnUser?.id === userId
        )
            return;

        let timeoutId: NodeJS.Timeout;
        let isCancelled = false;

        const target = currentWord.en;
        let charIndex = 0;

        const typeNextChar = () => {
            if (isCancelled) return;

            if (charIndex < target.length) {
                charIndex++;
                setCurrentInput(target.slice(0, charIndex));

                const speed = Math.floor(Math.random() * 100) + 180;
                timeoutId = setTimeout(typeNextChar, speed);
            } else {
                timeoutId = setTimeout(() => {
                    if (!isCancelled) {
                        handleSuccess();
                    }
                }, 200);
            }
        };

        const initialDelay = Math.floor(Math.random() * 400) + 500;
        timeoutId = setTimeout(typeNextChar, initialDelay);

        return () => {
            isCancelled = true;
            clearTimeout(timeoutId);
        };
    }, [
        isStarted,
        currentTurn,
        currentWord,
        result,
        currentTurnUser,
        userId,
        handleSuccess,
    ]);

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
            if (audioRef.current) audioRef.current.pause();
        };
    }, [initialBackgroundMusic, router]);

    return (
        <div className="flex flex-col md:flex-row w-full h-full">
            {(result !== null || lostDisplayName) && (
                <div className="fixed flex items-center flex-col gap-4 justify-center bg-(--color-background)/75 z-1 top-0 left-0 w-screen h-screen">
                    <div className="w-sm flex flex-col gap-4 items-center animate-[resultAnimation_1000ms_cubic-bezier(0.1,0.5,0,1)]">
                        <div data-cursor="text" className="font-bold text-4xl">
                            {result === true
                                ? "You Lose"
                                : `${lostDisplayName} Lose`}
                        </div>

                        <Button
                            iconName="rotateCw"
                            className="w-full"
                            variant="primary"
                            onClick={() => {
                                setResult(null);
                                startGame();
                            }}
                        >
                            Play Again
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
                            Create Your Room
                        </Button>

                        <Button
                            iconName="link"
                            className="w-full"
                            onClick={() => router.push("/room")}
                        >
                            Join with Invite Link
                        </Button>
                    </div>
                </div>
            )}

            <div className="max-w-3xl md:order-2 w-full px-4 gap-4 pb-4 pt-4 h-full justify-end flex flex-col">
                <div
                    className={`flex flex-col bg-(--color-background-secondary) transition-all duration-200 ease-[cubic-bezier(0.1,0.5,0,1)] ${currentTurn === 0 ? "h-full" : "h-64"} rounded-2xl p-2 w-full`}
                >
                    {room && (
                        <div className="flex flex-col h-full">
                            <div className="flex h-full">
                                <div className="w-full flex flex-col items-center justify-center gap-4">
                                    {isStarted ? (
                                        currentWord === null ? (
                                            <div
                                                className="font-mono w-fit font-bold text-2xl"
                                                data-cursor="text"
                                            >
                                                Game started
                                            </div>
                                        ) : (
                                            <div className="flex h-full items-center justify-center flex-col gap-2 w-full">
                                                {currentTurnUser && (
                                                    <div
                                                        className="font-bold opacity-50 px-2 pt-1 pb-1 w-fit flex"
                                                        data-cursor="text"
                                                    >
                                                        {currentTurnUser?.id !==
                                                        userId
                                                            ? currentTurnUser.displayName +
                                                              "'s Turn"
                                                            : "YOUR TURN"}
                                                    </div>
                                                )}

                                                <TypingView
                                                    japanese={currentWord.jp}
                                                    english={currentWord.en}
                                                    onSuccess={handleSuccess}
                                                    onChangeInput={(input) => {
                                                        if (
                                                            userId ==
                                                            currentTurnUser?.id
                                                        ) {
                                                            setCurrentInput(
                                                                input,
                                                            );
                                                        }
                                                    }}
                                                    currentInput={
                                                        result !== null
                                                            ? ""
                                                            : userId ===
                                                                currentTurnUser?.id
                                                              ? null
                                                              : currentInput
                                                    }
                                                />
                                            </div>
                                        )
                                    ) : null}
                                </div>
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
                    Demo Room
                </div>
                <UsersView
                    users={users}
                    positions={userPositions}
                    bombStatus={bombStatus}
                    currentTurn={currentTurn}
                    userId={userId}
                />
            </div>
        </div>
    );
}
