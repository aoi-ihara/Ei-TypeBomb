"use client";

import { useEffect, useState } from "react";
import Input from "@/components/ui/Input";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { getRoomStatusFromId, getPasswordAccuracy } from "@/lib/room/get";
import { Turnstile } from "@marsidev/react-turnstile";
import { PopUp } from "@/components/ui/PopUp";

export default function Loading() {
    const [showCursor, setShowCursor] = useState(true);
    const [roomId, setRoomId] = useState("");
    const [error, setError] = useState("");
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [loading, setLoading] = useState(false);
    const [roomPassword, setRoomPassword] = useState("");
    const [turnstile, setTurnstile] = useState(false);

    const router = useRouter();

    const handleSignIn = async (turnstileToken: string) => {
        const result = await getPasswordAccuracy(
            {
                id: roomId,
                password: roomPassword,
            },
            turnstileToken,
        );

        if (result) {
            console.log("Success!!");
        } else {
            setError("Incorrect password.");
        }
    };

    const handleContinue = async () => {
        if (showPasswordField) {
            setTurnstile(true);
            return;
        }

        setLoading(true);
        const result = await getRoomStatusFromId(roomId);
        setLoading(false);

        if (result == null) {
            setError("Room not found.");
            return;
        }

        if (result == false) {
            localStorage.setItem("room-visibility", "public");
            router.push("/display-name");
            return;
        }

        setShowPasswordField(true);
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
        <div className="flex flex-col w-full max-w-md gap-4 items-center pt-16">
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
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                label="Room ID"
            />

            {showPasswordField && (
                <Input
                    value={roomPassword}
                    onChange={(e) => setRoomPassword(e.target.value)}
                    label="Room Password"
                />
            )}

            <Button
                onClick={() => handleContinue()}
                padding="large"
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
        </div>
    );
}
