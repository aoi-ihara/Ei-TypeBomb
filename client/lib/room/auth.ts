"use server";

import { createAdminClient } from "../db/server";
import type { Room } from "@/type";
import isUUID from "validator/es/lib/isUUID";
import { validatePassword } from "../auth/validator";
import { verifyTurnstile } from "../auth/turnstile";
import argon2 from "argon2";
import { importPKCS8, SignJWT } from "jose";
import { cookies } from "next/headers";
import { createPrivateKey } from "node:crypto";

export const getAuthToken = async () => {
    const cookieStore = await cookies();
    const authToken = cookieStore.get("jwt_token")?.value;
    return authToken;
};

export const prepareRoomJoin = async (link: string) => {
    if (!link) return null;

    const supabase = await createAdminClient();
    const { data, error } = await supabase
        .from("ei_typebomb_rooms")
        .select("id, password")
        .eq("link", link)
        .maybeSingle();

    if (error) {
        console.error(error);
        return {
            error: "ルーム情報を取得できませんでした。しばらくしてから再度お試しください。",
        };
    }
    if (!data) return null;

    if (!data.password) {
        await setAuthCookie(data.id);
        return { id: data.id, requiresPassword: false };
    }

    return { id: data.id, requiresPassword: true };
};

export const signInToRoom = async (room: Room, turnstileToken?: string) => {
    if (!isUUID(room.id, 4)) return "ルームIDが正しくありません。";

    if (room.password) {
        if (validatePassword(room.password))
            return "パスワードが正しくありません。";

        if (!turnstileToken) return "ロボットではないことを確認してください。";
        const turnstileResult = await verifyTurnstile(turnstileToken);
        if (!turnstileResult)
            return "ロボットではないことの確認に失敗しました。もう一度お試しください。";

        const supabase = await createAdminClient();
        const { data, error } = await supabase
            .from("ei_typebomb_rooms")
            .select("password")
            .eq("id", room.id)
            .maybeSingle();

        if (error) {
            console.error(error);
            return "ルーム情報を取得できませんでした。しばらくしてから再度お試しください。";
        }
        if (!data?.password)
            return "ルームのパスワードを確認できませんでした。";

        const isValid = await argon2.verify(data.password, room.password);
        if (!isValid) return "パスワードが正しくありません。";

        await setAuthCookie(room.id);
    } else {
        const supabase = await createAdminClient();
        const { data, error } = await supabase
            .from("ei_typebomb_rooms")
            .select("id, password")
            .eq("id", room.id)
            .maybeSingle();

        if (error) {
            console.error(error);
            return "ルーム情報を取得できませんでした。しばらくしてから再度お試しください。";
        }
        if (!data) return "ルームが見つかりません。";
        if (data.password) return "パスワードを入力してください。";

        await setAuthCookie(room.id);
    }

    return null;
};

const setAuthCookie = async (id: string) => {
    const privateKey = await getSigningKey();

    const kid = process.env.JWT_KEY_ID;
    if (!kid) {
        throw new Error("JWT_KEY_ID is not configured");
    }

    const token = await new SignJWT({
        id,
        role: "authenticated",
    })
        .setProtectedHeader({
            alg: "ES256",
            kid,
            typ: "JWT",
        })
        .setIssuedAt()
        .setExpirationTime("4h")
        .sign(privateKey);

    const cookieStore = await cookies();

    cookieStore.set("jwt_token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 4,
        path: "/",
    });
};

async function getSigningKey() {
    const pem = process.env.JWT_PRIVATE_KEY;
    if (!pem) {
        throw new Error("JWT_PRIVATE_KEY is not configured");
    }

    const normalizedPem = pem.replace(/\\n/g, "\n");

    const pkcs8 = createPrivateKey(normalizedPem)
        .export({ type: "pkcs8", format: "pem" })
        .toString();

    return importPKCS8(pkcs8, "ES256");
}
