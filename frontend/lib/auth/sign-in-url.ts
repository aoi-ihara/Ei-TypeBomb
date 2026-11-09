/** OAuth deployments continue through the provider; password login is local. */
export const getSignInUrl = () =>
    process.env.NEXT_PUBLIC_ETB_OAUTH_ENABLED === "true"
        ? "/auth/sign-in"
        : "/sign-in";
