import { createServerClient } from "@supabase/ssr";
import { cookieOptions } from "@/lib/db/cookie-options";
import { NextRequest, NextResponse } from "next/server";

/** Refresh ETB's local Supabase Auth session before route handlers and pages. */
export async function proxy(request: NextRequest) {
    // The two feed pages contain only public ISR HTML. Their private viewer
    // endpoint still passes through this proxy and refreshes session cookies.
    // Avoid JWT refresh overhead on every public CDN/HTML request.
    if (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "/latest") {
        return NextResponse.next();
    }

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
    await client.auth.getClaims();
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
