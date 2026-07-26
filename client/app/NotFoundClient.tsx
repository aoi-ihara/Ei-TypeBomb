"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import Shell from "@/components/layout/Shell";

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
        <Shell title="404" size="small">
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

            <div data-cursor="text">
                We could not find the page you are looking for.
            </div>

            <Button
                className="w-full"
                variant="primary"
                onClick={() => router.push("/")}
            >
                Go Home
            </Button>
        </Shell>
    );
}
