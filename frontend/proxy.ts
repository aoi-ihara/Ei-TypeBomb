import { createServerClient } from "@supabase/ssr";
import { cookieOptions } from "@/lib/db/cookie-options";
import { NextRequest, NextResponse } from "next/server";
import { canAccessBeta, isBetaEnvironment, isPublicBetaPath } from "@/lib/beta-access";

// Only the public guest feed is served from shared ISR. Supabase SSR auth
// cookies may be chunked (sb-...-auth-token.0), so match the cookie prefix.
const hasAuthCookie = (request: NextRequest) =>
    request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));

/** Refresh ETB's local Supabase Auth session before route handlers and pages. */
export async function proxy(request: NextRequest) {
    const feed = request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/latest";
    // Guests keep the static ISR path. Cookie-bearing requests use a
    // dynamic, personalized route; even expired cookies cannot enter ISR.
    if (!isBetaEnvironment() && feed && !hasAuthCookie(request)) return NextResponse.next();

    const destination = request.nextUrl.clone();
    if (feed) {
        destination.pathname =
            request.nextUrl.pathname === "/" ? "/viewer-feed-internal" : "/viewer-feed-internal/latest";
    }
    const createResponse = () =>
        feed ? NextResponse.rewrite(destination, { request }) : NextResponse.next({ request });

    let response = createResponse();
    const client = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookieOptions,
            cookies: {
                getAll: () => request.cookies.getAll(),
                setAll(values) {
                    values.forEach(({ name, value }) =>
                        request.cookies.set(name, value),
                    );
                    response = createResponse();
                    values.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    );
                },
            },
        },
    );
    // Verify locally when the project uses asymmetric JWTs; refresh tokens via SSR cookies.
    // Ownership checks and privileged writes still use a fresh getUser() on the server.
    await client.auth.getClaims();

    const pathname = request.nextUrl.pathname;
    // MCP uses Bearer OAuth tokens rather than Supabase browser cookies. Its
    // own route handler checks beta access after verifying the Bearer token.
    if (!isBetaEnvironment() || isPublicBetaPath(pathname) || pathname === "/api/mcp") {
        return response;
    }

    let userId: string | null = null;
    try {
        // A verified user is required; an untrusted cookie or JWT claim alone
        // must not grant access to a beta-only deployment.
        const { data, error } = await client.auth.getUser();
        if (!error) userId = data.user?.id ?? null;
    } catch {
        // Authentication outages must not expose the beta environment.
    }
    if (await canAccessBeta(userId)) return response;

    const headers = { "Cache-Control": "private, no-store, max-age=0" };
    const denied = pathname.startsWith("/api/")
        ? NextResponse.json(
              { error: "Beta tester access required" },
              { status: userId ? 403 : 401, headers },
          )
        : NextResponse.rewrite(
              new URL("/beta-access-denied", request.url),
              { status: 403, headers },
          );
    // Retain any Supabase session refresh/clear cookies produced above.
    response.cookies.getAll().forEach((cookie) => denied.cookies.set(cookie));
    return denied;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
