"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import MorphDialog from "@/components/ui/MorphDialog";
import { PopUp } from "@/components/ui/PopUp";
import { TurnstileChallenge } from "@/components/ui/TurnstileChallenge";
import { getRoomStatusFromId } from "@/lib/room/get";
import { signInToRoom } from "@/lib/room/auth";
import posthog from "posthog-js";

type PlayMode = "online" | "offline";

export default function PlayRoom({
    roomId,
    alreadyAuthorized,
    itemCount,
    isOwner,
    slug,
}: {
    roomId: string;
    alreadyAuthorized: boolean;
    itemCount: number;
    isOwner: boolean;
    slug: string;
}) {
    const router = useRouter();
    const [roomLoading, setRoomLoading] = useState(!alreadyAuthorized);
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [roomPassword, setRoomPassword] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [activeDialog, setActiveDialog] = useState<PlayMode | null>(null);
    const [joining, setJoining] = useState<PlayMode | null>(null);
    const [turnstile, setTurnstile] = useState(false);
    const [turnstileMode, setTurnstileMode] = useState<PlayMode | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;

        void Promise.resolve().then(() => {
            if (!active) return;
            try {
                setDisplayName(
                    window.localStorage.getItem("display-name") ?? "",
                );
            } catch (reason) {
                console.error("Failed to load display name:", reason);
            }
        });

        if (alreadyAuthorized) {
            return () => {
                active = false;
            };
        }

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

    const navigateToMode = (mode: PlayMode) => {
        posthog.capture("room_entered", {
            room_id: roomId,
            play_mode: mode,
        });
        startNavigationProgress();
        router.push("/" + roomId + "/" + mode);
    };

    const handleSignIn = async (
        turnstileToken: string | undefined,
        mode: PlayMode,
    ) => {
        if (itemCount === 0) {
            setError(
                "このルームには単語がありません。ルームの所有者が単語を追加するまでプレイできません。",
            );
            return;
        }
        if (mode === "online" && !displayName.trim()) {
            setError("表示名を入力してください。");
            return;
        }

        setJoining(mode);
        setError("");

        if (mode === "online") {
            try {
                localStorage.setItem("display-name", displayName.trim());
            } catch (reason) {
                console.error("Failed to save display name:", reason);
            }
            posthog.capture("display_name_set");
        }

        if (alreadyAuthorized) {
            navigateToMode(mode);
            return;
        }

        try {
            const result = await signInToRoom(
                {
                    id: roomId,
                    password: showPasswordField ? roomPassword : "",
                },
                turnstileToken,
            );

            if (result === null) {
                navigateToMode(mode);
                return;
            }

            posthog.capture("room_entry_failed", {
                room_id: roomId,
                play_mode: mode,
                reason: result,
            });
            setError(result);
            setJoining(null);
        } catch (reason) {
            console.error("Failed to authorize room:", reason);
            setError("ルームの認証に失敗しました。もう一度お試しください。");
            setJoining(null);
        }
    };

    const handleContinue = (mode: PlayMode) => {
        if (itemCount === 0) {
            setError(
                "このルームには単語がありません。ルームの所有者が単語を追加するまでプレイできません。",
            );
            return;
        }
        if (mode === "online" && !displayName.trim()) {
            setError("表示名を入力してください。");
            return;
        }

        setError("");
        if (showPasswordField && !alreadyAuthorized) {
            setTurnstileMode(mode);
            setTurnstile(true);
            return;
        }
        void handleSignIn(undefined, mode);
    };

    const renderModeDialog = (mode: PlayMode) => {
        const isOnline = mode === "online";
        const title = isOnline ? "オンライン" : "オフライン";
        const isActive = activeDialog === mode;

        return (
            <MorphDialog
                key={mode}
                button={
                    <Button
                        onClick={() => {
                            setError("");
                            if (
                                mode === "offline" &&
                                (!showPasswordField || alreadyAuthorized)
                            ) {
                                handleContinue(mode);
                            } else {
                                setActiveDialog(mode);
                            }
                        }}
                        className="w-full"
                        variant="primary"
                        iconName={isOnline ? "users" : "user"}
                        disabled={roomLoading || itemCount === 0}
                    >
                        {isOnline ? "オンライン" : "オフライン"}
                    </Button>
                }
                title={title}
                description={
                    isOnline
                        ? showPasswordField && !alreadyAuthorized
                            ? "表示名とパスワードを入力してください。"
                            : "表示名を入力してください。"
                        : "パスワードを入力してください。"
                }
                alignment="vertical"
                size="middle"
                open={isActive}
                onClose={() => setActiveDialog(null)}
            >
                {showPasswordField && !alreadyAuthorized && (
                    <Input
                        value={roomPassword}
                        type="password"
                        onChange={(event) =>
                            setRoomPassword(event.target.value)
                        }
                        label="ルームのパスワード"
                        disabled={joining !== null}
                        autoComplete="current-password"
                    />
                )}

                {isOnline && (
                    <Input
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        label="表示名"
                        disabled={joining !== null}
                        autoComplete="name"
                    />
                )}

                {error && isActive && (
                    <p className="w-full text-sm text-red-500" role="alert">
                        {error}
                    </p>
                )}

                <Button
                    onClick={() => handleContinue(mode)}
                    className="w-full"
                    variant="primary"
                    disabled={
                        joining !== null ||
                        (showPasswordField &&
                            !alreadyAuthorized &&
                            !roomPassword) ||
                        (isOnline && !displayName.trim())
                    }
                    loading={joining === mode}
                    iconName="arrowRight"
                >
                    続ける
                </Button>
            </MorphDialog>
        );
    };

    return (
        <div className="flex w-full flex-col gap-4">
            {!roomLoading && (
                <>
                    {itemCount === 0 && (
                        <p className="w-full text-start text-sm opacity-70">
                            このルームには単語がありません。
                        </p>
                    )}

                    <div className="grid w-full grid-cols-2 gap-4">
                        {renderModeDialog("online")}
                        {renderModeDialog("offline")}
                    </div>
                </>
            )}

            {isOwner && (
                <Button
                    onClick={() => { startNavigationProgress(); router.push("/" + slug + "/edit"); }}
                    className="w-full"
                    iconName="pen"
                >
                    ルームを編集
                </Button>
            )}

            {error && !activeDialog && !turnstile && (
                <p className="w-full text-sm text-red-500" role="alert">
                    {error}
                </p>
            )}

            <PopUp show={turnstile}>
                <TurnstileChallenge
                    onSuccess={(token) => {
                        setTurnstile(false);
                        const mode = turnstileMode;
                        setTurnstileMode(null);
                        if (mode) void handleSignIn(token, mode);
                    }}
                    onFail={(reason) => {
                        setTurnstile(false);
                        setTurnstileMode(null);
                        setError(reason);
                    }}
                    onCancel={() => {
                        setTurnstile(false);
                        setTurnstileMode(null);
                    }}
                />
            </PopUp>
        </div>
    );
}
