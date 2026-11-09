import { createPrivateKey, createPublicKey } from "node:crypto";
import { getEtbBaseUrl, getEtbUrl } from "../../config/base-url";

export const MCP_SCOPE = "etb:rooms";
export const getMcpIssuer = getEtbBaseUrl;
export const getMcpResource = () => getEtbUrl("/api/mcp");

function configurationError(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}

export function getAuthorizationServerConfig() {
    if (process.env.ETB_MCP_OAUTH_ENABLED !== "true") {
        throw configurationError("MCP_OAUTH_DISABLED", "MCP authorization server is disabled");
    }
    if (process.env.NEXT_PUBLIC_ETB_OAUTH_ENABLED !== "true") {
        throw configurationError(
            "MCP_OAUTH_WEB_LOGIN_DISABLED",
            "MCP OAuth requires the existing rcAccount web OAuth login",
        );
    }
    const issuer = getMcpIssuer();
    const databaseUrl = process.env.ETB_MCP_DATABASE_URL;
    const encryptionKey = Buffer.from(
        process.env.ETB_MCP_STORAGE_KEY ?? "",
        "base64url",
    );
    const cookieKeys = (process.env.ETB_MCP_COOKIE_KEYS ?? "").split(",");
    if (
        !databaseUrl ||
        encryptionKey.length !== 32 ||
        cookieKeys.some((k) => k.length < 32)
    ) {
        throw configurationError(
            "MCP_OAUTH_STORAGE_CONFIG_INVALID",
            "MCP OAuth storage/cookie configuration is incomplete",
        );
    }
    const jwks = (() => {
        try {
            return JSON.parse(process.env.ETB_MCP_SIGNING_JWKS ?? "null");
        } catch {
            throw configurationError("MCP_OAUTH_SIGNING_KEYS_INVALID", "Invalid MCP OAuth signing JWKS JSON");
        }
    })();
    if (!jwks || !Array.isArray(jwks.keys) || jwks.keys.length === 0) {
        throw configurationError("MCP_OAUTH_SIGNING_KEYS_INVALID", "MCP OAuth requires persistent signing keys");
    }
    const kids = new Set();
    for (const jwk of jwks.keys) {
        if (
            jwk.kty !== "EC" ||
            jwk.crv !== "P-256" ||
            jwk.alg !== "ES256" ||
            jwk.use !== "sig" ||
            typeof jwk.kid !== "string" ||
            !jwk.kid ||
            kids.has(jwk.kid) ||
            typeof jwk.d !== "string"
        ) {
            throw configurationError("MCP_OAUTH_SIGNING_KEYS_INVALID", "MCP OAuth requires distinct private ES256 signing keys");
        }
        try {
            createPublicKey(createPrivateKey({ key: jwk, format: "jwk" }));
        } catch {
            throw configurationError("MCP_OAUTH_SIGNING_KEYS_INVALID", "Malformed MCP OAuth signing key");
        }
        kids.add(jwk.kid);
    }
    return { issuer, databaseUrl, encryptionKey, cookieKeys, jwks };
}

/** RFC 8414 metadata for the exact, deliberately narrow provider configuration. */
export function getAuthorizationServerMetadata() {
    const { issuer } = getAuthorizationServerConfig();
    return {
        issuer,
        authorization_endpoint: issuer + "/api/oauth/authorize",
        token_endpoint: issuer + "/api/oauth/token",
        registration_endpoint: issuer + "/api/oauth/register",
        revocation_endpoint: issuer + "/api/oauth/revoke",
        jwks_uri: issuer + "/api/oauth/jwks",
        response_types_supported: ["code"],
        response_modes_supported: ["query"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        token_endpoint_auth_methods_supported: [
            "none",
            "client_secret_basic",
            "client_secret_post",
        ],
        revocation_endpoint_auth_methods_supported: [
            "none",
            "client_secret_basic",
            "client_secret_post",
        ],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: [MCP_SCOPE],
    };
}
