import { performance } from "node:perf_hooks";

import { EVENT_RATE_LIMITS } from "../../../shared/rateLimits";

const { capacity: CAPACITY, perSecond: TOKENS_PER_SECOND } =
    EVENT_RATE_LIMITS["health:database"];
const STALE_AFTER_MS = 60_000;

type Bucket = { tokens: number; updatedAt: number };

export const createDatabaseProbeRateLimit = (
    now: () => number = () => performance.now(),
) => {
    const buckets = new Map<string, Bucket>();

    return (clientAddress: string): boolean => {
        const time = now();
        const existing = buckets.get(clientAddress);
        const bucket = existing ?? { tokens: CAPACITY, updatedAt: time };
        bucket.tokens = Math.min(
            CAPACITY,
            bucket.tokens +
                (Math.max(0, time - bucket.updatedAt) * TOKENS_PER_SECOND) /
                    1000,
        );
        bucket.updatedAt = time;

        if (bucket.tokens < 1) {
            buckets.set(clientAddress, bucket);
            return false;
        }

        bucket.tokens -= 1;
        buckets.set(clientAddress, bucket);

        // Opportunistically discard inactive addresses so spoofed/new addresses
        // cannot make the process-wide limiter grow forever.
        if (buckets.size > 1_000) {
            for (const [address, candidate] of buckets) {
                if (time - candidate.updatedAt > STALE_AFTER_MS)
                    buckets.delete(address);
            }
            while (buckets.size > 1_000) {
                const oldestAddress = buckets.keys().next().value;
                if (oldestAddress === undefined) break;
                buckets.delete(oldestAddress);
            }
        }
        return true;
    };
};
