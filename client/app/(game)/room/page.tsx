"use client";

import { useEffect, useState } from "react";
import { RetchedInput } from "@/components/ui/RetchedInput";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { getRoomStatusFromId } from "@/lib/room/get";

export default function Loading() {
    const [showCursor, setShowCursor] = useState(true);
    const [roomId, setRoomId] = useState("");

    const router = useRouter();

    const handleContinue = async () => {
        const result = await getRoomStatusFromId(roomId);
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
            <div data-cursor="text" className="w-full rounded-2xl">
                <RetchedInput
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value)}
                    placeholder="Room ID"
                />
            </div>

            <Button
                onClick={() => {
                    if (roomId) handleContinue();
                }}
                padding="large"
                className="w-full"
                variant="primary"
                disabled={!roomId}
            >
                Continue
            </Button>
        </div>
    );
}
