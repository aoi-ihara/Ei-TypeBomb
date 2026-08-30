"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

const FAILOVER_MESSAGE = "Primary server unavailable. Switching to Render.";
const FAILOVER_TIMEOUT_MS = 5_000;

export default function ServerFailoverTracker() {
    useEffect(() => {
        const originalWarn = console.warn;

        console.warn = (...args: unknown[]) => {
            originalWarn(...args);

            if (args[0] === FAILOVER_MESSAGE) {
                posthog.capture("server_failover", {
                    from_server: "primary",
                    to_server: "backup",
                    failover_timeout_ms: FAILOVER_TIMEOUT_MS,
                });
            }
        };

        return () => {
            console.warn = originalWarn;
        };
    }, []);

    return null;
}
