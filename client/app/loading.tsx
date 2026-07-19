"use client";

import { useEffect, useState } from "react";

export default function Loading() {
    const [showCursor, setShowCursor] = useState(true);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);
    }, []);

    return (
        <main className="flex flex-col h-full items-center pt-16">
            <div className="flex items-end">
                <h1 className="font-mono font-bold text-2xl" data-cursor="text">
                    Loading…
                </h1>
                <div
                    className={`w-3 h-1 mb-1 ml-1 bg-cyan-600 ${!showCursor && "opacity-0"}`}
                />
            </div>
        </main>
    );
}
