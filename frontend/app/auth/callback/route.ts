import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
    getOAuthConfig,
    isOAuthEnabled,
    oauthCookieNames,
    oauthCookieOptions,
    safeReturnPath,
} from "@/lib/auth/oauth-config";
import { exchangeOAuthToken } from "@/lib/auth/oauth-tokens";

export const dynamic = "force-dynamic";

function matchesState(received: string | null, expected: string | undefined) {
    if (!received || !expected) return false;
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
    if (!isOAuthEnabled())
        return new NextResponse("OAuth is disabled", { status: 503 });

    const names = oauthCookieNames();
    const expectedState = request.cookies.get(names.state)?.value;
    const verifier = request.cookies.get(names.verifier)?.value;
    const returnTo = safeReturnPath(
        request.cookies.get(names.returnTo)?.value ?? null,
    );
    const receivedState = request.nextUrl.searchParams.get("state");
    const code = request.nextUrl.searchParams.get("code");
    const providerError = request.nextUrl.searchParams.get("error");

    // Never follow user-controlled callback URLs, even if OAuth fails.
    let trustedOrigin: URL;
    try {
        trustedOrigin = new URL(getOAuthConfig().redirectUri);
    } catch {
        return new NextResponse("OAuth configuration is incomplete", {
            status: 503,
        });
    }

    const fail = (reason: string) => {
        const destination = new URL("/auth/error", trustedOrigin);
        destination.searchParams.set("reason", reason);
        const response = NextResponse.redirect(destination, 303);
        for (const name of [names.state, names.verifier, names.returnTo]) {
            response.cookies.set(name, "", {
                ...oauthCookieOptions,
                maxAge: 0,
            });
        }
        response.headers.set("Cache-Control", "no-store");
        return response;
    };

    if (!matchesState(receivedState, expectedState) || !verifier) {
        return fail("invalid_state");
    }
    if (providerError) return fail("access_denied");
    if (!code) return fail("invalid_response");

    try {
        const tokens = await exchangeOAuthToken({
            grant_type: "authorization_code",
            code,
            redirect_uri: getOAuthConfig().redirectUri,
            code_verifier: verifier,
        });
        if (!tokens.refresh_token) return fail("invalid_response");

        const response = NextResponse.redirect(
            new URL(returnTo, trustedOrigin),
            303,
        );
        for (const name of [names.state, names.verifier, names.returnTo]) {
            response.cookies.set(name, "", {
                ...oauthCookieOptions,
                maxAge: 0,
            });
        }
        response.cookies.set(names.access, tokens.access_token, {
            ...oauthCookieOptions,
            maxAge: Math.max(1, Math.floor(tokens.expires_in)),
        });
        response.cookies.set(names.refresh, tokens.refresh_token, {
            ...oauthCookieOptions,
            maxAge: 60 * 60 * 24 * 30,
        });
        response.headers.set("Cache-Control", "no-store");
        return response;
    } catch {
        return fail("token_exchange_failed");
    }
}
