import { EVENT_RATE_LIMITS } from "../../../shared/rateLimits";
import { createAddressRateLimit } from "./addressRateLimit";

export const createDatabaseProbeRateLimit = (
    now?: () => number,
) => createAddressRateLimit(EVENT_RATE_LIMITS["health:database"], now);
