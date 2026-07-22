"use client";

import { useEffect, useState } from "react";
import Input from "@/components/ui/Input";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { getRoomStatusFromId } from "@/lib/room/get";

export default function Loading() {
    const [showCursor, setShowCursor] = useState(true);
    const [roomId, setRoomId] = useState("");
    const [error, setError] = useState("");
    const [showPasswordField, setShowPasswordField] = useState(false);
    const [loading, setLoading] = useState(false);
    const [roomPassword, setRoomPassword] = useState("");

    const router = useRouter();

    const handleContinue = async () => {
        setLoading(true);
        const result = await getRoomStatusFromId(roomId);
        setLoading(false);

        if (result == null) {
            setError("Room not found.");
            return;
        }

        if (result == false) {
            setError("this room is public");
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
                onClick={() => {
                    if (roomId) handleContinue();
                }}
                padding="large"
                className="w-full"
                variant="primary"
                disabled={!roomId}
                loading={loading}
            >
                Continue
            </Button>
            {error && (
                <a className="text-red-500" data-cursor="text">
                    {error}
                </a>
            )}
        </div>
    );
}
