import { EVENT_RATE_LIMITS } from "../../../shared/rateLimits";
import { createAddressRateLimit } from "../../../shared/addressRateLimit";

// Enforce the RTT budget across reconnects from the same client address.
export const createHealthRttProbeRateLimit = (
    now: () => number = () => performance.now(),
) => createAddressRateLimit(EVENT_RATE_LIMITS["health:ping"], now);
