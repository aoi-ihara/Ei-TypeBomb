import { ROOM_JWT_POLICY, SESSION_JWT_POLICY } from "../../../shared/jwtPolicy";
import { importJWK, jwtVerify, type JWK } from "jose";
import { getAuthenticatedRoomId } from "../../../shared/roomJwt";
import { getVerifiedSessionId } from "../../../shared/sessionJwt";
import type { Env } from "../types";

export async function verifyRoomToken(
    token: string,
    env: Env,
): Promise<string> {
    // Verify the JWT cryptographically *before* trusting its room ID.
    if (!env.JWT_KEY_ID || !env.JWT_PUBLIC_KEY) {
        throw new Error("Worker JWT configuration is missing");
    }
    const key = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY) as JWK, "ES256");
    const { payload, protectedHeader } = await jwtVerify(
        token,
        key,
        ROOM_JWT_POLICY,
    );
    return getAuthenticatedRoomId(payload, protectedHeader.kid, env.JWT_KEY_ID);
}

export async function verifyClientSessionToken(
    token: string,
    roomId: string,
    env: Env,
): Promise<string> {
    const key = await importJWK(JSON.parse(env.JWT_PUBLIC_KEY) as JWK, "ES256");
    const { payload, protectedHeader } = await jwtVerify(
        token,
        key,
        SESSION_JWT_POLICY,
    );
    return getVerifiedSessionId(
        payload,
        protectedHeader.kid,
        env.JWT_KEY_ID,
        roomId,
    );
}
