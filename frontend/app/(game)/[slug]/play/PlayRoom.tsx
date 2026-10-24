"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Shell from "@/components/layout/Shell";
import { PopUp } from "@/components/ui/PopUp";
import { TurnstileChallenge } from "@/components/ui/TurnstileChallenge";
import { getRoomStatusFromId } from "@/lib/room/get";
import { signInToRoom } from "@/lib/room/auth";
import posthog from "posthog-js";

type PlayMode = "online" | "playground";

export default function PlayRoom({
    roomId,
    title,
    alreadyAuthorized,
}: {
    roomId: string;
    title: string;
    alreadyAuthorized: boolean;
}) {
    const router = useRouter();
    const [roomLoading, setRoomLoading] = useState(!alreadyAuthorized);
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [roomPassword, setRoomPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [selectedMode, setSelectedMode] = useState<PlayMode>("online");
    const [joining, setJoining] = useState<PlayMode | null>(null);
    const [turnstile, setTurnstile] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        setDisplayName(localStorage.getItem("display-name") ?? "");
        if (alreadyAuthorized) {
            setRoomLoading(false);
            return;
        }

        let active = true;
        getRoomStatusFromId(roomId)
            .then((result) => {
                if (!active) return;
                setRoomLoading(false);
                if (result === null) {
                    setError("ルーム情報を取得できませんでした。");
                    return;
                }
                setShowPasswordField(result);
            })
            .catch((reason) => {
                if (!active) return;
                console.error("Failed to load room status:", reason);
                setRoomLoading(false);
                setError("ルーム情報を取得できませんでした。");
            });

        return () => {
            active = false;
        };
    }, [roomId, alreadyAuthorized]);

    const handleSignIn = async (
        turnstileToken?: string,
        mode: PlayMode = selectedMode,
    ) => {
        if (mode === "online" && !displayName.trim()) {
            setError("表示名を入力してください。");
            return;
        }

        setJoining(mode);
        setError("");

        if (mode === "online") {
            localStorage.setItem("display-name", displayName.trim());
            posthog.capture("display_name_set");
        }

        if (alreadyAuthorized) {
            posthog.capture("room_entered", {
                room_id: roomId,
                play_mode: mode,
            });
            router.push("/" + roomId + "/play/" + (mode === "online" ? "online" : "playground"));
            return;
        }

        const result = await signInToRoom(
            {
                id: roomId,
                password: showPasswordField ? roomPassword : "",
            },
            turnstileToken,
        );

        if (result === null) {
            posthog.capture("room_entered", {
                room_id: roomId,
                play_mode: mode,
            });
            router.push("/" + roomId + "/play/" + (mode === "online" ? "online" : "playground"));
        } else {
            posthog.capture("room_entry_failed", {
                room_id: roomId,
                play_mode: mode,
                reason: result,
            });
            setError(result);
            setJoining(null);
        }
    };

    const handleContinue = () => {
        if (selectedMode === "online" && !displayName.trim()) {
            setError("表示名を入力してください。");
            return;
        }
        if (showPasswordField && !alreadyAuthorized) {
            setTurnstile(true);
            return;
        }
        void handleSignIn();
    };

    return (
        <Shell title={title} size="small" loading={roomLoading} animateAppear>
            <p className="w-full text-start text-sm opacity-70">
                プレイ方法を選択してください。
            </p>

            <div className="grid w-full grid-cols-2 gap-3">
                <Button
                    onClick={() => setSelectedMode("online")}
                    variant={selectedMode === "online" ? "primary" : "text"}
                    className="w-full"
                    iconName="users"
                >
                    マルチ
                </Button>
                <Button
                    onClick={() => setSelectedMode("playground")}
                    variant={selectedMode === "playground" ? "primary" : "text"}
                    className="w-full"
                    iconName="user"
                >
                    シングル
                </Button>
            </div>

            {showPasswordField && !alreadyAuthorized && (
                <Input
                    value={roomPassword}
                    type="password"
                    onChange={(event) => setRoomPassword(event.target.value)}
                    label="ルームのパスワード"
                />
            )}

            {selectedMode === "online" && (
                <Input
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    label="表示名"
                />
            )}

            {error && <p className="w-full text-sm text-red-500" role="alert">{error}</p>}

            <Button
                onClick={handleContinue}
                className="w-full"
                variant="primary"
                disabled={
                    joining !== null ||
                    (showPasswordField && !alreadyAuthorized && !roomPassword) ||
                    (selectedMode === "online" && !displayName.trim())
                }
                loading={joining !== null}
                iconName="arrowRight"
            >
                続ける
            </Button>

            <PopUp show={turnstile}>
                <TurnstileChallenge
                    onSuccess={(token) => {
                        setTurnstile(false);
                        void handleSignIn(token);
                    }}
                    onFail={(reason) => {
                        setTurnstile(false);
                        setError(reason);
                    }}
                    onCancel={() => setTurnstile(false)}
                />
            </PopUp>
        </Shell>
    );
}
