"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startNavigationProgress } from "@/lib/navigation-progress";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import MorphDialog from "@/components/ui/MorphDialog";
import Selection from "@/components/ui/Selection";
import {
    getAnswerModeOptions,
    isAnswerMode,
    type AnswerMode,
} from "@/lib/answer-mode";
import { PopUp } from "@/components/ui/PopUp";
import { TurnstileChallenge } from "@/components/ui/TurnstileChallenge";
import { getRoomStatusFromId } from "@/lib/room/get";
import { signInToRoom } from "@/lib/room/auth";
import { recordRoomPlay } from "@/lib/room/analytics";
import posthog from "posthog-js";

type PlayMode = "online" | "offline";
const validDisplayName = (name: string) =>
    name.trim().length > 0 &&
    name.trim().length <= 50 &&
    !/[\p{Cc}\p{Cf}]/u.test(name);

export default function PlayRoom({
    roomId,
    alreadyAuthorized,
    itemCount,
    hasTypingAnswers,
    isOwner,
    link,
}: {
    roomId: string;
    alreadyAuthorized: boolean;
    itemCount: number;
    hasTypingAnswers: boolean;
    isOwner: boolean;
    link: string;
}) {
    const router = useRouter();
    const [roomLoading, setRoomLoading] = useState(!alreadyAuthorized);
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [roomPassword, setRoomPassword] = useState("");
    const [displayName, setDisplayName] = useState(() => {
        try {
            return (localStorage.getItem("display-name") ?? "").slice(0, 50);
        } catch {
            return "";
        }
    });
    const [answerMode, setAnswerMode] = useState<AnswerMode>(() => {
        try {
            const saved = localStorage.getItem("answer-mode");
            return isAnswerMode(saved) ? saved : "auto";
        } catch {
            return "auto";
        }
    });
    const availableAnswerModes = getAnswerModeOptions(hasTypingAnswers);
    const effectiveAnswerMode = hasTypingAnswers ? answerMode : "selection";
    const answerModeSelection = Math.max(
        0,
        availableAnswerModes.findIndex(
            (option) => option.value === effectiveAnswerMode,
        ),
    );
    const [activeDialog, setActiveDialog] = useState<PlayMode | null>(null);
    const [joining, setJoining] = useState<PlayMode | null>(null);
    const [turnstile, setTurnstile] = useState(false);
    const [turnstileMode, setTurnstileMode] = useState<PlayMode | null>(null);
    const [turnstileAnswerMode, setTurnstileAnswerMode] =
        useState<AnswerMode>("auto");
    const [error, setError] = useState("");

    useEffect(() => {
        let active = true;

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

    const navigateToMode = async (
        mode: PlayMode,
        selectedAnswerMode: AnswerMode,
    ) => {
        await recordRoomPlay(roomId, mode);
        posthog.capture("room_entered", {
            room_id: roomId,
            play_mode: mode,
        });
        startNavigationProgress();
        router.push(
            "/" + link + "/" + mode + "?answerMode=" + selectedAnswerMode,
        );
    };

    const handleSignIn = async (
        turnstileToken: string | undefined,
        mode: PlayMode,
        selectedAnswerMode: AnswerMode,
    ) => {
        if (itemCount === 0) {
            setError(
                "このルームには単語がありません。ルームの所有者が単語を追加するまでプレイできません。",
            );
            return;
        }

        setJoining(mode);
        setError("");

        try {
            const result = await signInToRoom(
                {
                    id: roomId,
                    password: showPasswordField ? roomPassword : "",
                },
                turnstileToken,
            );

            if (result === null) {
                await navigateToMode(mode, selectedAnswerMode);
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

        setError("");
        const selectedAnswerMode = effectiveAnswerMode;
        try {
            localStorage.setItem("answer-mode", selectedAnswerMode);
        } catch {
            // The selected mode still applies to this session.
        }
        if (mode === "online") {
            if (!validDisplayName(displayName)) {
                setError("表示名を入力してください（50文字以内）。");
                return;
            }
            try {
                localStorage.setItem("display-name", displayName.trim());
            } catch {}
        }
        if (showPasswordField && !alreadyAuthorized) {
            setTurnstileMode(mode);
            setTurnstileAnswerMode(selectedAnswerMode);
            setTurnstile(true);
            return;
        }
        void handleSignIn(undefined, mode, selectedAnswerMode);
    };

    const renderModeDialog = (mode: PlayMode) => {
        const isOnline = mode === "online";
        const title = isOnline ? "表示名と出題形式" : "出題形式";
        const isActive = activeDialog === mode;

        return (
            <MorphDialog
                key={mode}
                button={
                    <Button
                        onClick={() => {
                            setError("");
                            setActiveDialog(mode);
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
                    showPasswordField && !alreadyAuthorized
                        ? "ルームのパスワードを入力してください。"
                        : isOnline
                          ? "表示名と出題形式を選択してください。"
                          : "出題形式を選択してください。"
                }
                alignment="vertical"
                size="middle"
                open={isActive}
                onClose={() => setActiveDialog(null)}
            >
                {isOnline && (
                    <Input
                        value={displayName}
                        onChange={(event) =>
                            setDisplayName(event.target.value.slice(0, 50))
                        }
                        label="表示名"
                        autoComplete="nickname"
                        disabled={joining !== null}
                    />
                )}
                <div className="w-full flex flex-col gap-2">
                    <div className="text-sm font-bold" data-cursor="text">
                        出題形式
                    </div>
                    <Selection
                        items={availableAnswerModes.map((option) => option.label)}
                        selection={answerModeSelection}
                        onSelected={(index) =>
                            setAnswerMode(availableAnswerModes[index].value)
                        }
                    />
                </div>
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
                        (isOnline && !validDisplayName(displayName)) ||
                        (showPasswordField &&
                            !alreadyAuthorized &&
                            !roomPassword)
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
                <div className="grid w-full grid-cols-2 gap-4">
                    {renderModeDialog("online")}
                    {renderModeDialog("offline")}
                </div>
            )}

            {isOwner && (
                <Button
                    onClick={() => {
                        startNavigationProgress();
                        router.push("/" + link + "/edit");
                    }}
                    className="w-full"
                    iconName="pen"
                >
                    編集
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
                        if (mode)
                            void handleSignIn(token, mode, turnstileAnswerMode);
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
