"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Keys } from "@/components/ui/Keys";

export default function Home() {
    const [isSelected, setIsSelected] = useState(false); // Whether the play button is selected
    const [showCursor, setShowCursor] = useState(false);

    const router = useRouter();

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "p") {
                router.push("/display-name");
            }

            if (e.key === "s") {
                router.push("/settings");
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            clearInterval(intervalId);
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [router]);

    return (
        <div className="flex flex-col justify-center h-full items-center gap-16">
            <div className="flex items-end">
                <h1 className="font-mono font-bold text-2xl" data-cursor="text">
                    Ei Typing
                </h1>
                <div
                    className={`w-3 h-1 mb-1 ml-1 bg-cyan-600 ${!showCursor && "opacity-0"}`}
                />
            </div>

            <button
                data-cursor="button"
                className="text-lg items-center font-bold bg-cyan-600 w-32 justify-center py-2 rounded-md text-white flex transition-all duration-200 ease-out active:scale-95"
                data-cursor-shape="0"
                onMouseEnter={() => {
                    setIsSelected(true);
                }}
                onMouseLeave={() => {
                    setIsSelected(false);
                }}
                onClick={() => router.push("/display-name")}
            >
                <div
                    className={`${isSelected ? "w-5" : "w-0 opacity-0"} transition-all duration-200 ease-out flex overflow-hidden`}
                >
                    ▶
                </div>
                <div className="mr-1">Play</div>
                <Keys keys={["P"]} />
            </button>

            <button
                data-cursor="button"
                className="px-2 flex items-center py-1 text-cyan-600 rounded-md font-bold transition-transform duration-200 ease-out active:scale-95 z-1000"
                data-cursor-shape="1"
                onClick={() => router.push("/settings")}
            >
                Settings
                <Keys keys={["S"]}></Keys>
            </button>
        </div>
    );
}
