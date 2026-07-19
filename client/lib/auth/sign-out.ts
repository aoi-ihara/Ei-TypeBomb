"use server";

import { createClient } from "@/lib/db/server";
import { redirect } from "next/navigation";

export const signOut = async () => {
    const supabase = await createClient();

    const { error } = await supabase.auth.signOut();

    if (error) {
        console.error("Failed to sign out:", error);
    }

    redirect("/");
};
