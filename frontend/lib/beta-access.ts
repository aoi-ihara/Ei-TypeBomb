import { getPostHogClient } from "@/lib/posthog-server";

const FLAG_NAME = "beta-testers";

// These routes must remain reachable to let users sign in and complete OAuth.
export function isPublicBetaPath(pathname: string): boolean {
    return (
        pathname === "/beta-access-denied" ||
        pathname === "/sign-in" ||
        pathname.startsWith("/sign-in/") ||
        pathname === "/sign-up" ||
        pathname === "/sign-up/check-email" ||
        pathname === "/auth/confirm" ||
        pathname === "/oauth/consent" ||
        pathname === "/api/oauth" ||
        pathname.startsWith("/api/oauth/") ||
        pathname === "/.well-known/oauth-authorization-server" ||
        pathname === "/.well-known/oauth-protected-resource/api/mcp" ||
        pathname === "/ingest" ||
        pathname.startsWith("/ingest/") ||
        [
            "/favicon-dark.ico",
            "/favicon.ico",
            "/apple-touch-icon.png",
            "/icon-dark.png",
            "/icon-light.png",
            "/hero.png",
        ].includes(pathname)
    );
}

export const isBetaEnvironment = () =>
    process.env.NEXT_PUBLIC_BETA_ENVIRONMENT === "true";

const FLAG_CACHE_LIMIT = 1024;
const FLAG_ALLOW_TTL_MS = 30_000;
const FLAG_DENY_TTL_MS = 5_000;
const decisions = new Map<string, { allowed: boolean; expiresAt: number }>();
const evaluating = new Map<string, Promise<boolean>>();
let posthog: ReturnType<typeof getPostHogClient> | undefined;

async function evaluateBetaFlag(userId: string): Promise<boolean> {
    try {
        posthog ??= getPostHogClient({ remoteFlagsOnly: true });
        const flags = await posthog.evaluateFlags(userId, { flagKeys: [FLAG_NAME] });
        return flags.getFlag(FLAG_NAME, { sendFeatureFlagEvents: false }) === true;
    } catch {
        return false;
    }
}

/**
 * Access is evaluated server-side against the authenticated Supabase user ID,
 * which is also used by posthog.identify() in the browser.
 * Missing configuration, a false flag or an unavailable PostHog all deny access.
 */
export async function canAccessBeta(userId: string | null): Promise<boolean> {
    if (!isBetaEnvironment()) return true;
    if (
        !userId ||
        !(
            process.env.NEXT_PUBLIC_POSTHOG_KEY ||
            process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN
        )
    ) {
        return false;
    }

    const now = Date.now();
    const cached = decisions.get(userId);
    if (cached && cached.expiresAt > now) return cached.allowed;
    const current = evaluating.get(userId);
    if (current) return current;

    // Bound memory per warm instance. An unavailable remote evaluation is
    // never served a stale allow decision.
    if (evaluating.size >= FLAG_CACHE_LIMIT) return false;
    const evaluation = evaluateBetaFlag(userId).then(allowed => {
        decisions.delete(userId);
        if (decisions.size >= FLAG_CACHE_LIMIT)
            decisions.delete(decisions.keys().next().value!);
        decisions.set(userId, { allowed,
            expiresAt: now + (allowed ? FLAG_ALLOW_TTL_MS : FLAG_DENY_TTL_MS) });
        return allowed;
    }).finally(() => evaluating.delete(userId));
    evaluating.set(userId, evaluation);
    return evaluation;
}
