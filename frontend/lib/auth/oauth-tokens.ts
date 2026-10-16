import { createRemoteJWKSet, jwtVerify } from "jose";
import {
    getOAuthConfig,
    OAUTH_ISSUER,
    OAUTH_JWKS_URL,
    OAUTH_TOKEN_URL,
} from "./oauth-config";

const jwks = createRemoteJWKSet(new URL(OAUTH_JWKS_URL));

export type OAuthTokens = {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    expires_in: number;
};

export async function verifyOAuthAccessToken(token: string) {
    const { clientId } = getOAuthConfig();
    const { payload } = await jwtVerify(token, jwks, {
        issuer: OAUTH_ISSUER,
        audience: "authenticated",
        algorithms: ["ES256", "RS256"],
    });
    if (payload.client_id !== clientId || typeof payload.sub !== "string") {
        throw new Error("OAuth access token is not issued to Ei-TypeBomb");
    }
    return payload;
}

export async function exchangeOAuthToken(
    values: Record<string, string>,
): Promise<OAuthTokens> {
    const { clientId, clientSecret } = getOAuthConfig();
    const response = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        cache: "no-store",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: "Basic " + btoa(clientId + ":" + clientSecret),
        },
        body: new URLSearchParams(values),
    });

    if (!response.ok) {
        throw new Error("Supabase OAuth token exchange failed (" + response.status + ")");
    }
    const tokens: unknown = await response.json();
    if (
        !tokens ||
        typeof tokens !== "object" ||
        !("access_token" in tokens) ||
        typeof tokens.access_token !== "string" ||
        !("token_type" in tokens) ||
        String(tokens.token_type).toLowerCase() !== "bearer" ||
        !("expires_in" in tokens) ||
        typeof tokens.expires_in !== "number" ||
        !Number.isFinite(tokens.expires_in) ||
        tokens.expires_in <= 0 ||
        ("refresh_token" in tokens &&
            typeof tokens.refresh_token !== "string")
    ) {
        throw new Error("Invalid Supabase OAuth token response");
    }
    await verifyOAuthAccessToken(tokens.access_token);
    return tokens as OAuthTokens;
}
