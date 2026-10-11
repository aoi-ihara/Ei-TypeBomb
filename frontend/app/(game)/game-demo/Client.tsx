"use client";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import GameView from "@/components/feature/GameView";
import { Item, Room, User, Position } from "@/type";
import { newPositions } from "@/lib/ui/position";
import posthog from "posthog-js";
import Button from "@/components/ui/Button";

type Props = {
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
};

const MOCK_ITEM_CONTENT = [
    ["見る", "see"],
    ["見る", "look"],
    ["りんご", "apple"],
    ["猫", "cat"],
    ["犬", "dog"],
    ["太陽", "sun"],
    ["月", "moon"],
    ["星", "star"],
    ["水", "water"],
    ["火", "fire"],
    ["本", "book"],
    ["学校", "school"],
    ["未来", "future"],
    ["技術", "technology"],
    ["科学", "science"],
    ["世界", "world"],
    ["自然", "nature"],
    ["冒険", "adventure"],
    ["挑戦", "challenge"],
    ["創造", "create"],
    ["発見", "discover"],
    ["成長", "growth"],
    ["コンピューター", "computer"],
    ["プログラム", "program"],
    ["インターネット", "internet"],
    ["人工知能", "ai"],
    ["ロボット", "robot"],
    ["ゲーム", "game"],
    ["音楽", "music"],
    ["映画", "movie"],
    ["写真", "photo"],
    ["旅行", "travel"],
    ["素晴らしい", "amazing"],
    ["楽しい", "fun"],
    ["速い", "fast"],
    ["強い", "strong"],
    ["美しい", "beautiful"],
] as const;

const MOCK_ITEMS: Item[] = MOCK_ITEM_CONTENT.map(
    ([prompt, answer], index) => ({
        id: `demo-${index}`,
        type: "typed_recall",
        prompt,
        answer,
    }),
);

const LOCAL_USER_ID = "player-1";

export default function Client({
    initialBackgroundMusic,
    initialSounDeffects,
}: Props) {
    const { bombRef, explode, resetExplosion, explosionLayer } =
        useBombExplosion();
    const [userId] = useState<string>(LOCAL_USER_ID);
    const [displayName] = useState<string>(() => {
        if (typeof window === "undefined") return "たま";
        return localStorage.getItem("display-name") || "たま";
    });

    const [users] = useState<User[]>(() => [
        { id: LOCAL_USER_ID, displayName: displayName },
        { id: "bot-1", displayName: "ボット1" },
        { id: "bot-2", displayName: "ボット2" },
    ]);

    const [room] = useState<Room>(() => ({
        id: "local-room",
        maxPlayers: 3,
        isStart: true,
        users: [
            { id: LOCAL_USER_ID, displayName: displayName },
            { id: "bot-1", displayName: "ボット1" },
            { id: "bot-2", displayName: "ボット2" },
        ],
        items: MOCK_ITEMS,
        title: "デモルーム",
    }));

    const [currentItem, setCurrentItem] = useState<Item | null>(null);
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
                { id: "bot-1", displayName: "ボット1" },
                { id: "bot-2", displayName: "ボット2" },
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
        resetExplosion();
        setIsStarted(true);
        setBombStatus(0);
        setCurrentTurn(Math.floor(Math.random() * users.length));
        setCurrentItem(null);
        setCurrentInput("");
        setResult(null);
        setLostDisplayName(null);
        setTimeout(() => {
            setCurrentItem(
                MOCK_ITEMS[Math.floor(Math.random() * MOCK_ITEMS.length)],
            );
        }, 3000);
    }, [users.length, resetExplosion]);

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
        setCurrentItem(
            MOCK_ITEMS[Math.floor(Math.random() * MOCK_ITEMS.length)],
        );

        posthog.capture("word_succeeded");
    }, [users.length, initialSounDeffects]);

    useEffect(() => {
        if (!isStarted || result !== null) return;

        const duration = Math.floor(Math.random() * 10000) + 20000;

        const timer = setTimeout(() => {
            const nextStatus = bombStatus + 1;
            if (nextStatus > 4) {
                explode();
                const lostUser = usersRef.current[currentTurnRef.current];
                const didLose = lostUser?.id === userId;
                setResult(didLose);
                setLostDisplayName(lostUser?.displayName || "不明なプレイヤー");
                posthog.capture(didLose ? "game_lost" : "game_won");
            }
            setBombStatus(nextStatus);
        }, duration);

        return () => clearTimeout(timer);
    }, [isStarted, result, bombStatus, userId, startGame, explode]);

    useEffect(() => {
        if (
            !isStarted ||
            result !== null ||
            !currentItem ||
            currentTurnUser?.id === userId
        )
            return;

        let timeoutId: NodeJS.Timeout;
        let isCancelled = false;

        if (currentItem.type !== "typed_recall") return;

        const target = currentItem.answer;
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
        currentItem,
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
        <GameView
            room={room}
            users={users}
            positions={userPositions}
            userId={userId}
            currentTurn={currentTurn}
            bombStatus={bombStatus}
            currentItem={currentItem}
            currentInput={currentInput}
            isStarted={isStarted}
            result={result}
            lostDisplayName={lostDisplayName}
            bombRef={bombRef}
            explosionLayer={explosionLayer}
            onSuccess={handleSuccess}
            onChangeInput={setCurrentInput}
            onPlayAgain={() => {
                setResult(null);
                startGame();
            }}
            onCreateRoom={() =>
                router.push(getSignInUrl())
            }
            resultExtraActions={
                <Button
                    iconName="link"
                    className="w-full"
                    onClick={() => router.push("/room")}
                >
                    招待リンクで参加
                </Button>
            }
        />
    );
}
