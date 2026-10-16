# RC Hub OAuth 2.1 client migration

Ei-TypeBomb now supports the rcAccount Supabase OAuth Server using a separate
**ei-typebomb.com** session. The existing vgnz93hs.com cookie flow remains in
place until the feature flag is explicitly enabled.

## Setup

1. Merge and deploy RC Hub OAuth consent PR at `/oauth/consent`.
2. In Supabase project `gkiniypvnwqhmgviwxws`:
   - Authentication → URL Configuration: Site URL `https://hub.vgnz93hs.com`.
   - Authentication → OAuth Server: enable, Authorization Path `/oauth/consent`.
   - Authentication → OAuth Apps: register a **Confidential** client with
     redirect URI `https://ei-typebomb.com/auth/callback`, using
     `client_secret_basic` (the default).
   - Use an **asymmetric signing key** (ES256 / RS256), required for OIDC.
3. Set the following ETB **frontend server** environment variables:

   ```dotenv
   NEXT_PUBLIC_ETB_OAUTH_ENABLED=true
   RC_HUB_OAUTH_CLIENT_ID=<OAuth app client ID>
   RC_HUB_OAUTH_CLIENT_SECRET=<OAuth app client secret>
   ETB_OAUTH_REDIRECT_URI=https://ei-typebomb.com/auth/callback
   NEXT_PUBLIC_SUPABASE_URL=https://gkiniypvnwqhmgviwxws.supabase.co
   ```

   Never set the OAuth client secret as `NEXT_PUBLIC_*`. Reuse the existing
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`; it must be from the **same rcAccount
   Supabase project** used for OAuth. Keep all admin keys server-only.
4. Configure `ei-typebomb.com` for the same ETB Next.js deployment and verify
   HTTPS before enabling the flag. The exact callback URL must match the
   OAuth App registration.
5. Test login and logout on the new domain. Preserve the old subdomain as
   a redirect after migration; do not delete old user records.

## How it works

- `/auth/login` performs a full navigation to `/auth/start`; GET `/auth/start` creates PKCE S256 verifier, state, and an allowlisted
  relative return path; stores them as 10-minute host-only HttpOnly cookies,
  and redirects to Supabase Auth's `/oauth/authorize` endpoint.
- RC Hub prompts login and consent (it remains the **identity provider**).
- GET `/auth/callback` verifies state and PKCE, exchanges the code with
  `/oauth/token` using HTTP Basic authentication server-side, verifies the
  issuer/audience/client ID and JWKS signature, then sets secure host-only
  HttpOnly OAuth access and refresh cookies.
- Next.js `proxy.ts` refreshes expiring access tokens with the OAuth **refresh
  token grant**, propagating rotation to the request and response. This is
  different from the ordinary Supabase JS auth refresh flow.
- Server data calls use the verified OAuth access JWT for Supabase RLS and
  `auth.getUser(accessToken)` for user authentication. Playground and online
  memory now use server actions, rather than browser-side tokens.
- Log out only clears ETB OAuth cookies. It does not log out the RC Hub
  identity provider, so SSO re-entry remains possible.
- No migration of auth user IDs or learning data is required: OAuth access
  tokens identify the original rcAccount user via `sub`.

## Verification

- Test a previously signed-in RC Hub user and a logged-out user.
- Cancel consent; ensure no ETB session is established.
- Tamper with `state` or replay callback code; ensure authentication fails.
- Attempt an invalid `next=//evil.example` value; ensure only same-origin
  redirects occur.
- Confirm `HttpOnly; Secure; SameSite=Lax; Path=/` and *no Domain* on ETB
  auth cookies in production; `__Host-` prefix protects domain scoping.
- After a token expires, confirm refresh and rotation without losing the
  logged-in state. Test concurrent requests at the expiry boundary.
- Verify existing room ownership, Playground learning data, and online memory.
- Ensure old development login still works when the OAuth feature flag is off.
- Verify there are no secrets in the bundle or logs.

## Notes / limitations

- OAuth is not switched on by merging the PR. Dashboard/client registration,
  environment configuration, deployment, and end-to-end verification are
  required separately.
- OAuth refresh token rotation can collide under concurrent requests at expiry.
  A failed refresh clears the ETB session and the user can sign in via RC Hub.
- This app-specific logout does not revoke the provider's OAuth grant; review
  revocation support when implementing global logout.
