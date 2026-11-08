import { createLocalJWKSet, jwtVerify } from "jose";
import {
  createPrivateKey,
  createPublicKey,
  type JsonWebKey,
} from "node:crypto";
import {
  getAuthorizationServerConfig,
  getMcpResource,
  MCP_SCOPE,
} from "./config";
import { OAuthStore } from "./store";

export class InvalidMcpTokenError extends Error {}

export async function verifyMcpToken(token: string) {
  const { issuer, jwks } = getAuthorizationServerConfig();
  const keys = jwks.keys.map(
    (key: JsonWebKey & { kid: string; alg: string }) => ({
      ...createPublicKey(createPrivateKey({ key, format: "jwk" })).export({
        format: "jwk",
      }),
      kid: key.kid,
      alg: key.alg,
      use: "sig",
    }),
  );
  const { payload } = await jwtVerify(token, createLocalJWKSet({ keys }), {
    issuer,
    audience: getMcpResource(),
    algorithms: ["ES256"],
    maxTokenAge: 300,
    clockTolerance: 5,
    typ: "at+jwt",
    requiredClaims: [
      "sub",
      "client_id",
      "grant_id",
      "scope",
      "iat",
      "exp",
      "jti",
    ],
  });
  if (
    payload.aud !== getMcpResource() ||
    payload.cnf !== undefined ||
    typeof payload.sub !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      payload.sub,
    ) ||
    typeof payload.client_id !== "string" ||
    !payload.client_id ||
    typeof payload.grant_id !== "string" ||
    typeof payload.scope !== "string" ||
    !payload.scope.split(" ").includes(MCP_SCOPE)
  ) {
    throw new InvalidMcpTokenError("Invalid MCP access token claims");
  }
  // JWTs are intentionally bound to a live grant: revoke/refresh replay/user
  // disconnect takes effect immediately, without waiting for JWT expiration.
  const grant = await new OAuthStore("Grant").find(payload.grant_id);
  if (
    !grant ||
    grant.accountId !== payload.sub ||
    grant.clientId !== payload.client_id
  ) {
    throw new InvalidMcpTokenError("MCP grant is expired or revoked");
  }
  return {
    userId: payload.sub,
    clientId: payload.client_id,
    grantId: payload.grant_id,
  };
}
