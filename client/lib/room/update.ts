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
            console.warn("Title validation failed:", validatorResult);
            return;
        }
    }

    if (room.explanation !== undefined && room.explanation !== "") {
        const validatorResult = validateExplanation(room.explanation);
        if (validatorResult) {
            console.warn("Explanation validation failed:", validatorResult);
            return;
        }
    }

    if (room.maxPlayers !== undefined) {
        const validatorResult = validateMaxPlayers(room.maxPlayers);
        if (validatorResult) {
            console.warn("MaxPlayers validation failed:", validatorResult);
            return;
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
        console.error("Select Error:", selectError.message);
        throw new Error(selectError.message);
    }

    if (!data) {
        console.error("Could not find this room.");
        throw new Error("Room not found");
    }

    if (data.user_id !== userId) {
        console.error(" You do not have access to this room.");
        throw new Error("Unauthorized");
    }

    let newHashedPassword = undefined;
    if (room.password && room.password !== data.password) {
        const validatorResult = validatePassword(room.password);
        if (!validatorResult) {
            newHashedPassword = await hashPassword(room.password);
        }
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
        console.error("Update Error:", updateError.message);
        throw new Error(updateError.message);
    }

    return { success: true };
};
