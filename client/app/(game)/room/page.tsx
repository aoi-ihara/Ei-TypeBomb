"use client";

import { useEffect, useState } from "react";
import Input from "@/components/ui/Input";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { getRoomFromLink, getRoomStatusFromId } from "@/lib/room/get";
import { signInToRoom } from "@/lib/room/auth";
import { Turnstile } from "@marsidev/react-turnstile";
import { PopUp } from "@/components/ui/PopUp";
import posthog from "posthog-js";

export default function Loading() {
    const [showCursor, setShowCursor] = useState(true);
    const [link, setLink] = useState("");
    const [error, setError] = useState("");
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [loading, setLoading] = useState(false);
    const [roomPassword, setRoomPassword] = useState("");
    const [turnstile, setTurnstile] = useState(false);
    const [roomId, setRoomId] = useState("");

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

    const handleContinue = async () => {
        if (showPasswordField) {
            setTurnstile(true);
            return;
        }

        setLoading(true);
        const roomIdResult = await getRoomFromLink(
            link.replace(process.env.NEXT_PUBLIC_JOIN_LINK!, ""),
        );
        if (!roomIdResult) {
            setError("Room not found.");
            setLoading(false);
            return;
        }

        const normalizedRoomId = roomIdResult.toLowerCase();
        setRoomId(normalizedRoomId);

        const result = await getRoomStatusFromId(normalizedRoomId);
        setLoading(false);

        if (result === null) {
            setError("Room not found.");
            setLoading(false);
            return;
        }

        if (result === false) {
            const result = await signInToRoom({
                id: normalizedRoomId,
                password: roomPassword,
            });

            if (result === null) {
                posthog.capture("room_entered", { room_id: normalizedRoomId });
                router.push("/display-name");
                setLoading(false);
            } else {
                setError(result);
                setLoading(false);
                return;
            }
        } else {
            setShowPasswordField(true);
            setError("");
        }
    };

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    });

    return (
        <div className="flex flex-col w-full max-w-md px-4 gap-4 items-center pt-16">
            <div className="flex items-end mb-4">
                <h1 className="font-mono font-bold text-2xl" data-cursor="text">
                    Choose a Room
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
                label="Invite Link"
            />

            {showPasswordField && (
                <div className="animate-appear w-full">
                    <Input
                        value={roomPassword}
                        type="password"
                        onChange={(e) => setRoomPassword(e.target.value)}
                        label="Room Password"
                    />
                </div>
            )}

            <Button
                onClick={() => handleContinue()}
                className="w-full"
                variant="primary"
                disabled={!link || (showPasswordField && !roomPassword)}
                loading={loading}
                iconName="arrowRight"
            >
                Continue
            </Button>

            {!link && (
                <Button
                    onClick={() => router.push("/game-demo")}
                    className={`w-full`}
                    iconName="play"
                >
                    Play Demo
                </Button>
            )}

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
        </div>
    );
}
