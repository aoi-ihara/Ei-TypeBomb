import type { CookieOptions } from "@supabase/ssr";

export const cookieOptions: CookieOptions = {
    // ETB also runs on ei-typebomb.com; sessions belong to this host.
    domain: undefined,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
};
