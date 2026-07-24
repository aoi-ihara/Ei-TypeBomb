"use server";

import { createAdminClient } from "../db/server";
import type { Room } from "@/type";
import isUUID from "validator/es/lib/isUUID";
import { validatePassword } from "../auth/validator";
import { verifyTurnstile } from "../auth/turnstile";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";

export const signInToRoom = async (room: Room, turnstileToken?: string) => {
    if (!isUUID(room.id, 4)) return "Incorrect Room ID.";

    if (room.password) {
        if (validatePassword(room.password)) return "Incorrect password.";

        if (!turnstileToken) return "Turnstile token is required.";
        const turnstileResult = await verifyTurnstile(turnstileToken);
        if (!turnstileResult) return "Incorrect Turnstile token.";

        const supabase = await createAdminClient();
        const { data, error } = await supabase
            .from("ei_typebomb_rooms")
            .select("*")
            .eq("id", room.id)
            .maybeSingle();

        if (error) {
            return error.message;
        }
        if (!data?.password) return "Cannot get the password.";

        if (data.password !== room.password) return "Incorrect password.";

        setAuthCookie(room.id);
    } else {
        const supabase = await createAdminClient();
        const { data, error } = await supabase
            .from("ei_typebomb_rooms")
            .select("*")
            .eq("id", room.id)
            .maybeSingle();

        if (error) {
            return error.message;
        }

        if (!data) {
            return "Room not found.";
        }

        if (data.password) {
            return "Password is required.";
        }

        setAuthCookie(room.id);
    }

    return null;
};

const setAuthCookie = async (id: string) => {
    const token = jwt.sign(
        {
            id,
        },
        process.env.JWT_SECRET!,
        {
            expiresIn: "6h",
        },
    );

    const cookieStore = await cookies();

    cookieStore.set("auth-token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 6,
        path: "/",
    });
};
