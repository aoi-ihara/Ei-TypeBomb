"use server";

import { cache } from "react";
import { createClient } from "@/lib/db/server";
import { isOAuthEnabled, oauthCookieNames } from "@/lib/auth/oauth-config";
import { cookies } from "next/headers";
import { getOAuthAccessToken } from "@/lib/auth/oauth-session";
import { serverError } from "@/lib/server-console";

const currentUser = cache(async () => {
    const supabase = await createClient();
    const token = isOAuthEnabled() ? await getOAuthAccessToken() : null;

    // OAuth refresh is handled by proxy.ts, not supabase-js.
    if (isOAuthEnabled() && !token) return null;

    const { data, error } = await (token
        ? supabase.auth.getUser(token)
        : supabase.auth.getUser());

    if (error) {
        serverError("failed to get user", error, "AUTH");
        return null;
    }
    return data.user ?? null;
});

export const getSession = async () => {
    if (isOAuthEnabled()) {
        return (await currentUser())?.id ?? null;
    }
    const supabase = await createClient({
        next: { tags: ["current-session"] },
    });
    const { data, error } = await supabase.auth.getSession();
    if (error) {
        serverError("failed to get session", error, "AUTH");
        return;
    }
    if (!data.session?.user) return null;
    return data.session.user.id;
};

export const getUser = async () => (await currentUser())?.id ?? null;

export const getUserDetails = async () => {
    const user = await currentUser();
    if (!user) return null;
    return {
        id: user.id,
        email: user.email ?? null,
        displayName:
            user.user_metadata?.display_name ??
            user.user_metadata?.full_name ??
            user.user_metadata?.name ??
            null,
    };
};

/**
 * Memory persistence needs three outcomes, not just a nullable user ID.
 * A temporary Auth outage must never silently turn a signed-in player into
 * a guest and switch their learning history to local-only storage.
 */
export const getMemoryAuthStatus = async (): Promise<{
    userId: string | null;
    error: { message: string } | null;
}> => {
    try {
        const supabase = await createClient();
        if (isOAuthEnabled()) {
            const store = await cookies();
            const names = oauthCookieNames();
            const hasCredentials = Boolean(
                store.get(names.access)?.value ||
                store.get(names.refresh)?.value,
            );
            if (!hasCredentials) return { userId: null, error: null };

            const token = await getOAuthAccessToken();
            if (!token) {
                return {
                    userId: null,
                    error: { message: "OAuth session could not be verified" },
                };
            }
            const { data, error } = await supabase.auth.getUser(token);
            if (error || !data.user) {
                return {
                    userId: null,
                    error: {
                        message:
                            error?.message ??
                            "Could not verify authenticated user",
                    },
                };
            }
            return { userId: data.user.id, error: null };
        }

        const { data: session, error: sessionError } =
            await supabase.auth.getSession();
        if (sessionError) {
            return { userId: null, error: { message: sessionError.message } };
        }
        if (!session.session) return { userId: null, error: null };

        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) {
            return {
                userId: null,
                error: {
                    message:
                        error?.message ?? "Could not verify authenticated user",
                },
            };
        }
        return { userId: data.user.id, error: null };
    } catch {
        return {
            userId: null,
            error: { message: "Authentication is temporarily unavailable" },
        };
    }
};
