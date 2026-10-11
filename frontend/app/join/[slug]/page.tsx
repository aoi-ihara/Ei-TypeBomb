"use client";

import { useEffect, useState, use } from "react";
import Input from "@/components/ui/Input";
import { notFound, useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { getRoomFromLink, getRoomStatusFromId } from "@/lib/room/get";
import { signInToRoom } from "@/lib/room/auth";
import { PopUp } from "@/components/ui/PopUp";
import { TurnstileChallenge } from "@/components/ui/TurnstileChallenge";
import posthog from "posthog-js";
import Shell from "@/components/layout/Shell";

type PlayMode = "online" | "playground";

export default function Page({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);
    const [roomId, setRoomId] = useState("");
    const [error, setError] = useState("");
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [roomLoading, setRoomLoading] = useState(true);
    const [joiningMode, setJoiningMode] = useState<PlayMode | null>(null);
    const [roomPassword, setRoomPassword] = useState("");
    const [turnstile, setTurnstile] = useState(false);
    const [selectedMode, setSelectedMode] = useState<PlayMode>("online");
    const [isNotFound, setIsNotFound] = useState(false);

    const router = useRouter();

    const handleSignIn = async (turnstileToken?: string, mode: PlayMode = selectedMode) => {
        setJoiningMode(mode);
        const result = await signInToRoom(
            {
                id: roomId,
                password: roomPassword,
            },
            turnstileToken,
        );

        if (result === null) {
            posthog.capture("room_entered", { room_id: roomId, play_mode: mode });
            router.push(mode === "online" ? "/display-name" : "/playground");
        } else {
            posthog.capture("room_entry_failed", {
                room_id: roomId,
                reason: result,
            });
            setError(result);
        }
        setJoiningMode(null);
    };

    const handleTurnstileFail = (reason: string, errorCode?: string) => {
        setTurnstile(false);
        posthog.capture("room_entry_failed", {
            room_id: roomId,
            reason,
            turnstile_error_code: errorCode,
        });
        setError(reason);
    };

    useEffect(() => {
        const fetchData = async () => {
            const roomIdResult = await getRoomFromLink(slug);
            if (!roomIdResult) {
                setIsNotFound(true);
                return;
            }
            setRoomId(roomIdResult);

            const result = await getRoomStatusFromId(roomIdResult);
            setRoomLoading(false);

            if (result === null) {
                setIsNotFound(true);
                return;
            }

            setShowPasswordField(result === true);
            setError("");
        };

        fetchData();
    }, []);

    if (isNotFound) notFound();

    return (
        <Shell
            title={showPasswordField ? "パスワードを入力" : "プレイモードを選択"}
            loading={roomLoading}
        >
            {showPasswordField && (
                <Input
                    value={roomPassword}
                    type="password"
                    onChange={(e) => setRoomPassword(e.target.value)}
                    label="ルームのパスワード"
                />
            )}

            <div className="grid grid-cols-2 gap-4 w-full">
                {(["online", "playground"] as const).map((mode) => (
                    <Button
                        key={mode}
                        onClick={() => {
                            setSelectedMode(mode);
                            setError("");
                            if (showPasswordField) {
                                setTurnstile(true);
                            } else {
                                void handleSignIn(undefined, mode);
                            }
                        }}
                        className="w-full"
                        variant="primary"
                        iconName={mode === "online" ? "users" : "user"}
                        disabled={!roomId || roomLoading || joiningMode !== null || (showPasswordField && !roomPassword)}
                        loading={joiningMode === mode}
                    >
                        {mode === "online" ? "マルチ" : "シングル"}
                    </Button>
                ))}
            </div>
            {error && (
                <a className="text-red-500" data-cursor="text">
                    {error}
                </a>
            )}

            <PopUp show={turnstile}>
                <TurnstileChallenge
                    onSuccess={(turnstileToken: string) => {
                        setTurnstile(false);
                        handleSignIn(turnstileToken);
                    }}
                    onFail={handleTurnstileFail}
                    onCancel={() => setTurnstile(false)}
                />
            </PopUp>
        </Shell>
    );
}
