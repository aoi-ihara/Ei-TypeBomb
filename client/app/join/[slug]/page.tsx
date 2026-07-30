"use client";

import { useEffect, useState, use } from "react";
import Input from "@/components/ui/Input";
import { notFound, useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { getRoomFromLink, getRoomStatusFromId } from "@/lib/room/get";
import { signInToRoom } from "@/lib/room/auth";
import { Turnstile } from "@marsidev/react-turnstile";
import { PopUp } from "@/components/ui/PopUp";
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
            setError(result);
        }
        setLoading(false);
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
                    posthog.capture("room_entered", { room_id: roomId });
                    router.push("/display-name");
                } else {
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
        <Shell title="Enter Password" loading={!showPasswordField}>
            {showPasswordField && (
                <Input
                    value={roomPassword}
                    type="password"
                    onChange={(e) => setRoomPassword(e.target.value)}
                    label="Room Password"
                />
            )}

            <Button
                onClick={() => setTurnstile(true)}
                className="w-full"
                variant="primary"
                disabled={!roomId || (showPasswordField && !roomPassword)}
                loading={loading}
            >
                Continue
            </Button>
            {error && (
                <a className="text-red-500" data-cursor="text">
                    {error}
                </a>
            )}

            <PopUp show={turnstile}>
                <Turnstile
                    siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY!}
                    onSuccess={(turnstileToken: string) => {
                        setTurnstile(false);
                        handleSignIn(turnstileToken);
                    }}
                />
            </PopUp>
        </Shell>
    );
}
