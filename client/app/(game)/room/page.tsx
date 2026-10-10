"use client";

import { useEffect, useState } from "react";
import Input from "@/components/ui/Input";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { prepareRoomJoin, signInToRoom } from "@/lib/room/auth";
import { PopUp } from "@/components/ui/PopUp";
import { TurnstileChallenge } from "@/components/ui/TurnstileChallenge";
import posthog from "posthog-js";

type PlayMode = "online" | "playground";

const pathForMode = (mode: PlayMode) =>
    mode === "online" ? "/display-name" : "/playground";

export default function Loading() {
    const [showCursor, setShowCursor] = useState(true);
    const [link, setLink] = useState("");
    const [error, setError] = useState("");
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [loadingMode, setLoadingMode] = useState<PlayMode | null>(null);
    const [roomPassword, setRoomPassword] = useState("");
    const [turnstile, setTurnstile] = useState(false);
    const [roomId, setRoomId] = useState("");
    const [selectedMode, setSelectedMode] = useState<PlayMode>("online");

    const router = useRouter();

    const enterRoom = (mode: PlayMode, normalizedRoomId: string) => {
        posthog.capture("room_entered", {
            room_id: normalizedRoomId,
            play_mode: mode,
        });
        router.push(pathForMode(mode));
    };

    const handleSignIn = async (turnstileToken: string) => {
        const mode = selectedMode;
        setLoadingMode(mode);

        const result = await signInToRoom(
            {
                id: roomId,
                password: roomPassword,
            },
            turnstileToken,
        );

        if (result === null) {
            enterRoom(mode, roomId);
        } else {
            posthog.capture("room_entry_failed", {
                room_id: roomId,
                reason: result,
                play_mode: mode,
            });
            setError(result);
        }

        setLoadingMode(null);
    };

    const handleTurnstileFail = (reason: string, errorCode?: string) => {
        setTurnstile(false);
        setLoadingMode(null);
        posthog.capture("room_entry_failed", {
            room_id: roomId,
            reason,
            turnstile_error_code: errorCode,
            play_mode: selectedMode,
        });
        setError(reason);
    };

    const handleMode = async (mode?: PlayMode) => {
        if (showPasswordField) {
            setError("");
            setTurnstile(true);
            return;
        }

        if (mode) {
            setSelectedMode(mode);
            setLoadingMode(mode);
        }

        setError("");

        const roomResult = await prepareRoomJoin(
            link.replace(process.env.NEXT_PUBLIC_JOIN_LINK!, ""),
        );

        if (!roomResult) {
            posthog.capture("room_entry_failed", {
                reason: "ルームが見つかりません。",
                play_mode: mode,
            });
            setError("ルームが見つかりません。");
            setLoadingMode(null);
            return;
        }

        if ("error" in roomResult && roomResult.error) {
            posthog.capture("room_entry_failed", {
                reason: roomResult.error,
                play_mode: mode,
            });
            setError(roomResult.error);
            setLoadingMode(null);
            return;
        }

        const normalizedRoomId = roomResult.id.toLowerCase();
        setRoomId(normalizedRoomId);

        if (roomResult.requiresPassword) {
            setShowPasswordField(true);
            setLoadingMode(null);
            return;
        }

        enterRoom(mode ?? selectedMode, normalizedRoomId);
        setLoadingMode(null);
    };

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    const modeButtonsDisabled =
        !link || (showPasswordField && !roomPassword) || loadingMode !== null;

    return (
        <div className="flex flex-col w-full max-w-md px-4 gap-4 items-center pt-16">
            <div className="flex items-end mb-4">
                <h1 className="font-bold text-2xl" data-cursor="text">
                    ルームを選択
                </h1>
                <div
                    className={`w-3 h-1 mb-1 ml-1 bg-cyan-600 ${!showCursor && "opacity-0"}`}
                />
            </div>

            <Input
                disabled={showPasswordField}
                value={link}
                font="mono"
                type="url"
                onChange={(e) => setLink(e.target.value)}
                label="招待リンク"
            />

            {showPasswordField ? (
                <div className="animate-appear flex flex-col gap-4 w-full">
                    <Input
                        value={roomPassword}
                        type="password"
                        onChange={(e) => setRoomPassword(e.target.value)}
                        label="ルームのパスワード"
                    />
                    <Button
                        onClick={() => handleMode()}
                        className="w-full"
                        disabled={modeButtonsDisabled}
                        loading={loadingMode === "playground"}
                        iconName="arrowRight"
                        variant="primary"
                    >
                        続ける
                    </Button>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-4 w-full">
                    <Button
                        onClick={() => handleMode("online")}
                        className="w-full"
                        variant="primary"
                        disabled={modeButtonsDisabled}
                        loading={loadingMode === "online"}
                        iconName="users"
                    >
                        マルチ
                    </Button>
                    <Button
                        onClick={() => handleMode("playground")}
                        className="w-full"
                        variant="primary"
                        disabled={modeButtonsDisabled}
                        loading={loadingMode === "playground"}
                        iconName="user"
                    >
                        シングル
                    </Button>
                </div>
            )}

            {!link && (
                <Button
                    onClick={() => router.push("/game-demo")}
                    className="w-full animate-appear"
                    iconName="play"
                >
                    デモをプレイ
                </Button>
            )}

            {error && (
                <a className="text-red-500" data-cursor="text">
                    {error}
                </a>
            )}

            <PopUp show={turnstile}>
                <TurnstileChallenge
                    onSuccess={(turnstileToken: string) => {
                        setTurnstile(false);
                        void handleSignIn(turnstileToken);
                    }}
                    onFail={handleTurnstileFail}
                    onCancel={() => setTurnstile(false)}
                />
            </PopUp>
        </div>
    );
}
