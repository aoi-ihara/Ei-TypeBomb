"use server";

import { createClient } from "@/lib/db/server";

export const getSession = async () => {
    const supabase = await createClient({
        next: { tags: ["current-session"] },
    });

    const { data, error } = await supabase.auth.getSession();

    if (error) {
        console.error(error);
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
        console.error(error);
        return;
    }
    if (!data.user) return null;
    return data.user.id;
};
