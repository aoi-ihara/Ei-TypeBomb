import "server-only";

import type { createClient } from "@/lib/db/server";

// Reuse the authenticated client for the following RLS-protected query.
export async function getMemoryAuthStatus(supabase: Awaited<ReturnType<typeof createClient>>): Promise<{
    userId: string | null;
    error: { message: string; retryable: boolean } | null;
}> {
    try {
        const { data, error } = await supabase.auth.getUser();
        if (error?.name === "AuthSessionMissingError") return { userId: null, error: null };
        if (error || !data.user) {
            return {
                userId: null,
                error: {
                    message: error?.message ?? "Could not verify authenticated user",
                    retryable: !error?.status || error.status === 429 || error.status >= 500,
                },
            };
        }
        return { userId: data.user.id, error: null };
    } catch {
        return {
            userId: null,
            error: { message: "Authentication is temporarily unavailable", retryable: true },
        };
    }
}
