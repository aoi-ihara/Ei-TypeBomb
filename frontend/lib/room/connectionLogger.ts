"use client";

/**
 * Browser-only connection diagnostics. Log operations, never JWTs, signed
 * session tokens, room IDs, player IDs, display names or raw socket payloads.
 * The allowlist also prevents accidental leakage from future call sites.
 */
export type ConnectionTopic = "CONNECTED" | "CONNECTION" | "AUTH" | "FALLBACK";
type DiagnosticValue = string | number | boolean | null | undefined;
type DiagnosticDetails = Record<string, DiagnosticValue>;

const allowedKeys = new Set([
    "attempt", "code", "durationMs", "elapsedMs", "epoch", "errorType",
    "expectedInstanceKnown", "fromDepth", "fromTier", "heartbeatAgeMs",
    "httpStatus", "lifecycle", "owner", "phase", "previousOwner", "reason",
    "recoveryId", "reportCalls", "retryable", "retryCount", "retryDelayMs",
    "revision", "routeCalls", "server", "serverDepth", "snapshotRecoveryMs",
    "socketConnected", "tier", "toDepth", "toTier", "transport", "visibility",
]);

const safeDetails = (details: DiagnosticDetails): DiagnosticDetails =>
    Object.fromEntries(Object.entries(details).filter(
        ([key, value]) => allowedKeys.has(key) &&
            (value === null || ["string", "number", "boolean"].includes(typeof value)) &&
            (typeof value !== "string" || value.length <= 250),
    ));

export function connectionLog(
    topic: ConnectionTopic,
    message: string,
    details: DiagnosticDetails = {},
): void {
    console.log(`[${topic}] ${message}`, safeDetails(details));
}

export function connectionError(
    topic: ConnectionTopic,
    message: string,
    details: DiagnosticDetails = {},
): void {
    console.error(`[${topic}] ${message}`, safeDetails(details));
}

// Never print an arbitrary Error.message: browsers and transports may include
// request URLs, credentials or user-controlled content in those messages.
const safeReasons = new Set([
    "Room authorization missing",
    "Stale routing response",
    "Routing endpoint unavailable",
    "Invalid routing response",
    "Authoritative routing unavailable",
    "No reachable room owner",
    "Owner has not approved transfer",
    "Expected checkpoint is unavailable",
    "No existing room to restore",
]);
export function connectionErrorDetails(error: unknown): DiagnosticDetails {
    if (!error || typeof error !== "object")
        return { errorType: typeof error };
    const value = error as {
        name?: unknown;
        message?: unknown;
        code?: unknown;
        retryable?: unknown;
        status?: unknown;
    };
    return {
        ...(typeof value.name === "string" && /^[A-Za-z]{1,40}$/.test(value.name)
            ? { errorType: value.name } : {}),
        ...(typeof value.code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value.code)
            ? { code: value.code } : {}),
        ...(typeof value.retryable === "boolean" ? { retryable: value.retryable } : {}),
        ...(typeof value.status === "number" && Number.isInteger(value.status)
            ? { httpStatus: value.status } : {}),
        ...(typeof value.message === "string" && safeReasons.has(value.message)
            ? { reason: value.message } : {}),
    };
}

/** A connected socket will not retry authentication automatically. */
export function isTerminalConnectionError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const value = error as { code?: unknown; retryable?: unknown };
    return value.code === "AUTH_FAILED" || value.retryable === false;
}
