"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import Shell from "@/components/layout/Shell";

export default function ServerHealth() {
    const [healthy, setHealthy] = useState<boolean | undefined>(undefined);

    useEffect(() => {
        const primaryUrl = process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL;

        if (!primaryUrl) {
            setHealthy(false);
            return;
        }

        const socket = io(primaryUrl, {
            reconnection: false,
            timeout: 5_000,
        });

        const handleConnect = () => setHealthy(true);
        const handleError = () => setHealthy(false);

        socket.on("connect", handleConnect);
        socket.on("connect_error", handleError);

        return () => {
            socket.off("connect", handleConnect);
            socket.off("connect_error", handleError);
            socket.disconnect();
        };
    }, []);

    return (
        <Shell
            title={healthy === undefined ? undefined : healthy ? "Healthy" : "Downed"}
            loading={healthy === undefined}
        />
    );
}
