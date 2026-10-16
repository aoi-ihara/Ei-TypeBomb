import { createKeyedRateLimit, type RateLimit } from "./keyedRateLimit";

const STALE_AFTER_MS = 60_000;
const MAX_BUCKETS = 1_000;

/** Caller-scoped address limiter; the transport decides what an address means. */
export const createAddressRateLimit = (
    limit: RateLimit,
    now: () => number,
) =>
    createKeyedRateLimit(() => limit, now, {
        staleAfterMs: STALE_AFTER_MS,
        maxBuckets: MAX_BUCKETS,
    });
