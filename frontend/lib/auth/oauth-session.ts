import "server-only";
import { cookies } from "next/headers";
import { oauthCookieNames } from "@/lib/auth/oauth-config";
import { verifyOAuthAccessToken } from "@/lib/auth/oauth-tokens";

export async function getOAuthAccessToken(): Promise<string | null> {
    const token = (await cookies()).get(oauthCookieNames().access)?.value;
    if (!token) return null;
    try {
        await verifyOAuthAccessToken(token);
        return token;
    } catch {
        return null;
    }
}
