"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
    const [isSelected, setIsSelected] = useState(false); // Whether the play button is selected
    const [showCursor, setShowCursor] = useState(false);

    const router = useRouter();

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => clearInterval(intervalId);
    }, []);

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
                className="text-lg font-bold bg-cyan-600 w-32 justify-center py-2 rounded-md text-white flex transition-all duration-200 ease-out active:scale-95"
                data-cursor-shape="0"
                onMouseEnter={() => {
                    setIsSelected(true);
                }}
                onMouseLeave={() => {
                    setIsSelected(false);
                }}
            >
                <div
                    className={`${isSelected ? "w-5" : "w-0 opacity-0"} transition-all duration-200 ease-out flex overflow-hidden`}
                >
                    ▶
                </div>
                <div>Play</div>
            </button>

            <button
                data-cursor="button"
                className="px-2 py-1 rounded-md text-(--color-foreground) transition-transform duration-200 ease-out active:scale-95 inline-block z-1000 underline active:no-underline"
                data-cursor-shape="2"
                onClick={() => router.push("/settings")}
            >
                Settings
            </button>
        </div>
    );
}
