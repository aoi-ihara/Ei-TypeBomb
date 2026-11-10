"use server";

import { createClient } from "@/lib/db/server";
import { redirect } from "next/navigation";

export const signOut = async () => {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut();
    if (error)
        throw new Error("サインアウトに失敗しました。再度お試しください。");
    redirect("/");
};
