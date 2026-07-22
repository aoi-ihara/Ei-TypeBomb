"use server";

import { createAdminClient } from "../db/server";
import type { Room } from "@/type";
import isUUID from "validator/es/lib/isUUID";
import { validatePassword } from "../auth/validator";
import { verifyTurnstile } from "../auth/turnstile";
import jwt from "jsonwebtoken";

export const signInToRoom = async (room: Room, turnstileToken: string) => {
    if (!isUUID(room.id, 4)) return null;
    if (!room.password) return null;
    if (validatePassword(room.password)) return null;

    const turnstileResult = await verifyTurnstile(turnstileToken);
    if (!turnstileResult) return null;

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("*")
        .eq("id", room.id)
        .maybeSingle();

    if (error) {
        console.error(error.message);
        return null;
    }
    if (!data?.password) return null;

    if (data.password !== room.password) return null;

    const token = jwt.sign(
        {
            roomId: room.id,
        },
        process.env.JWT_SECRET!,
        {
            expiresIn: "6h",
        },
    );

    return token;
};
