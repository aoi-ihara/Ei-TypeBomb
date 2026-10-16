"use server";

import { createClient } from "@/lib/db/server";
import { isOAuthEnabled } from "@/lib/auth/oauth-config";
import { getOAuthAccessToken } from "@/lib/auth/oauth-session";
import { serverError } from "@/lib/server-console";

async function currentUser() {
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
}

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
