"use server";
import { revalidateRoomContent } from "./revalidate";
import { invalidatePublicRooms } from "./get";
import { blockRoomDataCache, invalidateRoomDataCache, releaseRoomDataCache } from "./room-data-cache";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";
import { getPostHogClient } from "@/lib/posthog-server";

export const deleteRoom = async (roomId: string) => {
    const userId = await getUser();
    if (!userId) redirect(getSignInUrl());

    const supabase = await createAdminClient();

    // Fence previously public/unlisted content before deleting its source.
    const { data: existing, error: lookupError } = await supabase
        .from("ei_typebomb_rooms")
        .select("id, link, visibility, edit_version")
        .eq("id", roomId)
        .eq("user_id", userId)
        .maybeSingle();
    if (lookupError || !existing) {
        return "ルームが見つからないか、削除する権限がありません。";
    }
    let privacyFence: string | null = null;
    if (existing.visibility !== "private") {
        try {
            privacyFence = await blockRoomDataCache(roomId, existing.link);
        } catch {
            return "ルームを安全に削除できませんでした。もう一度お試しください。";
        }
    }

    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .delete()
        .eq("id", roomId)
        .eq("user_id", userId)
        // Every room UPDATE increments edit_version via the DB trigger.
        // Never delete a room that was renamed/edited after we fenced its
        // old link: the new alias would otherwise remain publicly cached.
        .eq("edit_version", existing.edit_version)
        .select("id, link")
        .maybeSingle();

    if (error) {
        await releaseRoomDataCache(privacyFence, roomId, existing.link);
        console.error(error);
        return "ルームを削除できませんでした。もう一度お試しください。";
    }

    if (!data) {
        await releaseRoomDataCache(privacyFence, roomId, existing.link);
        return "ルームが更新されたか、削除する権限がありません。ページを再読み込みしてください。";
    }

    await Promise.all([
        invalidatePublicRooms(),
        privacyFence
            ? releaseRoomDataCache(privacyFence, roomId, existing.link)
            : invalidateRoomDataCache(roomId, existing.link),
        // Defensive cleanup if the returned alias differs from the one
        // used for the privacy fence.
        data.link !== existing.link
            ? invalidateRoomDataCache(data.link)
            : Promise.resolve(),
    ]);
    // Also expires old aliases and lists in the calling browser after a commit.
    revalidateRoomContent();

    const posthog = getPostHogClient();
    posthog.capture({
        distinctId: userId,
        event: "room_deleted",
        properties: { room_id: roomId },
    });
    await posthog.shutdown();

    return null;
};
