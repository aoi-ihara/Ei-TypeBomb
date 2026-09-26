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

export default function Page({
    params,
}: {
    params: Promise<{ slug: string }>;
}) {
    const { slug } = use(params);
    const [roomId, setRoomId] = useState("");
    const [error, setError] = useState("");
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [loading, setLoading] = useState(true);
    const [roomPassword, setRoomPassword] = useState("");
    const [turnstile, setTurnstile] = useState(false);
    const [isNotFound, setIsNotFound] = useState(false);

    const router = useRouter();

    const handleSignIn = async (turnstileToken: string) => {
        setLoading(true);
        const result = await signInToRoom(
            {
                id: roomId,
                password: roomPassword,
            },
            turnstileToken,
        );

        if (result === null) {
            posthog.capture("room_entered", { room_id: roomId });
            router.push("/display-name");
        } else {
            posthog.capture("room_entry_failed", {
                room_id: roomId,
                reason: result,
            });
            setError(result);
        }
        setLoading(false);
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
            setLoading(false);

            if (result === null) {
                setIsNotFound(true);
                return;
            }

            if (result === false) {
                const result = await signInToRoom({
                    id: roomIdResult,
                    password: roomPassword,
                });

                if (result === null) {
                    posthog.capture("room_entered", { room_id: roomIdResult });
                    router.replace("/display-name");
                } else {
                    posthog.capture("room_entry_failed", {
                        room_id: roomIdResult,
                        reason: result,
                    });
                    setError(result);
                }
            } else {
                setShowPasswordField(true);
                setError("");
            }
        };

        fetchData();
    }, []);

    if (isNotFound) notFound();

    return (
        <Shell
            title={showPasswordField ? "パスワードを入力" : undefined}
            loading={!showPasswordField}
        >
            {showPasswordField && (
                <Input
                    value={roomPassword}
                    type="password"
                    onChange={(e) => setRoomPassword(e.target.value)}
                    label="ルームのパスワード"
                />
            )}

            <Button
                onClick={() => {
                    setError("");
                    setTurnstile(true);
                }}
                className="w-full"
                variant="primary"
                disabled={!roomId || (showPasswordField && !roomPassword)}
                loading={loading}
            >
                続ける
            </Button>
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
