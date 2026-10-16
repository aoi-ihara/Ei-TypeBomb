import { NextRequest, NextResponse } from "next/server";
import {
    isOAuthEnabled,
    oauthCookieNames,
    oauthCookieOptions,
} from "@/lib/auth/oauth-config";
import { exchangeOAuthToken, verifyOAuthAccessToken } from "@/lib/auth/oauth-tokens";

/**
 * Refresh the app-specific OAuth session before Server Components / Actions
 * execute. Propagate rotated tokens to both the current request and browser.
 */
export async function proxy(request: NextRequest) {
    if (!isOAuthEnabled()) return NextResponse.next();

    const names = oauthCookieNames();
    const access = request.cookies.get(names.access)?.value;
    const refresh = request.cookies.get(names.refresh)?.value;
    if (!refresh) return NextResponse.next();

    let shouldRefresh = true;
    if (access) {
        try {
            const claims = await verifyOAuthAccessToken(access);
            shouldRefresh = !claims.exp || claims.exp <= Math.floor(Date.now() / 1000) + 60;
        } catch {
            shouldRefresh = true;
        }
    }
    if (!shouldRefresh) return NextResponse.next();

    try {
        const tokens = await exchangeOAuthToken({
            grant_type: "refresh_token",
            refresh_token: refresh,
        });
        request.cookies.set(names.access, tokens.access_token);
        if (tokens.refresh_token) {
            request.cookies.set(names.refresh, tokens.refresh_token);
        }

        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("cookie", request.cookies.toString());
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        response.cookies.set(names.access, tokens.access_token, {
            ...oauthCookieOptions,
            maxAge: Math.max(1, Math.floor(tokens.expires_in)),
        });
        if (tokens.refresh_token) {
            response.cookies.set(names.refresh, tokens.refresh_token, {
                ...oauthCookieOptions,
                maxAge: 60 * 60 * 24 * 30,
            });
        }
        return response;
    } catch {
        const response = NextResponse.next();
        response.cookies.set(names.access, "", { ...oauthCookieOptions, maxAge: 0 });
        response.cookies.set(names.refresh, "", { ...oauthCookieOptions, maxAge: 0 });
        return response;
    }
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico|auth/login|auth/callback).*)"],
};
