import { createServerClient } from "@supabase/ssr";
import { cookieOptions } from "@/lib/db/cookie-options";
import { NextRequest, NextResponse } from "next/server";

/** Refresh ETB's local Supabase Auth session before route handlers and pages. */
export async function proxy(request: NextRequest) {
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
    await client.auth.getUser();
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
