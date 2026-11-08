import { createRemoteJWKSet, jwtVerify } from "jose";
import {
    OAUTH_ISSUER,
    OAUTH_JWKS_URL,
} from "@/lib/auth/oauth-config";

export const MCP_RESOURCE = "https://ei-typebomb.com/api/mcp";
export const MCP_AUTHORIZATION_SERVER = OAUTH_ISSUER;
export const MCP_PROTECTED_RESOURCE_METADATA_URL =
    "https://ei-typebomb.com/.well-known/oauth-protected-resource/api/mcp";

const jwks = createRemoteJWKSet(new URL(OAUTH_JWKS_URL));

export type McpPrincipal = {
    userId: string;
    clientId: string;
};

function logMcpAuthFailure(
    reason: string,
    details?: Record<string, string | boolean>,
): void {
    // Never include the Authorization header, JWT, or decoded claim values.
    console.warn("[MCP Auth] Authentication failed", {
        reason,
        ...details,
    });
}

export async function authenticateMcpRequest(
    request: Request,
): Promise<McpPrincipal | null> {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\\s+([^\\s]+)$/i);

    if (!authorization) {
        logMcpAuthFailure("missing_bearer_token");
        return null;
    }

    if (!match) {
        logMcpAuthFailure("malformed_authorization_header");
        return null;
    }

    try {
        const { payload } = await jwtVerify(match[1], jwks, {
            issuer: OAUTH_ISSUER,
            audience: MCP_RESOURCE,
            algorithms: ["ES256", "RS256"],
        });

        const hasSubject = typeof payload.sub === "string";
        const hasClientId =
            typeof payload.client_id === "string" && payload.client_id.length > 0;
        const hasAuthenticatedRole = payload.role === "authenticated";

        if (!hasSubject || !hasClientId || !hasAuthenticatedRole) {
            logMcpAuthFailure("required_claim_validation_failed", {
                hasSubject,
                hasClientId,
                hasAuthenticatedRole,
            });
            return null;
        }

        return {
            userId: payload.sub as string,
            clientId: payload.client_id as string,
        };
    } catch (error) {
        const errorCode =
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            typeof error.code === "string"
                ? error.code
                : "unknown";
        const failedClaim =
            typeof error === "object" &&
            error !== null &&
            "claim" in error &&
            typeof error.claim === "string"
                ? error.claim
                : "unknown";

        logMcpAuthFailure("jwt_verification_failed", {
            errorCode,
            failedClaim,
        });
        return null;
    }
}

export function unauthorizedMcpResponse(request: Request): Response {
    const hasBearer = /^Bearer\\s+\\S+$/i.test(
        request.headers.get("authorization") ?? "",
    );
    const invalidToken = hasBearer ? ', error="invalid_token"' : "";

    return new Response(null, {
        status: 401,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Expose-Headers": "WWW-Authenticate",
            "Cache-Control": "no-store",
            "WWW-Authenticate":
                `Bearer resource_metadata="${MCP_PROTECTED_RESOURCE_METADATA_URL}"${invalidToken}`,
        },
    });
}
