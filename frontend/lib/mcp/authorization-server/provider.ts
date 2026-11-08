import {
  Provider,
  errors,
  interactionPolicy,
  type Configuration,
} from "oidc-provider";
import {
  getAuthorizationServerConfig,
  getMcpResource,
  MCP_SCOPE,
} from "./config";
import { OAuthStore } from "./store";
import { logOAuthServerFailure } from "./diagnostics";

/** Additional policy on top of the provider's exact redirect matching and
 * standards validation. No remote client metadata/JWKS fetching is permitted. */
export function validateClientMetadata(metadata: Record<string, unknown>) {
  const invalid = () => {
    throw new errors.InvalidClientMetadata("unsupported MCP client metadata");
  };
  if (
    !["none", "client_secret_basic", "client_secret_post"].includes(
      String(metadata.token_endpoint_auth_method),
    ) ||
    !Array.isArray(metadata.grant_types) ||
    !metadata.grant_types.includes("authorization_code") ||
    metadata.grant_types.some(
      (g) => !["authorization_code", "refresh_token"].includes(String(g)),
    ) ||
    JSON.stringify(metadata.response_types) !== '["code"]' ||
    !Array.isArray(metadata.redirect_uris) ||
    metadata.redirect_uris.length < 1 ||
    metadata.redirect_uris.length > 10 ||
    (metadata.scope !== undefined && metadata.scope !== MCP_SCOPE)
  )
    invalid();
  for (const value of metadata.redirect_uris as unknown[]) {
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      /[\s\\*]/.test(value)
    )
      invalid();
    let url: URL;
    try {
      url = new URL(value as string);
    } catch {
      invalid();
      return;
    }
    if (url.username || url.password || url.hash) invalid();
    if (!/^(?:[a-z0-9.-]+|\[[0-9a-f:]+\])$/i.test(url.hostname)) invalid();
    const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.protocol === "http:" &&
      loopback &&
      metadata.application_type === "native"
    )
      continue;
    if (
      url.protocol !== "https:" ||
      loopback ||
      url.hostname === "localhost" ||
      !url.hostname.includes(".") ||
      url.hostname.endsWith(".local")
    )
      invalid();
  }
  for (const key of [
    "jwks",
    "jwks_uri",
    "sector_identifier_uri",
    "request_uris",
    "initiate_login_uri",
    "logo_uri",
  ]) {
    if (metadata[key] !== undefined) invalid();
  }
  if (
    metadata.client_name !== undefined &&
    (typeof metadata.client_name !== "string" ||
      metadata.client_name.length > 120)
  )
    invalid();
  if (metadata.client_uri !== undefined) {
    try {
      const url = new URL(String(metadata.client_uri));
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        invalid();
    } catch {
      invalid();
    }
  }
}

export function createMcpProvider() {
  const config = getAuthorizationServerConfig();
  const policy = interactionPolicy.base();
  policy
    .get("consent")!
    .checks.add(
      new interactionPolicy.Check(
        "explicit_mcp_consent",
        "MCP access requires explicit consent",
        (ctx) => !ctx.oidc.result?.consent,
      ),
    );
  const configuration: Configuration = {
    adapter: OAuthStore,
    clients: [],
    jwks: config.jwks,
    cookies: {
      keys: config.cookieKeys,
      names: {
        session: "etb-mcp-session",
        interaction: "etb-mcp-interaction",
        resume: "etb-mcp-resume",
      },
      short: { secure: true, httpOnly: true, sameSite: "lax", signed: true },
      long: { secure: true, httpOnly: true, sameSite: "lax", signed: true },
    },
    clientDefaults: {
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      response_modes: ["query"],
      id_token_signed_response_alg: "ES256",
    },
    extraClientMetadata: {
      properties: ["etb_policy"],
      validator(_ctx, _key, _value, metadata) {
        validateClientMetadata(metadata);
      },
    },
    responseTypes: ["code"],
    clientAuthMethods: ["none", "client_secret_basic", "client_secret_post"],
    scopes: [],
    pkce: { required: () => true },
    allowOmittingSingleRegisteredRedirectUri: false,
    features: {
      devInteractions: { enabled: false },
      dPoP: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      registration: {
        enabled: true,
        initialAccessToken: false,
        issueRegistrationAccessToken: false,
      },
      registrationManagement: { enabled: false },
      userinfo: { enabled: false },
      revocation: {
        enabled: true,
        allowedPolicy: (_ctx, client, token) =>
          client.clientId === token.clientId,
      },
      resourceIndicators: {
        enabled: true,
        defaultResource() {
          throw new errors.InvalidTarget("MCP resource is required");
        },
        getResourceServerInfo(_ctx, resource) {
          if (resource !== getMcpResource())
            throw new errors.InvalidTarget("unknown MCP resource");
          return {
            scope: MCP_SCOPE,
            audience: resource,
            accessTokenTTL: 300,
            accessTokenFormat: "jwt",
            jwt: { sign: { alg: "ES256", kid: config.jwks.keys[0].kid } },
          };
        },
        useGrantedResource: () => true,
      },
    },
    interactions: {
      policy,
      url: (_ctx, interaction) => `/api/oauth/interaction/${interaction.uid}`,
    },
    findAccount: (_ctx, id) => ({
      accountId: id,
      claims: async () => ({ sub: id }),
    }),
    extraTokenClaims: (_ctx, token) => ({
      grant_id: "grantId" in token ? token.grantId : undefined,
    }),
    issueRefreshToken: (_ctx, client) =>
      client.grantTypeAllowed("refresh_token"),
    rotateRefreshToken: true,
    expiresWithSession: () => false,
    revokeGrantPolicy: () => true,
    ttl: {
      AccessToken: 300,
      AuthorizationCode: 60,
      Interaction: 600,
      Session: 3600,
      Grant: 30 * 86400,
      RefreshToken: 30 * 86400,
    },
    routes: {
      authorization: "/api/oauth/authorize",
      token: "/api/oauth/token",
      registration: "/api/oauth/register",
      revocation: "/api/oauth/revoke",
      jwks: "/api/oauth/jwks",
    },
    renderError(ctx) {
      ctx.type = "text/plain";
      ctx.body =
        "OAuth request could not be completed. Reconnect from your MCP client.";
    },
  };
  const provider = new Provider(config.issuer, configuration);
  provider.proxy = true;
  // Avoid logging OAuth parameters, tokens, or identity claims.
  provider.on("server_error", (_ctx, error) => logOAuthServerFailure(error));
  return provider;
}

let provider: ReturnType<typeof createMcpProvider> | undefined;
export function getMcpProvider() {
  return (provider ??= createMcpProvider());
}
