"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
    HEALTH_PROBE_TIMEOUT_MS,
    healthRowKey,
    probeServerHealth,
    probeServerTransport,
    type HealthProbeResult,
} from "@/lib/room/healthProbe";
import { io } from "@/lib/room/socket";
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

function StatusLine({ label, result }: {
    label: string;
    result: HealthProbeResult | undefined;
}) {
    const health = result?.healthy;
    return (
        <div className="flex items-center gap-2 justify-between w-full text-sm">
            <span className="opacity-60">{label}</span>
            <span className={`font-mono flex items-center gap-1 ${
                health === true ? "text-green-500"
                    : health === false ? "text-red-500" : "text-gray-500"
            }`}>
                <Icon name={health === true ? "check" : health === false ? "x" : "info"} />
                {health === true
                    ? result.latencyMs !== null ? `${result.latencyMs}ms` : "正常"
                    : health === false ? "エラー" : "接続中…"}
            </span>
        </div>
    );
}

function HealthRow({
    url, name, serverRole, rowId, refreshSignal, refreshTrigger, onStatus,
}: {
    url: string;
    name: string;
    serverRole: ServerRole;
    rowId: string;
    refreshSignal: number;
    refreshTrigger: HealthCheckTrigger;
    onStatus: (rowId: string, signal: number, refreshing: boolean) => void;
}) {
    const [http, setHttp] = useState<HealthProbeResult>();
    const [transport, setTransport] = useState<HealthProbeResult>();

    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        onStatus(rowId, refreshSignal, true);

        const httpProbe = probeServerHealth(url, controller.signal).then((result) => {
            if (!active) return;
            setHttp(result);
            captureServerHealthCheck({
                serverRole,
                checkType: "rtt",
                healthy: result.healthy,
                latencyMs: result.latencyMs,
                connectionLatencyMs: null,
                trigger: refreshTrigger,
            });
        });
        const socketProbe = probeServerTransport(() => {
            // Health-only sockets never carry a room JWT or create a game
            // session. The Worker adapter selects /ws/health automatically.
            const socket = io(url, {
                healthOnly: true,
                autoConnect: false,
                reconnection: false,
                forceNew: true,
                timeout: HEALTH_PROBE_TIMEOUT_MS,
            });
            return {
                on: (event: "connect" | "connect_error" | "disconnect" | "error",
                    listener: () => void) => { socket.on(event, listener); },
                connect: () => socket.connect(),
                disconnect: () => socket.disconnect(),
            };
        }, controller.signal).then((result) => {
            if (!active) return;
            setTransport(result);
            captureServerHealthCheck({
                serverRole,
                checkType: "transport",
                healthy: result.healthy,
                latencyMs: result.latencyMs,
                connectionLatencyMs: result.latencyMs,
                trigger: refreshTrigger,
            });
        });

        void Promise.all([httpProbe, socketProbe]).finally(() => {
            if (active) onStatus(rowId, refreshSignal, false);
        });
        return () => {
            active = false;
            controller.abort();
        };
    }, [url, rowId, serverRole, refreshSignal, refreshTrigger, onStatus]);

    return (
        <div className="w-full flex flex-col gap-2 animate-appear">
            <div className="font-bold" data-cursor="text">{name}</div>
            <StatusLine label="HTTP" result={http} />
            <StatusLine label="WebSocket" result={transport} />
        </div>
    );
}

const HEALTH_REFRESH_INTERVAL_MS = 60_000;
type RowProgress = { signal: number; refreshing: boolean };

export default function ServerHealth({ clusterServers }: { clusterServers: string[] }) {
    const storedConfig = useSyncExternalStore(
        subscribeConfig, getStoredServerConfig, getServerSnapshot,
    );
    const servers = parseStoredServerConfig(storedConfig) ??
        (clusterServers.length > 0 ? clusterServers : [
            process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL,
            process.env.NEXT_PUBLIC_SECONDARY_SERVER_URL,
            process.env.NEXT_PUBLIC_FALLBACK_SERVER_URL,
        ].filter((url): url is string => Boolean(url)));

    const [refresh, setRefresh] = useState<{ signal: number; trigger: HealthCheckTrigger }>({
        signal: 0, trigger: "initial",
    });
    const [states, setStates] = useState<Record<string, RowProgress>>({});
    const onStatus = useCallback((rowId: string, signal: number, refreshing: boolean) => {
        setStates((previous) => {
            const current = previous[rowId];
            if (current?.signal === signal && current.refreshing === refreshing)
                return previous;
            return { ...previous, [rowId]: { signal, refreshing } };
        });
    }, []);

    useEffect(() => {
        const interval = window.setInterval(
            () => setRefresh((previous) => ({
                signal: previous.signal + 1, trigger: "interval",
            })),
            HEALTH_REFRESH_INTERVAL_MS,
        );
        return () => window.clearInterval(interval);
    }, []);

    const refreshing = servers.some((url, index) => {
        const progress = states[healthRowKey(index, url)];
        return progress?.signal === refresh.signal && progress.refreshing;
    });

    return (
        <Shell title="サーバーの状況" size="small">
            {servers.length === 0 && (
                <p className="text-sm opacity-60">サーバーが設定されていません。</p>
            )}
            {servers.map((url, index) => {
                const rowId = healthRowKey(index, url);
                return (
                    <HealthRow
                        key={rowId}
                        rowId={rowId}
                        url={url}
                        name={
                            index === 0 ? "プライマリサーバー"
                            : index === 1 ? "セカンダリサーバー"
                            : index === 2 ? "フォールバックサーバー"
                            : `第${index + 1}サーバー`
                        }
                        serverRole={index === 0 ? "primary" : index === 1 ? "secondary" : "fallback"}
                        refreshSignal={refresh.signal}
                        refreshTrigger={refresh.trigger}
                        onStatus={onStatus}
                    />
                );
            })}
            <p className="w-full text-xs opacity-60">
                HTTPは/healthの応答時間、WebSocketは接続確立までの時間です。
                ルームの認証や所有権の確認とは異なります。
            </p>
            <Button
                iconName="rotateCcw"
                onClick={() => setRefresh((previous) => ({
                    signal: previous.signal + 1, trigger: "manual",
                }))}
                loading={refreshing}
                className="w-full"
            >
                更新
            </Button>
        </Shell>
    );
}
