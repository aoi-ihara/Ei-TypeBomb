"use server";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cookieOptions } from "./cookie-options";
import { isOAuthEnabled } from "@/lib/auth/oauth-config";
import { getOAuthAccessToken } from "@/lib/auth/oauth-session";

export const createClient = async (
    cacheOptions?: Pick<RequestInit, "next">,
) => {
    // OAuth credentials live exclusively in host-only HttpOnly cookies.
    // Supabase queries use the validated OAuth JWT for RLS.
    if (isOAuthEnabled()) {
        const accessToken = await getOAuthAccessToken();
        return createSupabaseClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                auth: {
                    persistSession: false,
                    autoRefreshToken: false,
                },
                global: {
                    headers: accessToken
                        ? { Authorization: "Bearer " + accessToken }
                        : {},
                    fetch: (url, options) =>
                        fetch(url, { ...options, ...cacheOptions, cache: "no-store" }),
                },
            },
        );
    }

    const cookieStore = await cookies();
    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions,
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) =>
                            cookieStore.set(name, value, options),
                        );
                    } catch {}
                },
            },
            global: {
                fetch: (url, options) => {
                    return fetch(url, {
                        ...options,
                        ...cacheOptions,
                    });
                },
            },
        },
    );
};

export const createAdminClient = async () => {
    if (typeof window !== "undefined")
        throw new Error("Admin action on client");

    return createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
            auth: {
                autoRefreshToken: false,
                persistSession: false,
            },
        },
    );
};
