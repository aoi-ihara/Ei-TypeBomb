import type { CookieOptions } from "@supabase/ssr";

const isDeveloperMode = process.env.NEXT_PUBLIC_DEVELOPER_MODE === "true";

export const cookieOptions: CookieOptions = {
    domain: isDeveloperMode ? undefined : ".vgnz93hs.com",
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
};
