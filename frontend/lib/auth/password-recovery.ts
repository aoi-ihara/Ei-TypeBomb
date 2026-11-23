import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { createClient } from "@/lib/db/server";

export const PASSWORD_RESET_PATH = "/sign-in/reset-password";
const RECOVERY_COOKIE = "etb-password-recovery";
const RECOVERY_DURATION = 15 * 60;

type Auth = Awaited<ReturnType<typeof createClient>>["auth"];

function proof(sessionId: string, expires: number) {
    return createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!)
        .update(JSON.stringify([RECOVERY_COOKIE, sessionId, expires]))
        .digest("base64url");
}

export async function grantPasswordRecovery(
    auth: Auth,
    accessToken: string,
    method: "recovery" | "otp",
) {
    const { data, error } = await auth.getClaims(accessToken);
    if (error || !data?.claims.amr?.some((entry) =>
        (typeof entry === "string" ? entry : entry.method) === method,
    )) return false;
    const sessionId = data.claims.session_id;
    if (!sessionId) return false;

    const expires = Math.floor(Date.now() / 1000) + RECOVERY_DURATION;
    (await cookies()).set(RECOVERY_COOKIE, `${expires}.${proof(sessionId, expires)}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: RECOVERY_DURATION,
    });
    return true;
}

export async function hasPasswordRecovery(auth: Auth) {
    const value = (await cookies()).get(RECOVERY_COOKIE)?.value;
    const match = value?.match(/^(\d+)\.([\w-]{43})$/);
    if (!match) return false;

    const expires = Number(match[1]);
    if (!Number.isSafeInteger(expires) || expires <= Date.now() / 1000) return false;

    const { data, error } = await auth.getClaims();
    if (error || !data?.claims.session_id) return false;

    return timingSafeEqual(
        Buffer.from(match[2]),
        Buffer.from(proof(data.claims.session_id, expires)),
    );
}

export async function clearPasswordRecovery() {
    (await cookies()).delete(RECOVERY_COOKIE);
}
