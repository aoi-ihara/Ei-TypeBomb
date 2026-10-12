import { performance } from "node:perf_hooks";

import type { EVENT_RATE_LIMITS } from "../../../shared/rateLimits";

type RateLimit = (typeof EVENT_RATE_LIMITS)[keyof typeof EVENT_RATE_LIMITS];
type Bucket = { tokens: number; updatedAt: number };
const STALE_AFTER_MS = 60_000;
const MAX_BUCKETS = 1_000;

export const createAddressRateLimit = (
    limit: RateLimit,
    now: () => number = () => performance.now(),
) => {
    const buckets = new Map<string, Bucket>();

    return (clientAddress: string): boolean => {
        const time = now();
        const existing = buckets.get(clientAddress);
        const bucket = existing ?? {
            tokens: limit.capacity,
            updatedAt: time,
        };
        bucket.tokens = Math.min(
            limit.capacity,
            bucket.tokens +
                (Math.max(0, time - bucket.updatedAt) * limit.perSecond) /
                    1000,
        );
        bucket.updatedAt = time;

        if (bucket.tokens < 1) {
            buckets.set(clientAddress, bucket);
            return false;
        }

        bucket.tokens -= 1;
        buckets.set(clientAddress, bucket);

        // Bound process-wide state and discard inactive addresses opportunistically.
        if (buckets.size > MAX_BUCKETS) {
            for (const [address, candidate] of buckets) {
                if (time - candidate.updatedAt > STALE_AFTER_MS)
                    buckets.delete(address);
            }
            while (buckets.size > MAX_BUCKETS) {
                const oldestAddress = buckets.keys().next().value;
                if (oldestAddress === undefined) break;
                buckets.delete(oldestAddress);
            }
        }
        return true;
    };
};
