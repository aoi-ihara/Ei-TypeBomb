"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function NotFoundClient() {
    const router = useRouter();
    const [showCursor, setShowCursor] = useState(true);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setShowCursor((prev) => !prev);
        }, 500);

        return () => {
            clearInterval(intervalId);
        };
    }, []);

    return (
        <main className="flex flex-col h-full items-center pt-16">
            <h1
                className="font-mono mb-8 font-bold text-2xl"
                data-cursor="text"
            >
                404
            </h1>
            <div className="flex items-end">
                <h2
                    className="font-mono font-bold mt-4 text-lg"
                    data-cursor="text"
                >
                    Not Found
                </h2>
                <div
                    className={`w-3 h-1 mb-1 ml-1 bg-cyan-600 ${!showCursor && "opacity-0"}`}
                />
            </div>
            <button
                data-cursor="button"
                onClick={() => router.push("/")}
                data-cursor-shape="0"
                className="mt-16 rounded-xl"
            >
                <div className="w-48 font-bold rounded-xl transition-all duration-200 ease-out active:scale-95 py-3 bg-cyan-600 text-white">
                    Go Home
                </div>
            </button>
        </main>
    );
}
