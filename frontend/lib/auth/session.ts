"use server";

import { cache } from "react";
import { createClient } from "@/lib/db/server";
import { serverError } from "@/lib/server-console";

const currentUser = cache(async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();

    if (error) {
        serverError("failed to get user", error, "AUTH");
        return null;
    }
    return data.user ?? null;
});

export const getSession = async () => {
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

// Only for public/unlisted page presentation. Do not use this lightweight
// JWT check to authorize private data, service-role queries or mutations.
const claimedViewerId = cache(async (): Promise<string | null> => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;
    return typeof data?.claims?.sub === "string" ? data.claims.sub : null;
});

export const getClaimedViewerId = async () => claimedViewerId();

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
