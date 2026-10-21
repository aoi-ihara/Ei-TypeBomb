/**
 * Independent, anonymous health probes. HTTP confirms the /health endpoint;
 * a transport handshake confirms the Socket.IO/native WebSocket endpoint.
 * Neither proves that a particular room is available or authoritative.
 */
export const HEALTH_PROBE_TIMEOUT_MS = 4_000;

export type HealthProbeResult = {
    healthy: boolean;
    latencyMs: number | null;
};

const unhealthy = (): HealthProbeResult => ({
    healthy: false,
    latencyMs: null,
});

/**
 * Bound the *result* as well as aborting the request. A fetch implementation
 * which ignores AbortSignal (or stalls while reading JSON) must not leave the
 * UI in a permanently refreshing state.
 */
function boundedProbe(
    run: (signal: AbortSignal) => Promise<HealthProbeResult>,
    externalSignal?: AbortSignal,
    timeoutMs = HEALTH_PROBE_TIMEOUT_MS,
): Promise<HealthProbeResult> {
    if (externalSignal?.aborted) return Promise.resolve(unhealthy());
    return new Promise((resolve) => {
        const controller = new AbortController();
        let finished = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (result: HealthProbeResult) => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            externalSignal?.removeEventListener("abort", cancel);
            controller.abort();
            resolve(result);
        };
        const cancel = () => finish(unhealthy());
        externalSignal?.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(cancel, timeoutMs);
        // Start only after setting the timeout/cancellation handlers.
        void Promise.resolve()
            .then(() => {
                // React cleanup may abort the probe before this microtask runs.
                // Never create a socket/fetch after cancellation.
                if (controller.signal.aborted) return unhealthy();
                return run(controller.signal);
            })
            .then(finish, cancel);
    });
}

export function probeServerHealth(
    endpoint: string,
    externalSignal?: AbortSignal,
    request: typeof fetch = fetch,
    now: () => number = () => performance.now(),
    timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
): Promise<HealthProbeResult> {
    const startedAt = now();
    return boundedProbe(
        async (signal) => {
            const url = new URL("/health", endpoint);
            const response = await request(url.toString(), {
                method: "GET",
                credentials: "omit",
                cache: "no-store",
                redirect: "error",
                headers: { Accept: "application/json" },
                signal,
            });
            if (!response.ok) return unhealthy();
            const body: unknown = await response.json();
            if (
                !body ||
                typeof body !== "object" ||
                (body as { ok?: unknown }).ok !== true
            )
                return unhealthy();
            return {
                healthy: true,
                latencyMs: Math.max(0, Math.round(now() - startedAt)),
            };
        },
        externalSignal,
        timeoutMs,
    );
}

export type HealthTransport = {
    on(
        event: "connect" | "connect_error" | "disconnect" | "error",
        listener: () => void,
    ): unknown;
    connect(): unknown;
    disconnect(): unknown;
};

/**
 * A successful connection event proves only the transport handshake, not
 * room authentication, voting quorum, or game state synchronization.
 */
export function probeServerTransport(
    open: () => HealthTransport,
    externalSignal?: AbortSignal,
    now: () => number = () => performance.now(),
    timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
): Promise<HealthProbeResult> {
    const startedAt = now();
    return boundedProbe(
        (signal) =>
            new Promise((resolve) => {
                // Defensive guard for callers that deliver an already-aborted signal.
                if (signal.aborted) {
                    resolve(unhealthy());
                    return;
                }
                const socket = open();
                let finished = false;
                const finish = (healthy: boolean) => {
                    if (finished) return;
                    finished = true;
                    signal.removeEventListener("abort", canceled);
                    try {
                        socket.disconnect();
                    } catch {
                        /* best effort */
                    }
                    resolve(
                        healthy
                            ? {
                                  healthy: true,
                                  latencyMs: Math.max(
                                      0,
                                      Math.round(now() - startedAt),
                                  ),
                              }
                            : unhealthy(),
                    );
                };
                const canceled = () => finish(false);
                signal.addEventListener("abort", canceled, { once: true });
                socket.on("connect", () => finish(true));
                socket.on("connect_error", () => finish(false));
                socket.on("disconnect", () => finish(false));
                socket.on("error", () => finish(false));
                // WorkerSocket.connect() is async. Treat an unexpected rejection as
                // a failed probe, without leaving an unhandled promise rejection.
                if (!finished && !signal.aborted) {
                    try {
                        void Promise.resolve(socket.connect()).catch(() =>
                            finish(false),
                        );
                    } catch {
                        finish(false);
                    }
                }
            }),
        externalSignal,
        timeoutMs,
    );
}

/** A row is a position *and* a URL; moving a server resets its old status. */
export const healthRowKey = (index: number, endpoint: string) =>
    `${index}:${endpoint}`;
