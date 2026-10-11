import { performance } from "node:perf_hooks";
import type { Socket } from "socket.io";

import { eventRateLimit } from "../../../shared/rateLimits";

// Create once per connection. State is bounded by the configured event names
// and is released with the socket; no timers or global socket registry needed.
export const createSocketRateLimit = (
    now: () => number = () => performance.now(),
): Parameters<Socket["use"]>[0] => {
    const buckets = new Map<string, { tokens: number; updatedAt: number }>();

    return ([event], next) => {
        const limit = eventRateLimit(event);
        if (!limit) {
            next();
            return;
        }

        const time = now();
        const bucket = buckets.get(event) ?? {
            tokens: limit.capacity,
            updatedAt: time,
        };
        bucket.tokens = Math.min(
            limit.capacity,
            bucket.tokens +
                (Math.max(0, time - bucket.updatedAt) * limit.perSecond) / 1000,
        );
        bucket.updatedAt = time;
        buckets.set(event, bucket);

        // Intentionally stop middleware dispatch: no response, log flood, queue,
        // or disconnect. A later event is accepted as soon as a token refills.
        if (bucket.tokens < 1) return;
        bucket.tokens -= 1;
        next();
    };
};
