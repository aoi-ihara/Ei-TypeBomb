import { EVENT_RATE_LIMITS } from "../../../shared/rateLimits";
import { createAddressRateLimit } from "../../../shared/addressRateLimit";

export const createDatabaseProbeRateLimit = (
    now: () => number = () => performance.now(),
) => createAddressRateLimit(EVENT_RATE_LIMITS["health:database"], now);
