import { createServerClient } from "@supabase/ssr";
import { BETA_ACTION_DENIED } from "@/lib/auth/beta-action";
import { cookieOptions } from "@/lib/db/cookie-options";
import { NextRequest, NextResponse } from "next/server";
import { canAccessBeta, isBetaEnvironment, isPublicBetaPath } from "@/lib/beta-access";

// Only the public guest feed is served from shared ISR. Supabase SSR auth
// cookies may be chunked (sb-...-auth-token.0), so match the cookie prefix.
const hasAuthCookie = (request: NextRequest) =>
    request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));

/** Refresh ETB's local Supabase Auth session before route handlers and pages. */
export async function proxy(request: NextRequest) {
    const pathname = request.nextUrl.pathname;
    const feed = pathname === "/" || pathname === "/latest";
    const hasSession = hasAuthCookie(request);
    // MCP verifies its Bearer token and applies beta policy in the handler.
    const betaProtected = isBetaEnvironment() && !isPublicBetaPath(pathname) && pathname !== "/api/mcp";
    // Guests keep the shared ISR feed, while protected beta routes still
    // return the same denial as a signed-in visitor without access.
    if (!hasSession && !betaProtected) return NextResponse.next();

    const destination = request.nextUrl.clone();
    if (feed) {
        destination.pathname =
            request.nextUrl.pathname === "/" ? "/viewer-feed-internal" : "/viewer-feed-internal/latest";
    }
    const createResponse = () =>
        feed ? NextResponse.rewrite(destination, { request }) : NextResponse.next({ request });

    let response = createResponse();
    let userId: string | null = null;
    if (hasSession) {
        const refreshHeaders: Record<string, string> = {};
        const client = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookieOptions,
                cookies: {
                    getAll: () => request.cookies.getAll(),
                    setAll(values, headers) {
                        values.forEach(({ name, value }) => request.cookies.set(name, value));
                        const refreshed = createResponse();
                        response.cookies.getAll().forEach(cookie => refreshed.cookies.set(cookie));
                        values.forEach(({ name, value, options }) => refreshed.cookies.set(name, value, options));
                        Object.assign(refreshHeaders, headers);
                        Object.entries(refreshHeaders).forEach(([name, value]) => refreshed.headers.set(name, value));
                        response = refreshed;
                    },
                },
            },
        );
        if (!betaProtected) {
            // Verify/refresh SSR sessions even on navigations to public pages.
            await client.auth.getClaims();
            return response;
        }

        try {
            // getUser verifies the user and refreshes SSR cookies as needed.
            const { data, error } = await client.auth.getUser();
            if (!error) userId = data.user?.id ?? null;
        } catch {
            // Auth outages leave the protected beta routes closed.
        }
    }
    if (userId && await canAccessBeta(userId)) return response;

    const headers = { "Cache-Control": "private, no-store, max-age=0" };
    const status = userId ? 403 : 401;
    let denied: NextResponse;
    if (request.method === "POST" && request.headers.has("next-action")) {
        denied = new NextResponse(BETA_ACTION_DENIED, {
            status,
            headers: { ...headers, "Content-Type": "text/plain" },
        });
    } else if (pathname.startsWith("/api/")) {
        denied = NextResponse.json({ error: BETA_ACTION_DENIED }, { status, headers });
    } else {
        denied = NextResponse.rewrite(new URL("/beta-access-denied", request.url), {
            status: 403, headers,
        });
    }
    // Retain any Supabase session refresh/clear cookies produced above.
    response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
    return denied;
}

export const config = {
    // Exclude the collector rewrite and known assets. Keep application pages,
    // APIs and their prefetch requests covered by the same beta policy.
    matcher: [
        "/((?!_next/(?:static|image)(?:/|$)|ingest(?:/|$)|(?:favicon(?:-dark)?\\.ico|apple-touch-icon\\.png|icon-(?:dark|light)\\.png|hero\\.png|Blip_select_(?:8|36)\\.wav|Explosion_7\\.wav|MT-RD_17_for_Loop\\.wav|Powerup_1\\.wav)$).*)",
    ],
};
