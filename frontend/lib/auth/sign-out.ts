"use server";

import { createClient } from "@/lib/db/server";
import {
    isOAuthEnabled,
    oauthCookieNames,
    oauthCookieOptions,
} from "@/lib/auth/oauth-config";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export const signOut = async () => {
    if (isOAuthEnabled()) {
        const store = await cookies();
        const names = oauthCookieNames();
        store.set(names.access, "", { ...oauthCookieOptions, maxAge: 0 });
        store.set(names.refresh, "", { ...oauthCookieOptions, maxAge: 0 });
        store.set(names.state, "", { ...oauthCookieOptions, maxAge: 0 });
        store.set(names.verifier, "", { ...oauthCookieOptions, maxAge: 0 });
        store.set(names.returnTo, "", { ...oauthCookieOptions, maxAge: 0 });
        // Only the ETB session ends. The RC Hub SSO session remains intact.
        redirect("/");
    }

    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Failed to sign out:", error);
    redirect("/");
};
