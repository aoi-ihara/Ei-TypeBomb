import { createServerClient } from "@supabase/ssr";
import { cookieOptions } from "@/lib/db/cookie-options";
import { NextRequest, NextResponse } from "next/server";

/** Refresh ETB's local Supabase Auth session before route handlers and pages. */
export async function proxy(request: NextRequest) {
    const feedView =
        request.nextUrl.pathname === "/"
            ? "recommended"
            : request.nextUrl.pathname === "/latest"
              ? "latest"
              : null;

    // Only Supabase auth cookies warrant an authenticated feed lookup.
    // Public visitors continue straight to the shared ISR HTML.
    const hasAuthCookie =
        feedView !== null &&
        request.cookies
            .getAll()
            .some(({ name }) => /^sb-.+-auth-token(?:\.\d+)?$/.test(name));
    if (feedView && !hasAuthCookie) return NextResponse.next();

    let response = NextResponse.next();
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
                    response = NextResponse.next({ request });
                    values.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    );
                },
            },
        },
    );
    // Verify locally when the project uses asymmetric JWTs; refresh tokens via SSR cookies.
    // Ownership checks and privileged writes still use a fresh getUser() on the server.
    const { data: claims, error } = await client.auth.getClaims();

    // This is only a routing hint: SSR reads currentUser through getUser().
    // A stale/invalid cookie must never grant access or make guest HTML private.
    if (feedView && !error && typeof claims?.claims?.sub === "string") {
        const destination = request.nextUrl.clone();
        destination.pathname = "/feed-ssr/" + feedView;
        const rewritten = NextResponse.rewrite(destination, { request });
        // Supabase may have rotated the session cookies above.
        response.cookies.getAll().forEach(({ name, value, ...options }) => {
            rewritten.cookies.set(name, value, options);
        });
        rewritten.headers.set("Cache-Control", "private, no-store, max-age=0");
        return rewritten;
    }
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
