# Ei-TypeBomb MCP Server

Ei-TypeBomb exposes a remote MCP Streamable HTTP endpoint:

`https://ei-typebomb.com/api/mcp`

The first version exposes room management tools and keeps the existing Ei-TypeBomb
frontend unchanged.

## OAuth 2.1 authentication

The MCP endpoint uses the existing Supabase Auth project as its OAuth
authorization server:

- Authorization server: `https://gkiniypvnwqhmgviwxws.supabase.co/auth/v1`
- MCP resource / expected JWT audience:
  `https://ei-typebomb.com/api/mcp`
- Protected Resource Metadata:
  `https://ei-typebomb.com/.well-known/oauth-protected-resource/api/mcp`

MCP clients discover the authorization server from the Protected Resource
Metadata and use the OAuth 2.1 Authorization Code + PKCE flow. The client must
send the MCP endpoint URL as the OAuth `resource` parameter in the authorization
and token requests. Supabase Auth supports the resource indicator for MCP
clients.

The server validates each Bearer token using the Supabase project's public
JWKS. It checks the signature, issuer, expiry, asymmetric signing algorithm,
authenticated role, subject, OAuth client ID, and the exact MCP resource
audience. Tokens issued for the normal Ei-TypeBomb website login have the regular
`authenticated` audience and are intentionally rejected by the MCP endpoint.
The website's existing sign-in flow is not changed.

Every MCP request, including `initialize`, `tools/list`, and notifications,
requires a valid MCP access token. Missing or invalid tokens receive HTTP 401
with a `WWW-Authenticate` challenge that points to the Protected Resource
Metadata endpoint.

### Supabase Auth configuration

The authorization server is the existing shared `rcAccount` Supabase project.
No Supabase dashboard settings or global authorization paths are changed by
this repository PR.

Before connecting an MCP client, verify the following in that project's
Authentication settings:

1. OAuth 2.1 Server is enabled.
2. **Dynamic Client Registration (DCR)** is enabled for clients that register
   themselves. Verify that the authorization server advertises a
   `registration_endpoint` in discovery metadata. If it does not, ChatGPT may
   ask the user for a Client ID.
   Supabase Auth is the authorization server, so adding metadata to the ETB MCP
   resource endpoint cannot enable DCR or CIMD on its behalf.
   Alternatively, register a compatible OAuth client manually.
3. The project's JWT signing keys use ES256 or RS256 and the public JWKS endpoint
   is reachable.
4. The configured authorization path is reachable and requires the user to
   approve or deny each client grant.
5. The consent UI clearly displays the requesting client's registered name,
   website, and redirect URI.

Supabase's built-in OAuth scopes (`openid`, `email`, `profile`, and `phone`)
describe identity claims; they are not Ei-TypeBomb room permissions. The MCP resource
indicator binds the access token to Ei-TypeBomb, while the user's explicit OAuth grant
authorizes the client.

**Consent UI limitation:** Supabase's `getAuthorizationDetails()` response
exposes the OAuth client's name, website URI, redirect URI, and requested
identity scopes, but does not expose the MCP resource indicator or a separate
list of MCP tool permissions. The consent page therefore must not claim that
these scopes describe room access. It displays the client identity and
redirect target and warns users to approve only clients they recognize and
trust. Configure OAuth client names and website URIs so users can identify the
application. Do not rely on OAuth scopes as a description of MCP capabilities.

**Important:** `rcAccount` is shared with the existing Ei-TypeBomb website login and
other OAuth clients. Do not change its global authorization path or token hooks
without reviewing every client that uses this project. The repository includes
an Ei-TypeBomb consent page at `/oauth/consent`; use it as the authorization path only
if it is appropriate for all applications using the shared OAuth server. If
another shared consent UI already exists, keep using that UI and ensure it
shows the requesting client identity and redirect target accurately.

Keep the existing `RC_HUB_OAUTH_CLIENT_ID` web login client working: it does
not request the MCP resource and its tokens must continue to use the normal
`authenticated` audience.

Supabase's OAuth Server supports dynamic registration and recommends reviewing
registered clients and requiring user approval. Users should revoke grants
they no longer recognize from the Supabase account's authorized-applications
management.

### Client ID-free connection and diagnostics

For ChatGPT connections with no manually entered Client ID, the shared Supabase
Auth authorization server must advertise an automatic registration mechanism.
Its currently documented integration path is **Dynamic Client Registration**.
Client ID Metadata Documents (CIMD) can also remove manual entry, but support
must be implemented and advertised by the **authorization server**, not merely
by the Ei-TypeBomb MCP resource server. Do not publish
`client_id_metadata_document_supported: true` unless the authorization server
actually validates client metadata documents and redirect URIs.

To check an environment without registering a client or sending credentials:

```bash
cd frontend
npm run check:mcp-oauth -- https://beta.ei-typebomb.com/api/mcp
npm run check:mcp-oauth -- https://ei-typebomb.com/api/mcp
npm run test:mcp-oauth
```

If the diagnostic prints **DCR: not advertised** and **CIMD: not advertised**:

1. Open the **shared rcAccount** Supabase project dashboard and go to
   **Authentication → OAuth Server**.
2. Enable **Dynamic Client Registration**. This is a shared-project setting;
   review its impact on other apps and the consent experience before enabling.
3. Re-run the diagnostic and confirm **DCR: advertised**.
4. Reconnect the MCP app in ChatGPT without manually entering a Client ID.
   Confirm the consent screen, authorization callback, token issuance, and
   `tools/list` all work. If discovery succeeds but registration returns 401,
   403 or 404, investigate Supabase registration policy, redirects and logs.

The diagnostic only checks discovery, not whether an actual OAuth client can
register or whether ChatGPT successfully completes OAuth. Keep PKCE, per-user
consent, redirect-URI validation, token audience verification, and room
ownership checks intact. Do **not** use an anonymous/public MCP access token
as a shortcut.

### Client setup

The MCP client only needs the remote endpoint URL:

```text
https://ei-typebomb.com/api/mcp
```

A compatible MCP client will discover OAuth metadata, register (when dynamic
client registration is enabled), open the sign-in/consent flow, and obtain or
refresh its own tokens. Do not copy an Ei-TypeBomb website session token into the MCP
client.

Set `ETB_BASE_URL` for each Vercel environment (`https://ei-typebomb.com` for Production, `https://beta.ei-typebomb.com` for Preview). The MCP resource, metadata and room URLs are derived from it. The issuer remains the shared Supabase OAuth server.

### Temporary Preview audience compatibility

The shared Supabase OAuth server currently uses a Custom Access Token Hook that
issues `aud: "https://ei-typebomb.com/api/mcp"` for the registered MCP
client. Connecting ChatGPT to `https://beta.ei-typebomb.com/api/mcp` therefore
previously produced HTTP 401 (`failedClaim: "aud"`) during tool discovery.

Until OAuth resource indicators are bound to tokens by the authorization
server, **only the beta MCP endpoint** also accepts the production MCP
audience. Production still accepts only its own audience. Tokens issued
for the normal website (`aud: "authenticated"`) are not accepted.
This is limited to the two Ei-TypeBomb MCP resources and does **not**
weaken user ownership checks on room operations.

This is a compatibility workaround, **not full RFC 8707 resource binding**:
a valid production MCP token can also be used on beta. Remove this bridge
when each environment uses separately issued resource-bound tokens.
Do not expand the audience list to `authenticated` or add unrelated OAuth
resource servers. Reconnect the ChatGPT app after deploying this change,
then verify `tools/list` returns `create_room`, `get_room`, and
`update_room`; confirm that normal login tokens still fail with 401.

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
