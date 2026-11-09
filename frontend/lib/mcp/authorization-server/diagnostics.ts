const SAFE_ERROR_CODES = new Set([
    "SELF_SIGNED_CERT_IN_CHAIN",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "28P01",
    "28000",
    "42501",
    "42P01",
    "3F000",
    "53300",
    "57P01",
    "ENOTFOUND",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "MCP_DATABASE_TLS_REQUIRED",
]);

export function oauthFailureCode(error: unknown): string {
    if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        SAFE_ERROR_CODES.has(error.code)
    )
        return error.code;
    return "operation_failed";
}

/** Static phases only: never include OAuth parameters, database URLs, or exception text. */
export type OAuthFailureStage =
    | "configuration"
    | "request_validation"
    | "identity"
    | "database_connect"
    | "database_begin"
    | "database_lock"
    | "request_processing"
    | "database_commit"
    | "interaction"
    | "rate_limit"
    | "revocation"
    | "provider"
    | "unknown";

export function logOAuthServerFailure(
    error: unknown,
    stage: OAuthFailureStage = "unknown",
): void {
    console.error("[MCP OAuth] request could not be completed", {
        code: oauthFailureCode(error),
        stage,
    });
}

/** Log only a fixed endpoint label and HTTP status, never client secrets,
 * authorization codes, request parameters, tokens or error response bodies. */
export function logOAuthProtocolFailure(
    route: "authorize" | "token" | "register" | "revoke" | "jwks",
    status: number,
): void {
    if (!Number.isInteger(status) || status < 400 || status > 599) return;
    console.warn("[MCP OAuth] endpoint returned an error", { route, status });
}
