"use server";

import { createClient } from "@/lib/db/server";
import { serverError } from "@/lib/server-console";

export const getSession = async () => {
    const supabase = await createClient({
        next: { tags: ["current-session"] },
    });

    const { data, error } = await supabase.auth.getSession();

    if (error) {
        serverError("failed to get session", error, "AUTH");
        return;
    }
    if (!data.session?.user) return null;
    return data.session.user.id;
};

export const getUser = async () => {
    const supabase = await createClient({
        next: { tags: ["current-user"] },
    });

    const { data, error } = await supabase.auth.getUser();

    if (error) {
        serverError("failed to get user", error, "AUTH");
        return;
    }
    if (!data.user) return null;
    return data.user.id;
};
