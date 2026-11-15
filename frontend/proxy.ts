import { createServerClient } from "@supabase/ssr";
import { cookieOptions } from "@/lib/db/cookie-options";
import { NextRequest, NextResponse } from "next/server";

const isPublicFeed = (pathname: string) =>
    pathname === "/" || pathname === "/latest";

// A cookie only selects the dynamic route. The dynamic route always
// authenticates via getUserDetails(); this hint is never an authorization.
const hasSupabaseSessionCookie = (request: NextRequest) =>
    request.cookies
        .getAll()
        .some(({ name }) => /^sb-[a-zA-Z0-9-]+-auth-token(?:\.\d+)?$/.test(name));

/**
 * Serve the anonymous feed from shared ISR while rendering accounts with
 * verified SSR state. Do not put viewer data into public CDN HTML.
 */
export async function proxy(request: NextRequest) {
    const isFeed = isPublicFeed(request.nextUrl.pathname);
    const isSessionCandidate = isFeed && hasSupabaseSessionCookie(request);

    if (isFeed && !isSessionCandidate) {
        return NextResponse.next();
    }

    // Rewrites keep / and /latest in the address bar and as link targets.
    // Never rewrite Server Action POST requests to a different page.
    const rewriteUrl =
        isSessionCandidate && (request.method === "GET" || request.method === "HEAD")
            ? (() => {
                  const url = request.nextUrl.clone();
                  url.pathname =
                      request.nextUrl.pathname === "/"
                          ? "/feed-session"
                          : "/feed-session/latest";
                  return url;
              })()
            : null;

    const nextResponse = () =>
        rewriteUrl
            ? NextResponse.rewrite(rewriteUrl, { request })
            : NextResponse.next({ request });

    let response = nextResponse();
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
                    response = nextResponse();
                    values.forEach(({ name, value, options }) =>
                        response.cookies.set(name, value, options),
                    );
                },
            },
        },
    );
    // Session refresh stays on for authenticated navigation. SSR pages still
    // verify getUser() before returning any personal room information.
    await client.auth.getClaims();
    return response;
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
