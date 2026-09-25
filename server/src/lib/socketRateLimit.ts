import { performance } from "node:perf_hooks";
import type { Socket } from "socket.io";

// Independent token buckets: typing cannot consume the budget for game actions.
// capacity allows brief bursts; perSecond controls the sustained event rate.
const limits = new Map([
    ["currentInput", { capacity: 60, perSecond: 30 }],
    ["word:success", { capacity: 10, perSecond: 5 }],
    ["room:join", { capacity: 5, perSecond: 2 }],
    ["room:leave", { capacity: 5, perSecond: 2 }],
    ["game:start", { capacity: 2, perSecond: 1 }],
    ["auth:response", { capacity: 3, perSecond: 0.5 }],
]);

// Create once per connection. State is bounded by the configured event names
// and is released with the socket; no timers or global socket registry needed.
export const createSocketRateLimit = (
    now: () => number = () => performance.now(),
): Parameters<Socket["use"]>[0] => {
    const buckets = new Map<string, { tokens: number; updatedAt: number }>();

    return ([event], next) => {
        const limit = limits.get(event);
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
            bucket.tokens + (Math.max(0, time - bucket.updatedAt) * limit.perSecond) / 1000,
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
