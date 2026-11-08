import { getEtbUrl } from "@/lib/config/base-url";
import { getMcpResource, getMcpIssuer } from "./authorization-server/config";
import { verifyMcpToken } from "./authorization-server/verify";
export { getMcpResource, getMcpIssuer };
export const getMcpMetadataUrl = () =>
    getEtbUrl("/.well-known/oauth-protected-resource/api/mcp");

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
        return await verifyMcpToken(match[1]);
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
