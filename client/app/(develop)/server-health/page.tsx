"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import Shell from "@/components/layout/Shell";
import { Icon } from "@/components/ui/Icon";

function ServerStatus({
    name,
    health,
}: {
    name: string;
    health: boolean | undefined;
}) {
    return (
        <div
            data-cursor="text"
            className="font-bold flex gap-2 justify-between w-full"
        >
            {name}
            <div
                className={`font-mono flex gap-1 ${health === true ? "text-green-500" : health === false ? "text-red-500" : "text-gray-500"}`}
            >
                <Icon
                    name={health ? "check" : health === false ? "x" : "info"}
                />
                {health
                    ? "Healthy"
                    : health === false
                      ? "Unhealthy"
                      : "No Data"}
            </div>
        </div>
    );
}

export default function ServerHealth() {
    const [primaryHealth, setPrimaryHealth] = useState<boolean | undefined>(
        undefined,
    );
    const [backupHealth, setBackupHealth] = useState<boolean | undefined>(
        undefined,
    );

    const primaryUrl = process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL;
    const backupUrl = process.env.NEXT_PUBLIC_BACKUP_SERVER_URL;

    useEffect(() => {
        if (!primaryUrl) return;

        const socket = io(primaryUrl, {
            reconnection: false,
            timeout: 5_000,
        });

        const handleConnect = () => setPrimaryHealth(true);
        const handleError = () => setPrimaryHealth(false);

        socket.on("connect", handleConnect);
        socket.on("connect_error", handleError);

        return () => {
            socket.off("connect", handleConnect);
            socket.off("connect_error", handleError);
            socket.disconnect();
        };
    }, []);

    useEffect(() => {
        if (!backupUrl) return;

        const socket = io(backupUrl, {
            reconnection: false,
            timeout: 30_000,
        });

        const handleConnect = () => setBackupHealth(true);
        const handleError = () => setBackupHealth(false);

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
            title="Server Health"
            loading={primaryHealth === undefined}
            size="small"
        >
            <ServerStatus name="Primary" health={primaryHealth} />
            <ServerStatus name="Backup" health={backupHealth} />
        </Shell>
    );
}
