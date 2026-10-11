"use client";

import posthog from "posthog-js";

export type ServerRole = "primary" | "secondary" | "fallback";
export type HealthCheckType = "rtt" | "database";
export type HealthCheckTrigger = "initial" | "interval" | "manual";

export function captureServerHealthCheck({
    serverRole,
    checkType,
    healthy,
    latencyMs,
    trigger,
    connectionLatencyMs,
}: {
    serverRole: ServerRole;
    checkType: HealthCheckType;
    healthy: boolean;
    latencyMs: number | null;
    trigger: HealthCheckTrigger;
    connectionLatencyMs?: number | null;
}) {
    posthog.capture("server_health_checked", {
        server_role: serverRole,
        check_type: checkType,
        healthy,
        health_value: healthy ? 1 : 0,
        latency_ms: latencyMs,
        latency_available: latencyMs !== null,
        connection_latency_ms: connectionLatencyMs ?? null,
        trigger,
        checked_at: new Date().toISOString(),
        client_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
}
