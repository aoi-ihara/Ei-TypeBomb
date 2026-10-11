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

    const { data, error: selectError } = await supabase
        .from("ei_typebomb_rooms")
        .select("user_id")
        .eq("id", roomId)
        .maybeSingle();

    if (selectError) {
        console.error(selectError);
        return "ルーム情報を取得できませんでした。もう一度お試しください。";
    }

    if (!data) {
        return "ルームが見つかりません。";
    }

    if (data.user_id !== userId) {
        return "このルームへのアクセス権限がありません。";
    }

    const { error } = await supabase
        .from("ei_typebomb_rooms")
        .delete()
        .eq("id", roomId);

    if (error) {
        console.error(error);
        return "ルームを削除できませんでした。もう一度お試しください。";
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
