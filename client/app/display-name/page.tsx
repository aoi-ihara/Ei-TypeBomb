"use client";

import { useEffect, useState } from "react";
import { RetchedInput } from "@/components/ui/RetchedInput";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";

export default function Loading() {
    const [showCursor, setShowCursor] = useState(true);
    const [displayName, setDisplayName] = useState("");

    const router = useRouter();

    const handleContinue = () => {
        localStorage.setItem("display-name", displayName);
        router.push("/game");
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
                    Choose a Display Name
                </h1>
                <div
                    className={`w-3 h-1 mb-1 ml-1 bg-cyan-600 ${!showCursor && "opacity-0"}`}
                />
            </div>
            <div data-cursor="text" className="w-full rounded-2xl">
                <RetchedInput
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Display Name"
                />
            </div>

            <Button
                onClick={() => {
                    if (displayName) handleContinue();
                }}
                padding="large"
                className="w-full"
                variant="primary"
                disabled={!displayName}
            >
                Continue
            </Button>
        </div>
    );
}
