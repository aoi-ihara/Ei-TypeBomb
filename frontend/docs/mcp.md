# Ei-TypeBomb MCP Server

Ei-TypeBomb exposes a remote MCP Streamable HTTP endpoint:

`https://ei-typebomb.com/api/mcp`

The first version exposes room management tools and keeps the existing Ei-TypeBomb
frontend unchanged.

## MCP OAuth authorization server

ETB hosts a dedicated OAuth authorization server on Vercel/Next.js using
[`oidc-provider` 9.13.3](https://github.com/panva/node-oidc-provider/tree/v9.13.3).
The library implements authorization-code exchange, mandatory S256 PKCE,
RFC 7591 dynamic client registration (DCR), exact registered redirect matching,
RFC 8707 resource indicators, refresh rotation/reuse detection, and RFC 7009
refresh-token revocation. ETB supplies the rcAccount login adapter, explicit
consent UI, persistence, resource policy and MCP JWT verification. This is a
restricted OAuth profile, not a general-purpose OIDC login provider.

rcAccount (Supabase Auth) continues to authenticate the user through the existing
web login. `RC_HUB_OAUTH_CLIENT_ID`, `RC_HUB_OAUTH_CLIENT_SECRET`, `/auth/start`,
`/auth/callback`, and the existing shared `/oauth/consent` are unchanged. The new
MCP client IDs are dynamically generated and are independent of the web login
client. No shared Supabase OAuth settings or Custom Access Token Hook changes
are required. Normal rcAccount JWTs are never accepted as MCP access tokens.

For `ETB_BASE_URL=https://ei-typebomb.com`:

| Endpoint | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource/api/mcp` | RFC 9728 resource metadata |
| `/.well-known/oauth-authorization-server` | RFC 8414 authorization server metadata |
| `/api/oauth/register` | DCR for public and confidential clients |
| `/api/oauth/authorize` | Authorization code + S256 PKCE |
| `/api/oauth/interaction/:uid` | rcAccount login and explicit approve/deny |
| `/api/oauth/token` | Code exchange and refresh |
| `/api/oauth/jwks` | Public ES256 signing keys |
| `/api/oauth/revoke` | Refresh-token or access-JWT revocation |
| `/api/oauth/connections` | User's active grants and disconnect controls |

The issuer is the exact canonical ETB origin. The only allowed resource and JWT
`aud` is `${ETB_BASE_URL}/api/mcp`; the scope is `etb:rooms` (create, read, update
only the user's own rooms). Clients must request that resource and scope at
authorization. Refresh may omit `resource` and reuse the original binding, but
cannot change it. The former production-audience exception on beta is removed.
Production and beta tokens cannot be used interchangeably.

Every authorization requires a new explicit decision, even for an already
approved client. Once approved, the server reuses an unexpired grant for the
same authenticated user, registered client ID and MCP resource/scope rather
than creating a new grant on every reconnect. Different client IDs are never
merged based on client display name. The management UI groups historical
duplicate grants by client ID; disconnecting a client revokes all its existing
grants and token chains. Reuse does not extend the original grant lifetime, and
refresh-token reuse detection still revokes its full shared grant. The UI displays the self-reported client name/site, exact
redirect target, ETB resource and logged-in account ID. Names are not verified
brand identities. Signed, secure, HttpOnly interaction cookies, same-origin form
POST validation and user/interaction-bound CSRF tokens protect approval.
Consent and connection-management pages use `Referrer-Policy: strict-origin`:
full interaction URLs are not sent as referrers, and normal same-origin HTTPS
form POSTs retain their Origin header. Do not replace it with `no-referrer`,
which makes browser form submissions send `Origin: null` and fail the strict
Origin check. Null, missing and foreign origins remain rejected.
The user is verified through the existing rcAccount web JWT and Auth `getUser`
endpoint; an anonymous Supabase user cannot approve. Website session refresh
continues to run through the existing Next.js proxy.

Only authorization-code clients using `none`, `client_secret_basic` or
`client_secret_post` are accepted. Confidential client authentication on code
exchange, refresh and revocation is performed by the library. DCR disallows wildcard,
fragment, credential-bearing and insecure remote redirect URIs. Native clients
may use literal loopback HTTP redirects, subject to the provider's RFC 8252
validation. Redirects are subsequently checked by the library. Remote JWKS,
sector identifier, logo and request URI metadata are rejected; ETB does not
fetch registration-supplied URLs. CIMD is not advertised or implemented.

Access JWTs use ES256, `typ=at+jwt`, a 5-minute lifetime, UUID `sub`, dynamic
`client_id`, `grant_id` and scope. MCP verifies their signature against the public
portion of the *same configured JWKS* served at `/api/oauth/jwks`, issuer,
exact single audience, type, required claims, expiry and live grant ownership.
The resource server uses local public keys because issuer and resource are in
the same deployment; it does not perform a self-fetch on every cold start.
JWTs are never sent to Supabase as website sessions. Room ownership filters
remain unchanged.

Grants last at most 30 days. Refresh tokens always rotate; reuse revokes the
entire grant, immediately invalidating its JWTs. Disconnect and revocation also
invalidate the whole grant. `oidc-provider` intentionally does not revoke
structured JWTs through its built-in revocation endpoint; the ETB adapter
verifies its own JWT and creates a short-lived opaque surrogate for the same
grant. The surrogate never leaves the server and is never accepted by MCP. The
library then authenticates the requesting client and revokes the grant through
its native policy. Opaque refresh tokens also use that library revocation logic. Unknown
or invalid tokens receive RFC 7009's HTTP 200; storage failures return 503.

### Rollout hold: inherited dependency advisories (2026-11-08)

Do not enable production MCP OAuth until existing dependency advisories have
been triaged/patched and the resulting dependency set has been re-tested.
`npm audit` currently reports 32 findings (3 critical, 15 high, 14 moderate).
The critical package versions are unchanged from the base branch:
`next@16.3.0`, `proxy-addr@2.0.7`, and `dompurify@3.4.13`. None of the newly
added OAuth packages is listed in that audit. This is a package-level audit,
not a claim that every advisory is exploitable in the deployed ETB application.

Next's maintainer advisories include
[GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) and
[GHSA-673q-mjm6-r5xr](https://github.com/advisories/GHSA-673q-mjm6-r5xr), with
Next 16.4.1 identified as patched for those issues. A framework/dependency
upgrade and application-wide regression review remain separate rollout work.
This PR keeps the new authorization server disabled unless explicitly enabled;
a successful local OAuth test suite must not be treated as clearance to enable
it on a dependency set with unresolved critical advisories.

### Persistence and deployment setup

Use Node.js **22.x** on Vercel. Pages API routes provide the real Node HTTP
streams expected by `oidc-provider`; no custom HTTP server or separate compute
service is required. The module is externalized in `next.config.ts`.

Set these **server-side** environment variables independently for Production
and Preview. Do not use a `NEXT_PUBLIC_` prefix for MCP keys or credentials.

| Variable | Value |
| --- | --- |
| `ETB_BASE_URL` | Exact HTTPS origin, e.g. `https://ei-typebomb.com` or `https://beta.ei-typebomb.com` |
| `ETB_MCP_OAUTH_ENABLED` | `true` after provisioning storage and keys |
| `ETB_MCP_DATABASE_URL` | PostgreSQL connection URL with `sslmode=verify-full`; a dedicated role restricted to the new schema |
| `ETB_MCP_STORAGE_KEY` | 32 random bytes encoded as base64url |
| `ETB_MCP_COOKIE_KEYS` | Comma-separated random signing keys, each at least 32 characters; current key first |
| `ETB_MCP_SIGNING_JWKS` | Private ES256 JWKS JSON; unique `kid`, `alg=ES256`, `use=sig`; current key first |

The existing `NEXT_PUBLIC_ETB_OAUTH_ENABLED=true` web OAuth deployment and its
rcAccount credentials must already work, including the canonical `/auth/callback`
registration. `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` remain
the rcAccount project's values. Keep the existing MCP room API's
`SUPABASE_SERVICE_ROLE_KEY`; it is unrelated to the new database login.
When MCP is disabled or missing required configuration, authorization is 503
and MCP access fails closed. This PR does not enable MCP in a live environment.

Generate keys once per environment and keep the resulting file private:

```sh
cd frontend
npm run generate:mcp-keys -- /secure/path/etb-mcp.env
```

Do not regenerate keys on cold start or on every deployment. Keep keys identical
across all Vercel instances for an environment. During signing-key rotation,
place the new private key first and retain previous keys for at least the
5-minute JWT lifetime. Cookie key rotation can retain previous keys in the list.
Storage key changes require re-encrypting stored artifacts, or revoking/deleting
all of that environment's records and reconnecting clients. Back up keys and
database together.

Apply `supabase/migrations/20261108120000_mcp_oauth_storage.sql` through the
normal database migration process. It creates the private `etb_mcp_oauth` schema
with RLS enabled and no public/anon/authenticated access. It does not modify
`auth.*`, public application tables, token hooks or shared rcAccount grants.
Provision a dedicated PostgreSQL LOGIN role with a secret managed outside git,
then substitute its identifier in this administrative SQL:

```sql
-- Run as the schema owner; etb_mcp_login is an example role name.
grant usage on schema etb_mcp_oauth to etb_mcp_login;
grant select, insert, update, delete on all tables in schema etb_mcp_oauth to etb_mcp_login;
create policy mcp_server on etb_mcp_oauth.models to etb_mcp_login
    using (true) with check (true);
create policy mcp_server on etb_mcp_oauth.rate_limits to etb_mcp_login
    using (true) with check (true);
```

Never expose this schema through the Supabase Data API. Remote connections must
verify TLS certificates. Supabase cloud pooler/direct hosts automatically use the
public Supabase Root 2021 CA bundled from the authenticated dashboard download.
`sslmode=verify-full` remains required; Node verifies both the chain and hostname.
No extra certificate environment variable or Vercel filesystem path is needed.
Other providers keep the system CA store; an explicit `sslrootcert` path is also
supported. Conflicting TLS options are rejected. Both direct connections and Supabase transaction
pooling are supported: OAuth mutations run in a transaction with a per-issuer
PostgreSQL advisory transaction lock. HTTP responses are released only after
commit. This deliberately serializes authorization mutations per environment
for correctness at ETB's current scale. MCP JWT verification performs unlocked
live-grant reads. Authorization service/database outages deny access.

Artifacts are AES-256-GCM encrypted with model/ID-bound associated data; IDs,
account IDs and grant indexes are SHA-256 digests. Records are partitioned by
canonical issuer so preview cannot read production grants even if storage is
shared. DCR registrations have a 90-day server-side TTL. Clients must re-register
if their registration expires. Maintain storage with a scheduled administrative
cleanup (expired records are always ignored even before cleanup):

```sql
delete from etb_mcp_oauth.models where expires_at < now();
delete from etb_mcp_oauth.rate_limits where window_start < now() - interval '1 day';
```

The database enforces deployment-wide caps of 30 registrations and 600 OAuth
endpoint requests per minute (429 + Retry-After). Add Vercel Firewall per-IP
limits for public registration/authorization/token routes to protect availability
under abuse; the application never trusts a caller-supplied forwarding IP for
security decisions. These caps may need tuning as usage grows.

Do not enable this on arbitrary preview aliases: use the stable configured
canonical preview domain and matching environment secrets. Requests on a
noncanonical Host receive 421. Existing rcAccount-issued MCP tokens must be
replaced by reconnecting clients after cutover. The legacy shared fixed-client
hook can be retired separately after checking its other consumers; ETB no longer
uses it. There is no fixed MCP Client ID allowlist or rcAccount token fallback.

### Verification and client setup

The MCP client needs only `https://ei-typebomb.com/api/mcp` (or the preview URL).
It discovers ETB metadata, dynamically registers, opens rcAccount login/ETB
consent and obtains its own tokens. Do not paste a website token into the client.

```sh
cd frontend
npm run check:mcp-oauth -- https://beta.ei-typebomb.com/api/mcp
npm run test:mcp-oauth
# Must target a disposable local database: this test drops its private schema.
ETB_MCP_TEST_DATABASE_URL=postgresql://localhost/etb_mcp_oauth_test npm run test:mcp-server
```

The integration suite uses real PostgreSQL and HTTP, with a test-only injected
identity adapter (not a production login bypass). It covers registration,
invalid metadata/redirects, PKCE, explicit consent, CSRF, denial, code replay,
concurrent redemption, JWT claims and MCP acceptance, refresh/reuse revocation,
JWT/refresh revocation, confidential client authentication, user-owned disconnect,
host validation, commit failures and rate limits.
It does not log into a live rcAccount or prove actual ChatGPT/Claude UI behavior.
The discovery diagnostic also does not prove issued-token audience binding.

Consent uses `Referrer-Policy: strict-origin` so browser form submissions retain
their genuine same-origin `Origin` header. Its CSP `form-action` allows only
`'self'` and the requested, registered redirect URI's origin: Chromium enforces
this policy on the entire POST redirect chain, including the final client
callback. The provider still requires the exact registered redirect URI. Paths
and queries never enter CSP; unsupported host characters are rejected. Other
pages, including connection management, keep `form-action 'self'`.

For a real-browser regression check, create a separate disposable local database
named `etb_mcp_oauth_browser_test`, then run:

```sh
npm exec -- node --import tsx test/fixtures/mcp-browser-flow.mts
```

Open the printed `start` URL in Chrome. Approve and confirm the success page
(callback, PKCE code exchange and MCP JWT verification), then open `start` again
and deny. The printed `status` URL exposes only aggregate outcome counters.
The fixture resets only its private schema in that exact local database, uses
ephemeral keys and a simulated rcAccount user, and never accesses live accounts.
Two loopback origins model the issuer and client; a test-only TLS-offload shim
maps those to canonical HTTPS origins inside the real production handler.
Cookies, redirect paths, CSP and form submissions remain browser-enforced.

Before enabling production, complete a fresh ChatGPT and Claude connection on
the canonical preview domain with the real rcAccount account, confirm approve
and deny, `initialize`/`tools/list`, refresh and disconnect. Confirm a normal web
login and other rcAccount services still work. Treat this deployment check as
required; local fixtures are not evidence of live interoperability. Inspect the
consent/connection-management screens visually as well.

The earlier [PR #504](https://github.com/aoi-ihara/Ei-TypeBomb/pull/504) documented
that DCR alone could not fix Supabase's resource audience issuance. This design
resolves that dependency by issuing MCP tokens in ETB while preserving rcAccount
as the user's login provider.

## Tools

- `create_room`: creates a normal Ei-TypeBomb room owned by the authenticated user.
- `get_room`: reads an owned room by its ID or share link.
- `update_room`: updates the supplied settings of an owned room.

All reads and writes are scoped to the OAuth token's `sub` claim. The
service-role client is only used after JWT validation, and room queries include
the authenticated user's `user_id`. Password hashes are never returned.
Public and unlisted rooms have their password cleared, matching the existing
room update behavior.

## Protocol

The endpoint implements stateless Streamable HTTP JSON-RPC for
`initialize`, `ping`, `tools/list`, and `tools/call`. It does not issue MCP
session IDs or provide server-initiated SSE streams. GET and DELETE requests
are authenticated and then return 405 because this implementation uses
request/response JSON over POST. Request bodies are limited to 32 KiB.

## Verification

Check the public metadata document:

```bash
curl -i https://ei-typebomb.com/.well-known/oauth-protected-resource/api/mcp
```

An unauthenticated MCP request should return `401 Unauthorized` and a
`WWW-Authenticate` header containing the metadata URL. A token issued for
the normal Ei-TypeBomb website audience should also be rejected; only a token issued
for the MCP resource is accepted.

### Diagnosing OAuth registration failures

If discovery returns 200 but `/api/oauth/register` or `/api/oauth/jwks` returns
503, inspect Vercel runtime logs for the sanitized `code` field. For example:

- `SELF_SIGNED_CERT_IN_CHAIN`: check the deployed Supabase root CA / TLS configuration.
- `28P01`: verify the dedicated database role's password and pooler username.
- `42501`: verify schema/table grants and RLS policies for the dedicated role.
- `42P01` / `3F000`: apply the dedicated OAuth storage migration.

Database URLs, passwords, OAuth parameters, exception messages and stacks are
never included in these logs. A successful metadata response validates keys and
configuration, but does not prove database connectivity or client registration.
