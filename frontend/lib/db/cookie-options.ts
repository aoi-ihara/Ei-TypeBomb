import type { CookieOptions } from "@supabase/ssr";

const isDeveloperMode = process.env.NEXT_PUBLIC_DEVELOPER_MODE === "true";
const isOAuthEnabled = process.env.NEXT_PUBLIC_ETB_OAUTH_ENABLED === "true";

export const cookieOptions: CookieOptions = {
    // The new ei-typebomb.com domain cannot use .vgnz93hs.com cookies.
    // Legacy cross-subdomain sessions remain available during the migration.
    domain: isDeveloperMode || isOAuthEnabled ? undefined : ".vgnz93hs.com",
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
};
