// Do not log error.message/stack: database driver messages can include
// connection details and OAuth exceptions can include submitted parameters.
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

export function logOAuthServerFailure(error: unknown): void {
  console.error("[MCP OAuth] request could not be completed", {
    code: oauthFailureCode(error),
  });
}
