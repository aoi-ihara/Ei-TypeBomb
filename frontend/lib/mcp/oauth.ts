import { createRemoteJWKSet, jwtVerify } from "jose";
import {
    OAUTH_ISSUER,
    OAUTH_JWKS_URL,
} from "@/lib/auth/oauth-config";

export const MCP_RESOURCE = "https://ei-typebomb.com/api/mcp";
export const MCP_PROTECTED_RESOURCE_METADATA_URL =
    "https://ei-typebomb.com/.well-known/oauth-protected-resource/api/mcp";

const jwks = createRemoteJWKSet(new URL(OAUTH_JWKS_URL));

export type McpPrincipal = {
    userId: string;
    clientId: string;
};

export async function authenticateMcpRequest(
    request: Request,
): Promise<McpPrincipal | null> {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
    if (!match) return null;

    try {
        const { payload } = await jwtVerify(match[1], jwks, {
            issuer: OAUTH_ISSUER,
            audience: MCP_RESOURCE,
            algorithms: ["ES256", "RS256"],
        });

        if (
            typeof payload.sub !== "string" ||
            typeof payload.client_id !== "string" ||
            !payload.client_id ||
            payload.role !== "authenticated"
        ) {
            return null;
        }

        return {
            userId: payload.sub,
            clientId: payload.client_id,
        };
    } catch {
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
            "Cache-Control": "no-store",
            "WWW-Authenticate":
                `Bearer resource_metadata="${MCP_PROTECTED_RESOURCE_METADATA_URL}"${invalidToken}`,
        },
    });
}
