# RC Hub account features in ETB

When `NEXT_PUBLIC_ETB_OAUTH_ENABLED` is not `true`, ETB provides `/sign-in`,
`/sign-up`, `/sign-in/reset-password`, and `/account` using the existing rcAccount
Supabase project. The account screen follows RC Hub's Apps / Email / Password
navigation using ETB's Shell, Input and Button components. Grant listing and
revocation use the authenticated user's Supabase client, never the admin key.

## Deployment configuration

- Set `ETB_BASE_URL` to the deployment's HTTPS origin, the existing Supabase URL
  and anon key, and `NEXT_PUBLIC_TURNSTILE_SITE_KEY`. Enable CAPTCHA protection in
  Supabase Auth with the matching Turnstile secret. Public forms send CAPTCHA
  tokens to Auth; the secret is not sent to the browser.
- Add `<ETB_BASE_URL>/auth/confirm` and
  `<ETB_BASE_URL>/auth/confirm?next=/sign-in/reset-password?update=true` to the
  Supabase Auth redirect allowlist. Keep RC Hub's existing entries.
- Default PKCE emails return a `code` to `/auth/confirm`. For custom token-hash
  templates use `{{ .RedirectTo }}` with the token hash and the matching `type`
  (`signup`, `recovery`, or `email_change`). Do not hardcode RC Hub's URL in ETB
  email links. Shared-project templates must also preserve RC Hub's flows.
- Native sessions now use host-scoped cookies so ei-typebomb.com and preview
  deployments can sign in. They no longer establish a shared subdomain SSO
  cookie; users may need to sign in separately on each host. Existing shared
  domain cookies are not deleted by this change.
- The proxy refreshes native sessions and propagates rotated cookies. Password
  login is no longer restricted to developer mode.

When OAuth is enabled, `/sign-in` continues through `/auth/start` and RC Hub.
Provider account creation, recovery and management link to RC Hub because OAuth
access tokens are not native Supabase Auth sessions. Direct password actions
reject requests in this mode. ETB sign-out clears only the ETB OAuth cookies.

## Verification

Automated action tests: `node --test test/account-auth.test.cjs` (from frontend).
They check CAPTCHA requirements, authenticated credential changes, OAuth mode
isolation, input validation and trusted callback destinations with mocked Auth.

Before release, test real confirmation/recovery emails, expired/replayed links,
email changes, password changes, grant revocation and sign-out with a dedicated
account on the configured deployment. These require Supabase redirect/template
configuration and access to the recipient mailbox; local rendering and mocks do
not verify email delivery or live authentication.
