/**
 * Browser-side health checks use a real HTTP round trip, not a Socket.IO
 * handshake or a rate-limited game-room ping. The endpoints expose only a
 * public process-health result; no room tokens or cookies are sent.
 */
export const HEALTH_PROBE_TIMEOUT_MS = 4_000;

export type HealthProbeResult = {
    healthy: boolean;
    latencyMs: number | null;
};

export async function probeServerHealth(
    endpoint: string,
    externalSignal?: AbortSignal,
    request: typeof fetch = fetch,
    now: () => number = () => performance.now(),
    timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
): Promise<HealthProbeResult> {
    const startedAt = now();
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (externalSignal?.aborted) abort();
    else externalSignal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
        const url = new URL("/health", endpoint);
        const response = await request(url.toString(), {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            headers: { Accept: "application/json" },
            signal: controller.signal,
        });
        if (!response.ok) return { healthy: false, latencyMs: null };
        const body: unknown = await response.json();
        if (!body || typeof body !== "object" ||
            (body as { ok?: unknown }).ok !== true)
            return { healthy: false, latencyMs: null };
        return {
            healthy: true,
            latencyMs: Math.max(0, Math.round(now() - startedAt)),
        };
    } catch {
        // Covers timeout, CORS errors and unreachable hosts. A failed probe
        // must never keep the UI waiting or be reported as healthy.
        return { healthy: false, latencyMs: null };
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", abort);
    }
}
