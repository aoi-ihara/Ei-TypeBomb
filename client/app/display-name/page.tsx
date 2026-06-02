"use client";

import { useEffect, useState } from "react";
import { RetchedInput } from "@/components/ui/RetchedInput";
import { useRouter } from "next/navigation";

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
        <div className="flex flex-col w-fit h-full gap-8 items-center pt-16">
            <div className="flex items-end">
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

            <div
                className="rounded-lg w-48 flex"
                data-cursor="button"
                data-cursor-shape={!!displayName ? "0" : "2"}
            >
                <button
                    className={`text-lg ${!displayName ? "opacity-50" : "active:scale-95"} items-center font-bold bg-cyan-600 w-full justify-center py-2 rounded-lg text-white flex transition-all duration-200 ease-out`}
                    onClick={() => {
                        if (displayName) handleContinue();
                    }}
                >
                    <div className="mr-1">Continue</div>
                </button>
            </div>
        </div>
    );
}
