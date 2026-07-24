"use server";

import { createAdminClient } from "../db/server";
import { getUser } from "../auth/session";
import { redirect } from "next/navigation";
import type { Room } from "@/type";
import { hashPassword } from "../auth/hash";
import {
    validateExplanation,
    validateMaxPlayers,
    validatePassword,
    validateTitle,
} from "../auth/validator";

export const updateRoomFromId = async (room: Room) => {
    if (room.title !== undefined) {
        const validatorResult = validateTitle(room.title);
        if (validatorResult) {
            return "validatorResult";
        }
    }

    if (room.explanation !== undefined && room.explanation !== "") {
        const validatorResult = validateExplanation(room.explanation);
        if (validatorResult) {
            return validatorResult;
        }
    }

    if (room.maxPlayers !== undefined) {
        const validatorResult = validateMaxPlayers(room.maxPlayers);
        if (validatorResult) {
            return validatorResult;
        }
    }

    if (room.password !== undefined && room.password !== null) {
        const validatorResult = validatePassword(room.password);
        if (validatorResult) {
            return validatorResult;
        }
    }

    const userId = await getUser();
    if (!userId) redirect("/sign-in");

    const supabase = await createAdminClient();

    const { data, error: selectError } = await supabase
        .from("ei_typebomb_rooms")
        .select("user_id, password")
        .eq("id", room.id)
        .maybeSingle();

    if (selectError) {
        return selectError.message;
    }

    if (!data) {
        return "Could not find this room.";
    }

    if (data.user_id !== userId) {
        return "You do not have access to this room.";
    }

    let newHashedPassword = undefined;

    if (room.password) {
        newHashedPassword = await hashPassword(room.password);
    } else {
        newHashedPassword = room.password;
    }

    const timeStamp = new Date();

    const { error: updateError } = await supabase
        .from("ei_typebomb_rooms")
        .update({
            ...(room.title !== undefined && { title: room.title }),
            ...(room.explanation !== undefined && {
                explanation: room.explanation,
            }),
            ...(room.maxPlayers !== undefined && {
                max_players: room.maxPlayers,
            }),
            ...(room.words !== undefined && { words: room.words }),
            ...(newHashedPassword && { password: newHashedPassword }),
            updated_at: timeStamp,
        })
        .eq("id", room.id);

    if (updateError) {
        return updateError.message;
    }

    return null;
};
