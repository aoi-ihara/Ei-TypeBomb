"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import Button from "@/components/ui/Button";

const AUTO_RESTART_DELAY_MS = 7_000;

type Props = Omit<ComponentProps<typeof Button>, "children" | "href">;

/** Keep the game-specific replay timer out of the reusable Button. */
export default function PlayAgainButton({
    onClick,
    disabled = false,
    loading = false,
    ...props
}: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (disabled || loading) return;

        const timeout = setTimeout(() => {
            timeoutRef.current = null;
            containerRef.current?.querySelector("button")?.click();
        }, AUTO_RESTART_DELAY_MS);
        timeoutRef.current = timeout;

        return () => {
            clearTimeout(timeout);
            if (timeoutRef.current === timeout) timeoutRef.current = null;
        };
    }, [disabled, loading]);

    return (
        <div ref={containerRef} className="w-full">
            <Button
                {...props}
                disabled={disabled}
                loading={loading}
                onClick={(event) => {
                    if (timeoutRef.current) {
                        clearTimeout(timeoutRef.current);
                        timeoutRef.current = null;
                    }
                    onClick?.(event);
                }}
            >
                もう一度プレイ
            </Button>
        </div>
    );
}
