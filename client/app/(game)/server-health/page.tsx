"use client";

import { useCallback, useEffect, useState } from "react";
import { io } from "socket.io-client";
import Shell from "@/components/layout/Shell";
import { Icon } from "@/components/ui/Icon";
import Button from "@/components/ui/Button";

function ServerStatus({
    name,
    health,
    latency,
}: {
    name: string;
    health: boolean | undefined;
    latency: number | null;
}) {
    return (
        <div
            data-cursor="text"
            className="font-bold animate-appear flex gap-2 justify-between w-full"
        >
            {name}

            <div
                className={`font-mono flex items-center gap-1 justify-between ${
                    health === true
                        ? "text-green-500"
                        : health === false
                          ? "text-red-500"
                          : "text-gray-500"
                }`}
            >
                <Icon
                    name={
                        health === true
                            ? "check"
                            : health === false
                              ? "x"
                              : "info"
                    }
                />

                {health === true
                    ? latency !== null
                        ? `${latency}ms`
                        : "Healthy"
                    : health === false
                      ? "Unhealthy"
                      : "No Data"}
            </div>
        </div>
    );
}

function useServerHealth(url: string | undefined, timeout: number) {
    const [health, setHealth] = useState<boolean | undefined>(undefined);
    const [latency, setLatency] = useState<number | null>(null);

    const checkServer = useCallback(() => {
        if (!url) {
            setHealth(false);
            setLatency(null);
            return;
        }

        setHealth(undefined);
        setLatency(null);

        const start = performance.now();

        const socket = io(url, {
            reconnection: false,
            timeout,
            autoConnect: true,
        });

        const handleConnect = () => {
            const elapsed = Math.round(performance.now() - start);

            setHealth(true);
            setLatency(elapsed);

            socket.disconnect();
        };

        const handleConnectError = () => {
            setHealth(false);
            setLatency(null);

            socket.disconnect();
        };

        socket.once("connect", handleConnect);
        socket.once("connect_error", handleConnectError);
    }, [url, timeout]);

    useEffect(() => {
        const initialCheck = window.setTimeout(() => {
            checkServer();
        }, 0);

        const interval = window.setInterval(() => {
            checkServer();
        }, 60_000);

        return () => {
            window.clearTimeout(initialCheck);
            window.clearInterval(interval);
        };
    }, [checkServer]);

    return {
        health,
        latency,
        checkServer,
    };
}

export default function ServerHealth() {
    const primaryUrl = process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL;
    const backupUrl = process.env.NEXT_PUBLIC_BACKUP_SERVER_URL;

    const primary = useServerHealth(primaryUrl, 5_000);
    const backup = useServerHealth(backupUrl, 30_000);

    const handleRefresh = useCallback(() => {
        primary.checkServer();
        backup.checkServer();
    }, [primary.checkServer, backup.checkServer]);

    return (
        <Shell title="Server Health" size="small">
            <ServerStatus
                name="Primary"
                health={primary.health}
                latency={primary.latency}
            />

            <ServerStatus
                name="Backup"
                health={backup.health}
                latency={backup.latency}
            />

            <Button
                iconName="rotateCw"
                onClick={handleRefresh}
                className="w-full"
            >
                Refresh
            </Button>
        </Shell>
    );
}
