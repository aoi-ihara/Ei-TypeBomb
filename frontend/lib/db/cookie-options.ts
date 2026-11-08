import type { CookieOptions } from "@supabase/ssr";

const isDeveloperMode = process.env.NEXT_PUBLIC_DEVELOPER_MODE === "true";
const isOAuthEnabled = process.env.NEXT_PUBLIC_ETB_OAUTH_ENABLED === "true";

export const cookieOptions: CookieOptions = {
    domain: isDeveloperMode || isOAuthEnabled ? undefined : ".vgnz93hs.com",
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
};
