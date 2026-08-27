"use server";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";
import type { Room } from "@/type";
import { hashPassword } from "../auth/hash";
import { getPostHogClient } from "@/lib/posthog-server";
import {
    validateExplanation,
    validateLink,
    validateMaxPlayers,
    validatePassword,
    validateTitle,
    validateWords,
} from "../auth/validator";

export const updateRoomFromId = async (room: Room) => {
    const validationErrors: string[] = [];
    const updateData: Record<string, unknown> = {};

    if (room.title !== undefined) {
        const validatorResult = validateTitle(room.title);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.title = room.title;
    }

    if (room.explanation !== undefined) {
        const validatorResult =
            room.explanation === "" ? null : validateExplanation(room.explanation);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.explanation = room.explanation;
    }

    if (room.maxPlayers !== undefined) {
        const validatorResult = validateMaxPlayers(room.maxPlayers);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.max_players = room.maxPlayers;
    }

    let shouldUpdatePassword = false;
    let newHashedPassword: string | null | undefined;

    if (room.password !== undefined && room.password !== null) {
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

    if (room.words !== undefined) {
        const validatorResult = validateWords(room.words);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.words = room.words;
    }

    if (room.link !== undefined) {
        const validatorResult = validateLink(room.link);
        if (validatorResult) validationErrors.push(validatorResult);
        else updateData.link = room.link;
    }

    if (shouldUpdatePassword) updateData.password = newHashedPassword;

    const userId = await getUser();
    if (!userId) redirect(process.env.NEXT_PUBLIC_SIGN_IN_URL!);

    const supabase = await createAdminClient();

    const { data, error: selectError } = await supabase
        .from("ei_typebomb_rooms")
        .select("user_id")
        .eq("id", room.id)
        .maybeSingle();

    if (selectError) return selectError.message;

    if (!data) return "Could not find this room.";

    if (data.user_id !== userId) return "You do not have access to this room.";

    if (Object.keys(updateData).length === 0) {
        return validationErrors.length > 0 ? validationErrors.join("\n") : null;
    }

    updateData.updated_at = new Date();

    const { error: updateError } = await supabase
        .from("ei_typebomb_rooms")
        .update(updateData)
        .eq("id", room.id);

    if (updateError) return updateError.message;

    const posthog = getPostHogClient();
    posthog.capture({
        distinctId: userId,
        event: "room_updated",
        properties: { room_id: room.id },
    });
    await posthog.shutdown();

    return validationErrors.length > 0 ? validationErrors.join("\n") : null;
};
