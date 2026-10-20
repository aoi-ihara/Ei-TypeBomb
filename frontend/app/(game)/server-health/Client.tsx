"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { probeServerHealth } from "@/lib/room/healthProbe";
import {
    captureServerHealthCheck,
    type HealthCheckTrigger,
    type ServerRole,
} from "@/lib/analytics/serverHealth";
import Shell from "@/components/layout/Shell";
import { Icon } from "@/components/ui/Icon";
import Button from "@/components/ui/Button";
import {
    getStoredServerConfig,
    parseStoredServerConfig,
    SERVER_CONFIG_CHANGE_EVENT,
} from "@/lib/room/serverUrl";

const subscribeConfig = (listener: () => void) => {
    window.addEventListener("storage", listener);
    window.addEventListener(SERVER_CONFIG_CHANGE_EVENT, listener);
    return () => {
        window.removeEventListener("storage", listener);
        window.removeEventListener(SERVER_CONFIG_CHANGE_EVENT, listener);
    };
};
const getServerSnapshot = () => "";

type HealthRowState = { health: boolean | undefined; refreshing: boolean };

function ServerStatus({
    name,
    health,
    rttLatency,
}: {
    name: string;
    health: boolean | undefined;
    rttLatency: number | null;
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
                <Icon name={health === true ? "check" : health === false ? "x" : "info"} />
                {health === true
                    ? rttLatency !== null
                        ? `${rttLatency}ms`
                        : "正常"
                    : health === false
                      ? "エラー"
                      : "接続中…"}
            </div>
        </div>
    );
}

function HealthRow({
    url, name, serverRole, refreshSignal, onStatus,
}: {
    url: string;
    name: string;
    serverRole: ServerRole;
    refreshSignal: number;
    onStatus: (url: string, state: HealthRowState) => void;
}) {
    const [health, setHealth] = useState<boolean | undefined>(undefined);
    const [rttLatency, setRttLatency] = useState<number | null>(null);

    useEffect(() => {
        // Aborting the previous run prevents an older, slower response from
        // overwriting the newest result after a manual refresh or URL change.
        const controller = new AbortController();
        let active = true;
        onStatus(url, { health: undefined, refreshing: true });
        // Preserve the last answer during refresh, rather than showing an
        // error or hiding the entire page while the next probe is pending.
        const trigger: HealthCheckTrigger = refreshSignal === 0 ? "initial" : "manual";
        void probeServerHealth(url, controller.signal).then((result) => {
            if (!active) return;
            setHealth(result.healthy);
            setRttLatency(result.latencyMs);
            onStatus(url, { health: result.healthy, refreshing: false });
            captureServerHealthCheck({
                serverRole,
                checkType: "rtt",
                healthy: result.healthy,
                latencyMs: result.latencyMs,
                connectionLatencyMs: null,
                trigger,
            });
        });
        return () => {
            active = false;
            controller.abort();
        };
    }, [url, serverRole, refreshSignal, onStatus]);

    return <ServerStatus name={name} health={health} rttLatency={rttLatency} />;
}

const HEALTH_REFRESH_INTERVAL_MS = 60_000;

export default function ServerHealth({ clusterServers }: { clusterServers: string[] }) {
    const storedConfig = useSyncExternalStore(
        subscribeConfig,
        getStoredServerConfig,
        getServerSnapshot,
    );
    const servers = parseStoredServerConfig(storedConfig) ??
        (clusterServers.length > 0 ? clusterServers : [
            process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL,
            process.env.NEXT_PUBLIC_SECONDARY_SERVER_URL,
            process.env.NEXT_PUBLIC_FALLBACK_SERVER_URL,
        ].filter((url): url is string => Boolean(url)));

    const [refreshSignal, setRefreshSignal] = useState(0);
    const [states, setStates] = useState<Record<string, HealthRowState>>({});
    const onStatus = useCallback((url: string, next: HealthRowState) => {
        setStates((previous) => {
            const current = previous[url];
            if (current?.health === next.health &&
                current?.refreshing === next.refreshing) return previous;
            return { ...previous, [url]: next };
        });
    }, []);

    useEffect(() => {
        const interval = window.setInterval(
            () => setRefreshSignal((previous) => previous + 1),
            HEALTH_REFRESH_INTERVAL_MS,
        );
        return () => window.clearInterval(interval);
    }, []);

    const refreshing = servers.some((url) => states[url]?.refreshing);

    return (
        <Shell title="サーバーの状況" size="small">
            {servers.length === 0 && (
                <p className="text-sm opacity-60">サーバーが設定されていません。</p>
            )}
            {servers.map((url, index) => (
                <HealthRow
                    key={url}
                    url={url}
                    name={
                        index === 0 ? "プライマリサーバー"
                        : index === 1 ? "セカンダリサーバー"
                        : index === 2 ? "フォールバックサーバー"
                        : `第${index + 1}サーバー`
                    }
                    serverRole={index === 0 ? "primary" : index === 1 ? "secondary" : "fallback"}
                    refreshSignal={refreshSignal}
                    onStatus={onStatus}
                />
            ))}
            <p className="w-full text-xs opacity-60">
                HTTP /health の応答時間。接続可能性の目安で、ルームの所有権は別途確認されます。
            </p>
            <Button iconName="rotateCcw"
                onClick={() => setRefreshSignal((current) => current + 1)}
                loading={refreshing} className="w-full">
                更新
            </Button>
        </Shell>
    );
}
