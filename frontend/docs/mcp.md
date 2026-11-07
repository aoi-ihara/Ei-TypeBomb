# ETB MCP Server

ETB exposes a remote MCP Streamable HTTP endpoint:

`https://ei-typebomb.com/api/mcp`

The first version exposes room management tools and keeps the existing ETB
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
audience. Tokens issued for the normal ETB website login have the regular
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
2. Dynamic Client Registration is enabled for clients that register themselves.
   Alternatively, register a compatible OAuth client manually.
3. The project's JWT signing keys use ES256 or RS256 and the public JWKS endpoint
   is reachable.
4. The configured authorization path is reachable and requires the user to
   approve or deny each client grant.
5. The consent UI clearly displays the requesting client's registered name and
   redirect URI, and explains what account/resource access is being granted.

Supabase's built-in OAuth scopes (`openid`, `email`, `profile`, and `phone`)
describe identity claims; they are not ETB room permissions. The MCP resource
indicator binds the access token to ETB, while the user's explicit OAuth grant
authorizes the client. The OAuth consent response does not expose the MCP
resource or a separate list of MCP tool permissions to the shared consent page.
For that reason, the registered OAuth client's **description must explicitly
identify the service and list its capabilities**.

For the ETB MCP client, use a description equivalent to:

> Ei-TypeBomb MCP server. Can create ETB rooms, read settings for rooms you own,
> and update settings for rooms you own. It cannot access rooms owned by other
> users.

The consent page displays this registered description next to the client name.
If the description is missing, the page warns that the service's operations
cannot be verified. Users should not approve a client whose purpose or
capabilities are unclear. Do not treat `openid`, `email`, or `profile` as
descriptions of the MCP tools.

**Important:** `rcAccount` is shared with the existing ETB website login and
other OAuth clients. Do not change its global authorization path or token hooks
without reviewing every client that uses this project. The repository includes
an ETB consent page at `/oauth/consent`; use it as the authorization path only
if it is appropriate for all applications using the shared OAuth server. If
another shared consent UI already exists, keep using that UI and ensure it
shows the requesting client and requested resource accurately.

Keep the existing `RC_HUB_OAUTH_CLIENT_ID` web login client working: it does
not request the MCP resource and its tokens must continue to use the normal
`authenticated` audience.

Supabase's OAuth Server supports dynamic registration and recommends reviewing
registered clients and requiring user approval. Users should revoke grants
they no longer recognize from the Supabase account's authorized-applications
management.

### Client setup

The MCP client only needs the remote endpoint URL:

```text
https://ei-typebomb.com/api/mcp
```

A compatible MCP client will discover OAuth metadata, register (when dynamic
client registration is enabled), open the sign-in/consent flow, and obtain or
refresh its own tokens. Do not copy an ETB website session token into the MCP
client.

No new Vercel environment variables are required. The issuer and resource URL
are defined in server-side code.

## Tools

- `create_room`: creates a normal ETB room owned by the authenticated user.
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
the normal ETB website audience should also be rejected; only a token issued
for the MCP resource is accepted.
