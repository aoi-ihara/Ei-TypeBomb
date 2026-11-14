import { createServerClient } from "@supabase/ssr";
import type { NextApiRequest } from "next";
import { cookieOptions } from "../../db/cookie-options";

/**
 * MCP authorizes the person signed in to ETB via Supabase Auth.
 * The Next.js proxy validates/refreshes Supabase cookies before Pages API routes.
 * Never accept a cookie's unverified user ID or an MCP JWT as a website session.
 */
export async function getMcpAuthenticatedUser(req: NextApiRequest) {
    try {
        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookieOptions,
                cookies: {
                    getAll: () =>
                        Object.entries(req.cookies ?? {}).flatMap(
                            ([name, value]) =>
                                typeof value === "string"
                                    ? [{ name, value }]
                                    : [],
                        ),
                    // The proxy must persist any refreshed cookies before this
                    // handler. Fail closed if an unexpected second refresh tries
                    // to rotate tokens without a writable response cookie store.
                    setAll: () => {
                        throw new Error(
                            "ETB session refresh must run in proxy",
                        );
                    },
                },
            },
        );
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user || data.user.is_anonymous === true) return null;
        return data.user.id;
    } catch {
        return null;
    }
}
