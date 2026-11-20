import { getPostHogClient } from "@/lib/posthog-server";

const FLAG_NAME = "beta-testers";

// These routes must remain reachable to let users sign in and complete OAuth.
export function isPublicBetaPath(pathname: string): boolean {
    return (
        pathname === "/beta-access-denied" ||
        pathname === "/sign-in" ||
        pathname.startsWith("/sign-in/") ||
        pathname === "/sign-up" ||
        pathname === "/auth/confirm" ||
        pathname === "/oauth/consent" ||
        pathname === "/api/oauth" ||
        pathname.startsWith("/api/oauth/") ||
        pathname === "/.well-known/oauth-authorization-server" ||
        pathname === "/.well-known/oauth-protected-resource/api/mcp" ||
        pathname === "/ingest" ||
        pathname.startsWith("/ingest/") ||
        ["/favicon.ico", "/favicon.svg", "/favicon-2.svg", "/apple-icon.png", "/hero.png"].includes(pathname)
    );
}

export const isBetaEnvironment = () =>
    process.env.BETA_ENVIRONMENT === "true";

let posthog: ReturnType<typeof getPostHogClient> | undefined;

/**
 * Access is evaluated server-side against the authenticated Supabase user ID,
 * which is also used by posthog.identify() in the browser.
 * Missing configuration, a false flag or an unavailable PostHog all deny access.
 */
export async function canAccessBeta(userId: string | null): Promise<boolean> {
    if (!isBetaEnvironment()) return true;
    if (
        !userId ||
        !(process.env.NEXT_PUBLIC_POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN)
    ) {
        return false;
    }

    try {
        posthog ??= getPostHogClient();
        return (await posthog.isFeatureEnabled(FLAG_NAME, userId)) === true;
    } catch (error) {
        console.error("Beta tester feature flag could not be evaluated", error);
        return false;
    }
}
