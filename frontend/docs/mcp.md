# ETB MCP Server

ETB exposes a stateless MCP Streamable HTTP endpoint at:

`POST https://ei-typebomb.com/api/mcp`

The first implementation focuses on backend room management. It does not add a
new frontend screen or change the existing room UI.

## Authentication

Tool calls require a Supabase user access token in the HTTP
`Authorization: Bearer <access-token>` header. The endpoint verifies the token
with Supabase Auth, then scopes every database operation to the authenticated
user's `user_id`. The service-role client is used only after identity
verification; room ownership is enforced in every read/update query.

This initial endpoint does not implement an OAuth authorization flow or issue
MCP access tokens. A client must already have a valid Supabase access token.
OAuth-based connection onboarding is a separate follow-up.

## Tools

- `create_room`: creates a normal ETB room owned by the authenticated user.
- `get_room`: reads an owned room by its ID or share link.
- `update_room`: updates the supplied settings of an owned room.

Password hashes are never returned. Public and unlisted rooms have their
password cleared, matching the existing room update behavior.

## Protocol

The endpoint implements stateless Streamable HTTP JSON-RPC for
`initialize`, `ping`, `tools/list`, and `tools/call`. It does not issue
MCP session IDs and does not support server-initiated notifications or SSE
streams. Requests are limited to 32 KiB.

## Vercel

Deploy the existing Next.js app as usual. The route uses the existing
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY` environment variables. No new frontend settings
or build configuration are required.
