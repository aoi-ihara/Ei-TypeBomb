import { PostHog } from "posthog-node";
import { serverError } from "./server-console";

export function getPostHogClient(): PostHog {
    const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

    if (!token && process.env.NODE_ENV !== "production") {
        serverError(
            "PostHog project token is missing; events may be silently missed",
            undefined,
            "POSTHOG",
        );
    }

    return new PostHog(token ?? "", {
        host: host ?? "https://us.i.posthog.com",
        flushAt: 1,
        flushInterval: 0,
    });
}
