"use server";
import { prepareRoomUpdate } from "./prepare-update";
import { revalidateRoomContent } from "./revalidate";
import { invalidatePublicRooms } from "./get";
import { validRoomUpdate } from "./partial-update";
import { getSignInUrl } from "@/lib/auth/sign-in-url";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";
import type { Room } from "@/type";
import { hashPassword } from "../auth/hash";
import { getPostHogClient } from "@/lib/posthog-server";
import {
    validateExplanation,
    validateGameDuration,
    validateLink,
    validateMaxPlayers,
    validatePassword,
    validateTitle,
    validateItems,
} from "../auth/validator";

export type RoomUpdateResult =
    | { status: "saved"; editVersion: number }
    | { status: "conflict" }
    | { status: "error"; message: string };

export const updateRoomFromId = async (
    room: Room,
    expectedEditVersion: number,
): Promise<RoomUpdateResult> => {
    if (!Number.isSafeInteger(expectedEditVersion) || expectedEditVersion < 0) {
        return { status: "error", message: "ルームの更新番号が不正です。" };
    }
    room = validRoomUpdate(room);
    const validationErrors: string[] = [];
    const updateData: Record<string, unknown> = {};

    if (room.title !== undefined) {
        const validatorResult = validateTitle(room.title);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.title = room.title;
    }

    if (room.explanation !== undefined) {
        const validatorResult =
            room.explanation === ""
                ? null
                : validateExplanation(room.explanation);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.explanation = room.explanation;
    }

    if (room.maxPlayers !== undefined) {
        const validatorResult = validateMaxPlayers(room.maxPlayers);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.max_players = room.maxPlayers;
    }

    if (room.bombCount !== undefined) {
        if (
            room.bombCount !== null &&
            (!Number.isInteger(room.bombCount) ||
                room.bombCount < 1 ||
                room.bombCount > 4 ||
                (room.maxPlayers !== undefined &&
                    room.bombCount > room.maxPlayers))
        ) {
            validationErrors.push(
                "爆弾数は1〜4個、かつ最大プレイヤー数以下で選択してください。",
            );
        } else updateData.bomb_count = room.bombCount;
    }

    if (room.gameDuration !== undefined) {
        const validatorResult = validateGameDuration(room.gameDuration);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.game_duration = room.gameDuration;
    }

    if (room.visibility !== undefined) {
        if (!["public", "unlisted", "private"].includes(room.visibility)) {
            validationErrors.push("公開設定が正しくありません。");
        } else {
            updateData.visibility = room.visibility;
            // Keep the legacy flag synchronized for safe rollback compatibility.
            updateData.is_public = room.visibility === "public";
        }
    }

    let shouldUpdatePassword = false;
    let newHashedPassword: string | null | undefined;

    if (room.visibility === "public" || room.visibility === "unlisted") {
        shouldUpdatePassword = true;
        newHashedPassword = null;
    } else if (room.password !== undefined && room.password !== null) {
        const validatorResult = validatePassword(room.password);
        if (validatorResult) validationErrors.push(validatorResult);
        else {
            shouldUpdatePassword = true;
            newHashedPassword = room.password
                ? await hashPassword(room.password)
                : room.password;
        }
    } else if (room.password === null) {
        shouldUpdatePassword = true;
        newHashedPassword = null;
    }

    if (room.items !== undefined) {
        const validatorResult = validateItems(room.items);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.items = room.items;
    }

    if (room.link !== undefined) {
        const validatorResult = validateLink(room.link);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.link = room.link;
    }

    if (shouldUpdatePassword) updateData.password = newHashedPassword;

    if (validationErrors.length > 0) {
        return { status: "error", message: validationErrors.join("\n") };
    }

    if (Object.keys(updateData).length === 0) {
        return { status: "saved", editVersion: expectedEditVersion };
    }

    const userId = await getUser();
    if (!userId) redirect(getSignInUrl());

    updateData.updated_at = new Date();

    const supabase = await createAdminClient();
    const prepared = await prepareRoomUpdate(supabase, room.id, userId, room.items, expectedEditVersion);
    if (prepared.status === "conflict") return { status: "conflict" };
    if (prepared.status === "error") return { status: "error", message: "ルームを取得できませんでした。" };
    updateData.items = prepared.items;
    const { data, error: updateError } = await supabase
        .from("ei_typebomb_rooms")
        .update(updateData)
        .eq("id", room.id)
        .eq("user_id", userId)
        .eq("edit_version", expectedEditVersion)
        .select("id, edit_version")
        .maybeSingle();

    if (updateError) {
        console.error(updateError);
        if (updateError.code === "23505") {
            return { status: "error", message: "このリンクはすでに使用されています。" };
        }
        if (updateError.code === "23514") {
            return { status: "error", message: "公開設定とパスワードの組み合わせが正しくありません。" };
        }
        return { status: "error", message: "ルームを保存できませんでした。もう一度お試しください。" };
    }
    if (!data) {
        const { data: existing, error: lookupError } = await supabase
            .from("ei_typebomb_rooms")
            .select("id")
            .eq("id", room.id)
            .eq("user_id", userId)
            .maybeSingle();

        if (!lookupError && existing) return { status: "conflict" };
        return {
            status: "error",
            message: "ルームが見つからないか、アクセス権限がありません。",
        };
    }

    await invalidatePublicRooms();
    // Also expires old aliases and lists in the calling browser after a commit.
    revalidateRoomContent();

    const posthog = getPostHogClient();
    posthog.capture({
        distinctId: userId,
        event: "room_updated",
        properties: { room_id: room.id },
    });
    await posthog.shutdown();

    return { status: "saved", editVersion: data.edit_version };
};
