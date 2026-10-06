"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import GameView from "@/components/feature/GameView";
import { useBombExplosion } from "@/components/feature/BombExplosion";
import Button from "@/components/ui/Button";
import { newPositions } from "@/lib/ui/position";
import type { Item, Position, Room, User } from "@/type";
import posthog from "posthog-js";

type Props = {
    room: Room;
    initialBackgroundMusic: boolean;
    initialSounDeffects: boolean;
};

const LOCAL_USER_ID = "playground-player";

export default function Client({
    room,
    initialBackgroundMusic,
    initialSounDeffects,
}: Readonly<Props>) {
    const router = useRouter();
    const { bombRef, explode, resetExplosion, explosionLayer } =
        useBombExplosion();

    const items = room.items ?? [];
    const [users] = useState<User[]>([
        { id: LOCAL_USER_ID, displayName: "あなた" },
    ]);
    const [positions] = useState<Position[]>(() =>
        newPositions(
            [{ id: LOCAL_USER_ID, displayName: "あなた" }],
            [
                {
                    x: 0,
                    y: 0,
                    w: 24,
                    h: 24,
                    opacity: 0,
                },
            ],
        ),
    );

    const [currentItem, setCurrentItem] = useState<Item | null>(null);
    const [bombStatus, setBombStatus] = useState(0);
    const [currentInput, setCurrentInput] = useState("");
    const [result, setResult] = useState<boolean | null>(null);
    const [isStarted, setIsStarted] = useState(true);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const powerupAudioRef = useRef<HTMLAudioElement | null>(null);
    const firstBombRenderRef = useRef(true);
    const itemTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const chooseRandomItem = useCallback(() => {
        if (items.length === 0) {
            setCurrentItem(null);
            return;
        }

        setCurrentItem(items[Math.floor(Math.random() * items.length)]);
    }, [items]);

    const startGame = useCallback(() => {
        resetExplosion();
        setIsStarted(true);
        setBombStatus(0);
        setCurrentInput("");
        setCurrentItem(null);
        setResult(null);

        if (itemTimerRef.current) clearTimeout(itemTimerRef.current);
        itemTimerRef.current = setTimeout(() => {
            chooseRandomItem();
            itemTimerRef.current = null;
        }, 3000);

        posthog.capture("playground_started", {
            room_id: room.id,
            item_count: items.length,
        });
    }, [chooseRandomItem, items.length, resetExplosion, room.id]);

    useEffect(() => {
        queueMicrotask(startGame);

        return () => {
            if (itemTimerRef.current) clearTimeout(itemTimerRef.current);
        };
    }, [startGame]);

    useEffect(() => {
        if (!isStarted || result !== null || items.length === 0) return;

        const configuredDuration = room.gameDuration ?? 20;
        const baseDuration =
            Number.isInteger(configuredDuration) &&
            configuredDuration >= 1 &&
            configuredDuration <= 2147473
                ? configuredDuration
                : 20;
        const duration = (baseDuration + Math.random() * 10) * 1000;

        const timer = setTimeout(() => {
            if (bombStatus === 4) {
                explode();
                setIsStarted(false);
                setResult(true);
                posthog.capture("playground_finished", {
                    room_id: room.id,
                });
                return;
            }

            setBombStatus((status) => status + 1);
        }, duration);

        return () => clearTimeout(timer);
    }, [
        bombStatus,
        explode,
        isStarted,
        items.length,
        result,
        room.gameDuration,
        room.id,
    ]);

    useEffect(() => {
        if (firstBombRenderRef.current) {
            firstBombRenderRef.current = false;
            return;
        }

        if (!initialSounDeffects || result !== null) return;

        const audio = powerupAudioRef.current;
        if (!audio) return;

        audio.currentTime = 0;
        audio.volume = 1;
        audio.play().catch(() => {});
    }, [bombStatus, initialSounDeffects, result]);

    useEffect(() => {
        powerupAudioRef.current = new Audio("/Powerup_1.wav");
        audioRef.current = new Audio("/MT-RD_17_for_Loop.wav");
        audioRef.current.loop = true;

        const startAudio = () => {
            if (initialBackgroundMusic && audioRef.current) {
                audioRef.current
                    .play()
                    .then(removeListeners)
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
            audioRef.current?.pause();
        };
    }, [initialBackgroundMusic]);

    const handleSuccess = () => {
        setCurrentInput("");
        chooseRandomItem();
        posthog.capture("playground_word_succeeded", {
            room_id: room.id,
            item_id: currentItem?.id,
        });
    };

    const serverError =
        items.length === 0 ? "このルームには問題がありません。" : null;

    return (
        <GameView
            room={room}
            users={users}
            positions={positions}
            userId={LOCAL_USER_ID}
            currentTurn={0}
            bombStatus={bombStatus}
            currentItem={currentItem}
            currentInput={currentInput}
            isStarted={isStarted}
            serverError={serverError}
            result={result}
            lostDisplayName="あなた"
            bombRef={bombRef}
            explosionLayer={explosionLayer}
            onSuccess={handleSuccess}
            onChangeInput={setCurrentInput}
            onPlayAgain={startGame}
            onCreateRoom={() =>
                router.push(process.env.NEXT_PUBLIC_SIGN_IN_URL!)
            }
            resultExtraActions={
                <Button
                    iconName="link"
                    className="w-full"
                    onClick={() => router.push("/room")}
                >
                    別のルームを選ぶ
                </Button>
            }
        />
    );
}
