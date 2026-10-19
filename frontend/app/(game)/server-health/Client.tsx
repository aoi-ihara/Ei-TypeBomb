"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { io } from "@/lib/room/socket";
import {
    captureServerHealthCheck,
    type HealthCheckTrigger,
    type ServerRole,
} from "@/lib/analytics/serverHealth";
import Shell from "@/components/layout/Shell";
import { Icon } from "@/components/ui/Icon";
import Button from "@/components/ui/Button";
import { useSyncExternalStore } from "react";
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

const HEALTH_TIMEOUT_MS = 2_000;
const HEALTH_REFRESH_INTERVAL_MS = 60_000;

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

function useServerHealth(url: string | undefined, serverRole: ServerRole) {
    const [health, setHealth] = useState<boolean | undefined>(undefined);
    const [connectionLatency, setConnectionLatency] = useState<number | null>(
        null,
    );
    const [rttLatency, setRttLatency] = useState<number | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const activeSocketRef = useRef<ReturnType<typeof io> | null>(null);
    const checkIdRef = useRef(0);

    const checkServer = useCallback(
        (trigger: HealthCheckTrigger = "manual") => {
            const checkId = ++checkIdRef.current;
            setRefreshing(true);
            activeSocketRef.current?.disconnect();
            activeSocketRef.current = null;

            if (!url) {
                setHealth(false);
                setConnectionLatency(null);
                setRttLatency(null);
                setRefreshing(false);
                return;
            }

            // Keep the previous result visible while refreshing. Only the initial
            // check has health === undefined and therefore shows "接続中…".
            const connectionStartedAt = performance.now();
            // Register listeners and the watchdog before initiating a socket
            // connection. Otherwise a stalled connection might never report
            // a result (Socket.IO's own timeout may be much longer).
            const socket = io(url, {
                reconnection: false,
                timeout: HEALTH_TIMEOUT_MS,
                autoConnect: false,
                forceNew: true,
                healthOnly: true,
            });
            activeSocketRef.current = socket;

            let connectionTimer: ReturnType<typeof setTimeout> | null = null;
            let rttTimer: ReturnType<typeof setTimeout> | null = null;
            let finished = false;

            const finish = (
                nextHealth: boolean,
                nextConnectionLatency: number | null,
                nextRttLatency: number | null,
            ) => {
                if (finished || checkId !== checkIdRef.current) return;
                finished = true;
                if (connectionTimer) clearTimeout(connectionTimer);
                if (rttTimer) clearTimeout(rttTimer);

                setHealth(nextHealth);
                setConnectionLatency(nextConnectionLatency);
                setRttLatency(nextRttLatency);
                setRefreshing(false);

                captureServerHealthCheck({
                    serverRole,
                    checkType: "rtt",
                    healthy: nextHealth,
                    latencyMs: nextRttLatency,
                    connectionLatencyMs: nextConnectionLatency,
                    trigger,
                });

                socket.disconnect();
                if (activeSocketRef.current === socket) {
                    activeSocketRef.current = null;
                }
            };

            const handleConnect = () => {
                if (checkId !== checkIdRef.current || finished) return;
                if (connectionTimer) clearTimeout(connectionTimer);
                connectionTimer = null;
                const nextConnectionLatency = Math.round(
                    performance.now() - connectionStartedAt,
                );
                const pingId = crypto.randomUUID();
                const rttStartedAt = performance.now();

                socket.once("health:pong", (receivedPingId: unknown) => {
                    if (receivedPingId !== pingId) return;

                    finish(
                        true,
                        nextConnectionLatency,
                        Math.round(performance.now() - rttStartedAt),
                    );
                });

                rttTimer = setTimeout(() => {
                    // Transport is connected, even if RTT probe is throttled.
                    finish(true, nextConnectionLatency, null);
                }, HEALTH_TIMEOUT_MS);
                socket.emit("health:ping", pingId);
            };

            const handleConnectError = () => {
                finish(false, null, null);
            };

            socket.once("connect", handleConnect);
            socket.once("connect_error", handleConnectError);
            socket.once("disconnect", handleConnectError);
            connectionTimer = setTimeout(
                () => finish(false, null, null),
                HEALTH_TIMEOUT_MS,
            );
            void socket.connect();
        },
        [serverRole, url],
    );

    useEffect(() => {
        const initialCheck = window.setTimeout(() => checkServer("initial"), 0);
        const interval = window.setInterval(
            () => checkServer("interval"),
            HEALTH_REFRESH_INTERVAL_MS,
        );

        return () => {
            window.clearTimeout(initialCheck);
            window.clearInterval(interval);
            checkIdRef.current++;
            activeSocketRef.current?.disconnect();
            activeSocketRef.current = null;
        };
    }, [checkServer]);

    return {
        health,
        connectionLatency,
        rttLatency,
        refreshing,
        checkServer,
    };
}


type HealthRowState = { health: boolean | undefined; refreshing: boolean };

function HealthRow({
    url, name, serverRole, refreshSignal, index, onStatus,
}: {
    url: string;
    name: string;
    serverRole: ServerRole;
    refreshSignal: number;
    index: number;
    onStatus: (index: number, state: HealthRowState) => void;
}) {
    const { health, rttLatency, refreshing, checkServer } =
        useServerHealth(url, serverRole);
    useEffect(() => {
        onStatus(index, { health, refreshing });
    }, [health, refreshing, index, onStatus]);
    useEffect(() => {
        if (refreshSignal > 0) checkServer("manual");
    }, [refreshSignal, checkServer]);
    return <ServerStatus name={name} health={health} rttLatency={rttLatency} />;
}

export default function ServerHealth({ clusterServers }: { clusterServers: string[] }) {
    const storedConfig = useSyncExternalStore(
        subscribeConfig,
        getStoredServerConfig,
        getServerSnapshot,
    );
    // The browser override is ordered exactly like ETB_CLUSTER_CONFIG.
    // No override means the deployment's configured servers remain active.
    const servers = parseStoredServerConfig(storedConfig) ??
        (clusterServers.length > 0 ? clusterServers : [
            process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL,
            process.env.NEXT_PUBLIC_SECONDARY_SERVER_URL,
            process.env.NEXT_PUBLIC_FALLBACK_SERVER_URL,
        ].filter((url): url is string => Boolean(url)));

    const [refreshSignal, setRefreshSignal] = useState(0);
    const [states, setStates] = useState<Record<number, HealthRowState>>({});
    const onStatus = useCallback((index: number, next: HealthRowState) => {
        setStates((previous) => {
            const current = previous[index];
            if (current?.health === next.health &&
                current?.refreshing === next.refreshing) return previous;
            return { ...previous, [index]: next };
        });
    }, []);

    const refreshing = servers.some((_, index) => states[index]?.refreshing);

    return (
        // Shell hides its children while loading. HealthRow must be mounted
        // immediately so its effect can actually start the first probe.
        <Shell title="サーバーの状況" size="small">
            {servers.length === 0 && (
                <p className="text-sm opacity-60">
                    サーバーが設定されていません。
                </p>
            )}
            {servers.map((url, index) => (
                <HealthRow
                    key={url}
                    index={index}
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
            <Button iconName="rotateCcw"
                onClick={() => setRefreshSignal((current) => current + 1)}
                loading={refreshing} className="w-full">
                更新
            </Button>
        </Shell>
    );
}
