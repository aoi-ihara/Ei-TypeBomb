"use server";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";
import { getPostHogClient } from "@/lib/posthog-server";

export const deleteRoom = async (roomId: string) => {
    const userId = await getUser();
    if (!userId) redirect(getSignInUrl());

    const supabase = await createAdminClient();

    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .delete()
        .eq("id", roomId)
        .eq("user_id", userId)
        .select("id")
        .maybeSingle();

    if (error) {
        console.error(error);
        return "ルームを削除できませんでした。もう一度お試しください。";
    }

    if (!data) {
        return "ルームが見つからないか、削除する権限がありません。";
    }

    const posthog = getPostHogClient();
    posthog.capture({
        distinctId: userId,
        event: "room_deleted",
        properties: { room_id: roomId },
    });
    await posthog.shutdown();

    return null;
};
