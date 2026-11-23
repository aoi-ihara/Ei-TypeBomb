# Ei-TypeBomb account management

ETB handles sign-in, sign-up, password recovery, email/password changes, and
sign-out directly with Supabase Auth. The normal website session is stored in
host-scoped Supabase SSR cookies and refreshed in the Next.js proxy.

MCP clients authenticate through ETB's own OAuth authorization server, which
uses the ETB browser session to identify the user during consent. Website
session cookies are not accepted as MCP access tokens. When MCP OAuth is enabled, the account settings show authorized apps and allow
revocation. The **アプリ** section appears for every signed-in user, showing an
empty state when MCP OAuth is disabled. The **セキュリティ** section groups
email-address and password changes.

## Deployment configuration

- Set `ETB_BASE_URL` to the deployment's HTTPS origin and configure
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Enable CAPTCHA protection in Supabase
  Auth with the matching Turnstile secret. When connecting a development or
  preview build to a hosted Auth project, use the site key paired with that
  project's secret and a hostname allowed by the widget. Use Cloudflare's test
  keys together on an isolated Auth project configured for testing.
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

## Secure password changes

In account settings, **パスワード** sends a reset link to the verified email
address on the signed-in account. This uses the same Supabase **Reset password**
template as signed-out recovery. With the default `{{ .ConfirmationURL }}`
template, open the link in the same browser and on the same device that requested
it so Supabase can complete PKCE. Use the latest email if the link was resent.

After the callback verifies the link, ETB gives that Supabase session 15 minutes
to submit a new password. A successful update clears the recovery cookie. Keep
Supabase's secure password change setting enabled.

## Verification

Run `npm run test:account` and `npm run test:mcp-oauth` from `frontend`.
Test confirmation/recovery emails, replayed links, credential changes, sign-out,
MCP consent, token refresh and grant revocation on a deployed test environment.
Mocks alone cannot verify live email delivery or browser cookies.
