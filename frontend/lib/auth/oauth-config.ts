/**
 * RC Hub is the OIDC provider. Keep OAuth credentials on the server.
 * The explicit feature flag permits deploying this safely before DNS cutover.
 */
export const isOAuthEnabled = () =>
    process.env.NEXT_PUBLIC_ETB_OAUTH_ENABLED === "true";

export const OAUTH_ISSUER = "https://gkiniypvnwqhmgviwxws.supabase.co/auth/v1";
export const OAUTH_AUTHORIZE_URL = OAUTH_ISSUER + "/oauth/authorize";
export const OAUTH_TOKEN_URL = OAUTH_ISSUER + "/oauth/token";
export const OAUTH_JWKS_URL = OAUTH_ISSUER + "/.well-known/jwks.json";

export function getOAuthConfig() {
    const clientId = process.env.RC_HUB_OAUTH_CLIENT_ID;
    const clientSecret = process.env.RC_HUB_OAUTH_CLIENT_SECRET;
    const redirectUri = process.env.ETB_OAUTH_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri) {
        throw new Error("ETB OAuth configuration is incomplete");
    }
    const url = new URL(redirectUri);
    if (
        url.pathname !== "/auth/callback" ||
        url.search ||
        url.hash ||
        (url.protocol !== "https:" &&
            !(
                process.env.NODE_ENV !== "production" &&
                url.protocol === "http:" &&
                url.hostname === "localhost"
            ))
    ) {
        throw new Error(
            "ETB_OAUTH_REDIRECT_URI must be a trusted /auth/callback URL",
        );
    }
    if (
        process.env.NEXT_PUBLIC_SUPABASE_URL !==
        "https://gkiniypvnwqhmgviwxws.supabase.co"
    ) {
        throw new Error(
            "ETB must use the same rcAccount Supabase project for OAuth and data",
        );
    }
    return { clientId, clientSecret, redirectUri };
}

export function oauthCookieNames() {
    const prefix = process.env.NODE_ENV === "production" ? "__Host-" : "";
    return {
        access: prefix + "etb-oauth-access",
        refresh: prefix + "etb-oauth-refresh",
        state: prefix + "etb-oauth-state",
        verifier: prefix + "etb-oauth-verifier",
        returnTo: prefix + "etb-oauth-return",
    };
}

export const oauthCookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
};

export function safeReturnPath(value: string | null): string {
    if (
        !value ||
        !value.startsWith("/") ||
        value.startsWith("//") ||
        value.includes("\\") ||
        /[\u0000-\u001f\u007f]/.test(value)
    )
        return "/";
    return value;
}
