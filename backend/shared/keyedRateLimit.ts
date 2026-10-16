/**
 * Runtime-independent token buckets. A caller owns the limiter instance and
 * supplies a monotonic clock, so Node sockets and Worker sessions can use the
 * same admission policy without sharing transport or timer APIs.
 */
export type RateLimit = Readonly<{ capacity: number; perSecond: number }>;

type Bucket = { tokens: number; updatedAt: number };
type Options = {
    maxBuckets?: number;
    staleAfterMs?: number;
};

export function createKeyedRateLimit(
    getLimit: (key: string) => RateLimit | undefined,
    now: () => number,
    options: Options = {},
): (key: string) => boolean {
    const buckets = new Map<string, Bucket>();

    return (key: string): boolean => {
        const limit = getLimit(key);
        if (!limit) return true;

        const time = now();
        const previous = buckets.get(key);
        const tokens = previous
            ? Math.min(
                  limit.capacity,
                  previous.tokens +
                      (Math.max(0, time - previous.updatedAt) * limit.perSecond) /
                          1000,
              )
            : limit.capacity;
        const accepted = tokens >= 1;
        buckets.set(key, {
            tokens: accepted ? tokens - 1 : tokens,
            updatedAt: time,
        });

        if (options.maxBuckets !== undefined && buckets.size > options.maxBuckets) {
            const staleAfterMs = options.staleAfterMs ?? Infinity;
            for (const [entryKey, bucket] of buckets) {
                if (time - bucket.updatedAt > staleAfterMs) buckets.delete(entryKey);
            }
            // Evict oldest inserted entries when clients churn faster than TTL.
            while (buckets.size > options.maxBuckets) {
                const oldest = buckets.keys().next().value;
                if (oldest === undefined) break;
                buckets.delete(oldest);
            }
        }

        return accepted;
    };
}
