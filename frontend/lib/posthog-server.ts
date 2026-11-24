import { PostHog } from "posthog-node";
import { serverError } from "./server-console";

export function getPostHogClient({ remoteFlagsOnly = false } = {}): PostHog {
    const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || process.env.NEXT_PUBLIC_POSTHOG_KEY;
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
        ...(remoteFlagsOnly
            ? { enableLocalEvaluation: false, featureFlagsRequestTimeoutMs: 3_000, fetchRetryCount: 0 }
            : { secretKey: process.env.POSTHOG_PERSONAL_API_KEY }),
        flushAt: 1,
        flushInterval: 0,
    });
}
