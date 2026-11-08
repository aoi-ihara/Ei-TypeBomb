import { getEtbUrl } from "@/lib/config/base-url";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
    OAUTH_ISSUER,
    OAUTH_JWKS_URL,
} from "@/lib/auth/oauth-config";

export const getMcpResource = () => getEtbUrl("/api/mcp");

/**
 * Supabase OAuth currently issues the production MCP audience for the
 * registered MCP client, even when it connects to the Preview endpoint.
 *
 * Allow that audience only on the dedicated beta origin. Production continues
 * to accept its own resource audience exclusively; ordinary Supabase website
 * tokens ("authenticated") remain invalid for both environments.
 *
 * TODO: Remove this compatibility exception once Supabase OAuth can issue a
 * resource-bound token for each MCP endpoint independently.
 */
export function getAcceptedMcpAudiences(): string[] {
    const resource = getMcpResource();
    if (new URL(resource).origin === "https://beta.ei-typebomb.com") {
        return [resource, "https://ei-typebomb.com/api/mcp"];
    }
    return [resource];
}
export const MCP_AUTHORIZATION_SERVER = OAUTH_ISSUER;
export const getMcpMetadataUrl = () =>
    getEtbUrl("/.well-known/oauth-protected-resource/api/mcp");

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
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);

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
            audience: getAcceptedMcpAudiences(),
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
    const hasBearer = /^Bearer\s+\S+$/i.test(
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
                `Bearer resource_metadata="${getMcpMetadataUrl()}"${invalidToken}`,
        },
    });
}
