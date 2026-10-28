"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";

// Matches the server's 20-second reconnect grace for a match seat.
const RECONNECT_WAIT_SECONDS = 20;

type Props = {
    reconnecting: boolean;
    failed: boolean;
    onReload: () => void;
};

export default function ReconnectStatus({
    reconnecting,
    failed,
    onReload,
}: Readonly<Props>) {
    const [elapsedSeconds, setElapsedSeconds] = useState(0);

    useEffect(() => {
        const startedAt = performance.now();
        const interval = setInterval(() => {
            setElapsedSeconds(
                Math.floor((performance.now() - startedAt) / 1000),
            );
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const secondsLeft = Math.max(0, RECONNECT_WAIT_SECONDS - elapsedSeconds);

    if (failed || secondsLeft === 0)
        return (
            <div
                className="flex shrink-0 items-center justify-between gap-2 rounded-2xl bg-(--color-background-secondary) p-2 w-full animate-appear"
                role="alert"
            >
                <div className="w-fit pl-4 font-bold" data-cursor="text">
                    接続できませんでした
                </div>
                <Button
                    iconName="rotateCcw"
                    variant="primary"
                    onClick={onReload}
                >
                    再読み込み
                </Button>
            </div>
        );

    if (!reconnecting) return null;

    return (
        <div className="flex shrink-0 w-full animate-appear" role="status">
            <div
                className="w-fit pl-4 font-bold gradient-text"
                data-cursor="text"
            >
                再接続中… あと{secondsLeft}秒
            </div>
        </div>
    );
}
