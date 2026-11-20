import posthog from "posthog-js";

export type PostHogIdentityUser = {
    id: string;
    email: string | null;
    displayName: string | null;
};

/**
 * Keep the immutable Supabase user ID as PostHog's distinct_id.
 * Email and name are mutable person properties, not event properties.
 */
export function identifyPostHogUser(user: PostHogIdentityUser): void {
    if (!user.id) return;

    // Never merge separate signed-in accounts on a shared browser.
    const previousId = posthog.get_property("$user_id");
    if (typeof previousId === "string" && previousId !== user.id) {
        posthog.reset();
    }

    const properties: Record<string, string> = {};
    if (user.email) {
        // "email" is used by PostHog's person UI; keep "$email" in sync too.
        properties.email = user.email;
        properties.$email = user.email;
    }
    if (user.displayName) properties.name = user.displayName;

    // Always pass the current properties; identify can update an existing person.
    posthog.identify(user.id, properties);
}
