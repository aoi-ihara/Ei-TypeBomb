# Ei-TypeBomb account management

ETB handles sign-in, sign-up, password recovery, email/password changes, and
sign-out directly with Supabase Auth. The normal website session is stored in
host-scoped Supabase SSR cookies and refreshed in the Next.js proxy.

MCP clients authenticate through ETB's own OAuth authorization server, which
uses the ETB browser session to identify the user during consent. Website
session cookies are not accepted as MCP access tokens. When MCP OAuth is
enabled, the account screen shows a **接続** (Connections) tab. This tab
loads authorized clients from `GET /api/oauth/connections` with
`Accept: application/json` and revokes their grants through the existing
CSRF-protected `POST /api/oauth/connections`. HTML clients can still use the
standalone connections page. Both interfaces revoke all grants for a selected
client ID.

## Deployment configuration

- Set `ETB_BASE_URL` to the deployment's HTTPS origin and configure
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Enable CAPTCHA protection in Supabase
  Auth with the matching Turnstile secret.
- Add `<ETB_BASE_URL>/auth/confirm` and
  `<ETB_BASE_URL>/auth/confirm?next=/sign-in/reset-password?update=true`
  to the Supabase Auth redirect allowlist.
- Default PKCE emails return a `code` to `/auth/confirm`. For custom
  token-hash templates, use `{{ .RedirectTo }}` with the token hash and
  matching `type` (`signup`, `recovery` or `email_change`).
- Sessions are scoped to each ETB host (production and beta may require
  separate sign-ins). Existing user IDs and room/learning data are unchanged.
- `ETB_MCP_OAUTH_ENABLED` controls the MCP authorization server independently
  of website login. No separate website OAuth client is required.

## Verification

Run `npm run test:account` and `npm run test:mcp-oauth` from `frontend`.
Test confirmation/recovery emails, replayed links, credential changes, sign-out,
MCP consent, token refresh and grant revocation on a deployed test environment.
Mocks alone cannot verify live email delivery or browser cookies.
