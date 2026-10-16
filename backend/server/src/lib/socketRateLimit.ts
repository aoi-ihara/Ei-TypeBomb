import { performance } from "node:perf_hooks";
import type { Socket } from "socket.io";

import { eventRateLimit } from "../../../shared/rateLimits";
import { createKeyedRateLimit } from "../../../shared/keyedRateLimit";

// One limiter per socket. The pure core owns the buckets; the Node adapter
// only decides whether Socket.IO should dispatch an incoming event.
export const createSocketRateLimit = (
    now: () => number = () => performance.now(),
): Parameters<Socket["use"]>[0] => {
    const accept = createKeyedRateLimit(eventRateLimit, now);

    return ([event], next) => {
        // Rejected traffic stops before handlers run, without queuing, replies
        // or disconnects. Unknown event names retain the previous behavior.
        if (accept(event)) next();
    };
};
