"use server";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { after } from "next/server";
import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";
import { getPostHogClient } from "@/lib/posthog-server";

export const createNewRoom = async () => {
    const userId = await getUser();
    if (!userId) redirect(getSignInUrl());

    const supabase = await createAdminClient();
    const uuid = crypto.randomUUID();

    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .insert({ id: uuid, user_id: userId, link: uuid, items: [] })
        .select("id")
        .single();

    if (error) {
        console.error(error);
        return null;
    }

    if (!data.id) return null;

    after(async () => {
        const posthog = getPostHogClient();
        posthog.capture({
            distinctId: userId,
            event: "room_created",
            properties: { room_id: data.id },
        });
        await posthog.shutdown();
    });

    return data.id;
};
