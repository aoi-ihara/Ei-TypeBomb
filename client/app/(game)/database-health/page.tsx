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

const CONNECTION_TIMEOUT_MS = 2_000;
const DATABASE_TIMEOUT_MS = 7_000;
const HEALTH_REFRESH_INTERVAL_MS = 60_000;

function DatabaseStatus({
    name,
    health,
    latencyMs,
}: {
    name: string;
    health: boolean | undefined;
    latencyMs: number | null;
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
                    ? latencyMs !== null
                        ? `${latencyMs}ms`
                        : "正常"
                    : health === false
                      ? "エラー"
                      : "接続中…"}
            </div>
        </div>
    );
}

function useDatabaseHealth(
    url: string | undefined,
    serverRole: ServerRole,
) {
    const [health, setHealth] = useState<boolean | undefined>(undefined);
    const [latencyMs, setLatencyMs] = useState<number | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    const activeSocketRef = useRef<ReturnType<typeof io> | null>(null);
    const checkIdRef = useRef(0);

    const checkServer = useCallback(
        (trigger: HealthCheckTrigger = "manual") => {
            const checkId = ++checkIdRef.current;
            setRefreshing(true);
            activeSocketRef.current?.disconnect();
            activeSocketRef.current = null;

            const finish = (
                nextHealth: boolean,
                nextLatencyMs: number | null,
            ) => {
                if (checkId !== checkIdRef.current) return;

                setHealth(nextHealth);
                setLatencyMs(nextLatencyMs);
                setRefreshing(false);
                captureServerHealthCheck({
                    serverRole,
                    checkType: "database",
                    healthy: nextHealth,
                    latencyMs: nextLatencyMs,
                    trigger,
                });
            };

            if (!url) {
                finish(false, null);
                return;
            }

            const socket = io(url, {
                reconnection: false,
                timeout: CONNECTION_TIMEOUT_MS,
                autoConnect: true,
                forceNew: true,
                healthOnly: true,
            });
            activeSocketRef.current = socket;

            let databaseTimer: ReturnType<typeof setTimeout> | null = null;
            let finished = false;

            const finishAndDisconnect = (
                nextHealth: boolean,
                nextLatencyMs: number | null,
            ) => {
                if (finished || checkId !== checkIdRef.current) return;
                finished = true;
                if (databaseTimer) clearTimeout(databaseTimer);

                finish(nextHealth, nextLatencyMs);
                socket.disconnect();
                if (activeSocketRef.current === socket) {
                    activeSocketRef.current = null;
                }
            };

            socket.once("connect", () => {
                if (checkId !== checkIdRef.current) return;

                const requestId = crypto.randomUUID();

                socket.once(
                    "health:database-result",
                    (result: unknown) => {
                        if (
                            !result ||
                            typeof result !== "object" ||
                            !("requestId" in result) ||
                            result.requestId !== requestId ||
                            !("ok" in result) ||
                            typeof result.ok !== "boolean"
                        )
                            return;

                        const nextLatencyMs =
                            "latencyMs" in result &&
                            typeof result.latencyMs === "number"
                                ? result.latencyMs
                                : null;

                        finishAndDisconnect(result.ok, nextLatencyMs);
                    },
                );

                socket.emit("health:database", requestId);
                databaseTimer = setTimeout(() => {
                    finishAndDisconnect(false, null);
                }, DATABASE_TIMEOUT_MS);
            });

            socket.once("connect_error", () => {
                finishAndDisconnect(false, null);
            });
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
        latencyMs,
        refreshing,
        checkServer,
    };
}

export default function DatabaseHealth() {
    const primary = useDatabaseHealth(
        process.env.NEXT_PUBLIC_PRIMARY_SERVER_URL,
        "primary",
    );
    const secondary = useDatabaseHealth(
        process.env.NEXT_PUBLIC_SECONDARY_SERVER_URL,
        "secondary",
    );
    const fallback = useDatabaseHealth(
        process.env.NEXT_PUBLIC_FALLBACK_SERVER_URL,
        "fallback",
    );

    const refreshing =
        primary.refreshing || secondary.refreshing || fallback.refreshing;

    const handleRefresh = useCallback(() => {
        primary.checkServer("manual");
        secondary.checkServer("manual");
        fallback.checkServer("manual");
    }, [primary.checkServer, secondary.checkServer, fallback.checkServer]);

    return (
        <Shell
            title="データベースの状況"
            size="small"
            loading={
                primary.health === undefined &&
                secondary.health === undefined &&
                fallback.health === undefined
            }
        >
            <DatabaseStatus
                name="プレイマリサーバー"
                health={primary.health}
                latencyMs={primary.latencyMs}
            />
            <DatabaseStatus
                name="セカンダリサーバー"
                health={secondary.health}
                latencyMs={secondary.latencyMs}
            />
            <DatabaseStatus
                name="フォールバックサーバー"
                health={fallback.health}
                latencyMs={fallback.latencyMs}
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
