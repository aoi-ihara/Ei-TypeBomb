import { createServerClient } from "@supabase/ssr";
import { cookieOptions } from "@/lib/db/cookie-options";
import { NextRequest, NextResponse } from "next/server";

// Only the public guest feed is served from shared ISR. Supabase SSR auth
// cookies may be chunked (sb-...-auth-token.0), so match the cookie prefix.
const hasAuthCookie = (request: NextRequest) =>
    request.cookies.getAll().some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));

/** Refresh ETB's local Supabase Auth session before route handlers and pages. */
export async function proxy(request: NextRequest) {
    const feed = request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/latest";
    // Guests keep the static ISR path. Cookie-bearing requests use a
    // dynamic, personalized route; even expired cookies cannot enter ISR.
    if (feed && !hasAuthCookie(request)) return NextResponse.next();

    const destination = request.nextUrl.clone();
    if (feed) {
        destination.pathname =
            request.nextUrl.pathname === "/" ? "/_viewer-feed" : "/_viewer-feed/latest";
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
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
