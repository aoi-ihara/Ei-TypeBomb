"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import { PopUp } from "@/components/ui/PopUp";
import { TurnstileChallenge } from "@/components/ui/TurnstileChallenge";
import { signInToRoom } from "@/lib/room/auth";

export default function RoomPasswordGate({ roomId }: { roomId: string }) {
    const router = useRouter();
    const [password, setPassword] = useState("");
    const [turnstile, setTurnstile] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const handleContinue = () => {
        if (!password) return;
        setError("");
        setTurnstile(true);
    };

    const handleVerify = async (turnstileToken: string) => {
        setTurnstile(false);
        setLoading(true);
        setError("");

        try {
            const result = await signInToRoom(
                { id: roomId, password },
                turnstileToken,
            );

            if (result) {
                setError(result);
                setLoading(false);
                return;
            }

            router.refresh();
        } catch (reason) {
            console.error("Failed to authorize room:", reason);
            setError("ルームの認証に失敗しました。もう一度お試しください。");
            setLoading(false);
        }
    };

    return (
        <>
            <Input
                value={password}
                type="password"
                onChange={(event) => setPassword(event.target.value)}
                label="ルームのパスワード"
                disabled={loading}
                autoComplete="current-password"
            />

            {error && (
                <p className="w-full text-sm text-red-500" role="alert">
                    {error}
                </p>
            )}

            <Button
                onClick={handleContinue}
                className="w-full"
                variant="primary"
                disabled={!password || loading}
                loading={loading}
                iconName="arrowRight"
            >
                続ける
            </Button>

            <PopUp show={turnstile}>
                <TurnstileChallenge
                    onSuccess={handleVerify}
                    onFail={(reason) => {
                        setTurnstile(false);
                        setError(reason);
                    }}
                    onCancel={() => setTurnstile(false)}
                />
            </PopUp>
        </>
    );
}
