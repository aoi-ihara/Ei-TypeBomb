/**
 * Keep the local developer login and the legacy subdomain flow unchanged
 * until the OAuth feature flag is explicitly enabled.
 */
export const getSignInUrl = () =>
    process.env.NEXT_PUBLIC_ETB_OAUTH_ENABLED === "true"
        ? "/auth/login"
        : process.env.NEXT_PUBLIC_DEVELOPER_MODE === "true"
          ? "/sign-in"
          : process.env.NEXT_PUBLIC_SIGN_IN_URL!;
