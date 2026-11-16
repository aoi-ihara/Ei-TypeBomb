import "server-only";

/**
 * Transport-only Upstash REST primitives shared by room caches.
 *
 * Key layout, TTLs, visibility checks, generations and privacy fences are
 * intentionally owned by each cache. Keeping them separate prevents a
 * refactor of the HTTP client from changing cache authorization semantics.
 */
const TIMEOUT_MS = 1000;

export const isUpstashConfigured = () =>
    Boolean(
        process.env.UPSTASH_REDIS_REST_URL &&
            process.env.UPSTASH_REDIS_REST_TOKEN,
    );

export const getDeploymentCacheNamespace = () => {
    const environment = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "local";
    const branch =
        environment === "preview"
            ? ":" + (process.env.VERCEL_GIT_COMMIT_REF ?? "default")
            : "";
    return environment + branch;
};

export async function runUpstashCommand<T>(
    args: (string | number)[],
): Promise<T | null> {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new Error("Upstash is not configured");

    const response = await fetch(url, {
        method: "POST",
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) throw new Error("Upstash HTTP " + response.status);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object")
        throw new Error("Invalid Upstash response");
    const record = body as { result?: unknown; error?: string };
    if (record.error) throw new Error("Upstash command failed");
    if (!("result" in record)) throw new Error("Missing Upstash result");
    return record.result as T | null;
}
