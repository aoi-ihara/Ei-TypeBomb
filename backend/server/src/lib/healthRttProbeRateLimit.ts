import { EVENT_RATE_LIMITS } from "../../../shared/rateLimits";
import { createAddressRateLimit } from "./addressRateLimit";

// Enforce the RTT budget across reconnects from the same client address.
export const createHealthRttProbeRateLimit = (
    now?: () => number,
) => createAddressRateLimit(EVENT_RATE_LIMITS["health:ping"], now);
