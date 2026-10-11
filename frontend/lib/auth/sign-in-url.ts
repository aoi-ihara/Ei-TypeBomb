export const getSignInUrl = () =>
    process.env.NEXT_PUBLIC_DEVELOPER_MODE === "true"
        ? "/sign-in"
        : process.env.NEXT_PUBLIC_SIGN_IN_URL!;
