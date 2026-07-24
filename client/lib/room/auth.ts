"use server";

import { createAdminClient } from "../db/server";
import type { Room } from "@/type";
import isUUID from "validator/es/lib/isUUID";
import { validatePassword } from "../auth/validator";
import { verifyTurnstile } from "../auth/turnstile";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

export const getAuthToken = async () => {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("jwt_token")?.value;
    return authToken;
};

export const signInToRoom = async (room: Room, turnstileToken?: string) => {
    if (!isUUID(room.id, 4)) return "Incorrect Room ID.";

    if (room.password) {
        if (!validatePassword(room.password)) return "Incorrect password.";

        if (!turnstileToken) return "Turnstile token is required.";
        const turnstileResult = await verifyTurnstile(turnstileToken);
        if (!turnstileResult) return "Incorrect Turnstile token.";

        const supabase = await createAdminClient();
        const { data, error } = await supabase
            .from("ei_typebomb_rooms")
            .select("*")
            .eq("id", room.id)
            .maybeSingle();

        if (error) return error.message;
        if (!data?.password) return "Cannot get the password.";
        if (data.password !== room.password) return "Incorrect password.";

        await setAuthCookie(room.id);
    } else {
        const supabase = await createAdminClient();
        const { data, error } = await supabase
            .from("ei_typebomb_rooms")
            .select("*")
            .eq("id", room.id)
            .maybeSingle();

        if (error) return error.message;
        if (!data) return "Room not found.";
        if (data.password) return "Password is required.";

        await setAuthCookie(room.id);
    }

    return null;
};

const setAuthCookie = async (id: string) => {
    const encoder = new TextEncoder();
    const JWT_SECRET = encoder.encode(process.env.JWT_SECRET!);

    const token = await new SignJWT({ id })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime("4h")
        .sign(JWT_SECRET);

    const cookieStore = await cookies();

    cookieStore.set("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 4,
        path: "/",
    });
};
