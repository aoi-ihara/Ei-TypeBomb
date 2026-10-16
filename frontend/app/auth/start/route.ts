import { randomBytes, createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
    getOAuthConfig,
    isOAuthEnabled,
    OAUTH_AUTHORIZE_URL,
    oauthCookieNames,
    oauthCookieOptions,
    safeReturnPath,
} from "@/lib/auth/oauth-config";

export const dynamic = "force-dynamic";

const base64url = (value: Buffer) => value.toString("base64url");

export async function GET(request: NextRequest) {
    if (!isOAuthEnabled()) {
        return new NextResponse("OAuth is not enabled for this deployment", {
            status: 503,
        });
    }

    let config: ReturnType<typeof getOAuthConfig>;
    try {
        config = getOAuthConfig();
    } catch {
        return new NextResponse("OAuth configuration is incomplete", {
            status: 503,
        });
    }

    const callbackOrigin = new URL(config.redirectUri).origin;
    if (request.nextUrl.origin !== callbackOrigin) {
        const canonical = new URL("/auth/sign-in", callbackOrigin);
        canonical.searchParams.set(
            "next",
            safeReturnPath(request.nextUrl.searchParams.get("next")),
        );
        return NextResponse.redirect(canonical, 302);
    }

    const state = base64url(randomBytes(32));
    const verifier = base64url(randomBytes(48));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const authorize = new URL(OAUTH_AUTHORIZE_URL);
    authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        scope: "openid email profile",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
    }).toString();

    const response = NextResponse.redirect(authorize, 302);
    const names = oauthCookieNames();
    const cookieOptions = { ...oauthCookieOptions, maxAge: 600 };
    response.cookies.set(names.state, state, cookieOptions);
    response.cookies.set(names.verifier, verifier, cookieOptions);
    response.cookies.set(
        names.returnTo,
        safeReturnPath(request.nextUrl.searchParams.get("next")),
        cookieOptions,
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
}
