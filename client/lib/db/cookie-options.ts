import type { CookieOptions } from "@supabase/ssr";

export const cookieOptions: CookieOptions = {
    domain: process.env.NODE_ENV === "production" ? ".vgnz93hs.com" : undefined,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
};
