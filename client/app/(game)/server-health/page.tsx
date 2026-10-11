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

function useServerHealth(
    url: string | undefined,
    serverRole: ServerRole,
) {
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
            const socket = io(url, {
                reconnection: false,
                timeout: HEALTH_TIMEOUT_MS,
                autoConnect: true,
                forceNew: true,
                healthOnly: true,
            });
            activeSocketRef.current = socket;

            let rttTimer: ReturnType<typeof setTimeout> | null = null;
            let finished = false;

            const finish = (
                nextHealth: boolean,
                nextConnectionLatency: number | null,
                nextRttLatency: number | null,
            ) => {
                if (finished || checkId !== checkIdRef.current) return;
                finished = true;
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
                if (checkId !== checkIdRef.current) return;

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

                socket.emit("health:ping", pingId);
                rttTimer = setTimeout(() => {
                    finish(true, nextConnectionLatency, null);
                }, HEALTH_TIMEOUT_MS);
            };

            const handleConnectError = () => {
                finish(false, null, null);
            };

            socket.once("connect", handleConnect);
            socket.once("connect_error", handleConnectError);
        },
        [serverRole, url],
    );

    useEffect(() => {
        const initialCheck = window.setTimeout(
            () => checkServer("initial"),
            0,
        );
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

export default function ServerHealth() {
    const primaryUrl = process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL;
    const secondaryUrl = process.env.NEXT_PUBLIC_SECONDARY_SERVER_URL;
    const fallbackUrl = process.env.NEXT_PUBLIC_FALLBACK_SERVER_URL;

    const primary = useServerHealth(primaryUrl, "primary");
    const secondary = useServerHealth(secondaryUrl, "secondary");
    const fallback = useServerHealth(fallbackUrl, "fallback");

    const refreshing =
        primary.refreshing || secondary.refreshing || fallback.refreshing;

    const handleRefresh = useCallback(() => {
        primary.checkServer("manual");
        secondary.checkServer("manual");
        fallback.checkServer("manual");
    }, [primary.checkServer, secondary.checkServer, fallback.checkServer]);

    return (
        <Shell
            title="サーバーの状況"
            size="small"
            loading={
                primary.health === undefined &&
                secondary.health === undefined &&
                fallback.health === undefined
            }
        >
            <ServerStatus
                name="プレイマリサーバー"
                health={primary.health}
                rttLatency={primary.rttLatency}
            />

            <ServerStatus
                name="セカンダリサーバー"
                health={secondary.health}
                rttLatency={secondary.rttLatency}
            />

            <ServerStatus
                name="フォールバックサーバー"
                health={fallback.health}
                rttLatency={fallback.rttLatency}
            />

            <Button
                iconName="rotateCw"
                onClick={handleRefresh}
                loading={refreshing}
                className="w-full"
            >
                更新
            </Button>
        </Shell>
    );
}
