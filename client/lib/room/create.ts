"use server";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";

export const createNewRoom = async () => {
    const userId = await getUser();
    if (!userId) redirect(process.env.NEXT_PUBLIC_SIGN_IN_URL!);

    const supabase = await createAdminClient();

    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .insert({ user_id: userId })
        .select("id")
        .single();

    if (error) {
        console.error(error);
        return null;
    }

    if (!data.id) return null;

    return data.id;
};
