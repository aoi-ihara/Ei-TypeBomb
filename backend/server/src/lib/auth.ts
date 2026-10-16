import "dotenv/config";
import { importJWK, jwtVerify, type JWK } from "jose";
import { getAuthenticatedRoomId } from "../../../shared/roomJwt";

const KEY_ID = process.env.JWT_KEY_ID;
const PUBLIC_KEY_JSON = process.env.JWT_PUBLIC_KEY;

if (!KEY_ID || !PUBLIC_KEY_JSON) {
    throw new Error("JWT public key configuration is missing");
}

const publicKeyPromise = importJWK(JSON.parse(PUBLIC_KEY_JSON) as JWK, "ES256");

export const verifyToken = async (jwtToken: string): Promise<string | null> => {
    try {
        const publicKey = await publicKeyPromise;

        const { payload, protectedHeader } = await jwtVerify(
            jwtToken,
            publicKey,
            {
                algorithms: ["ES256"],
            },
        );

        return getAuthenticatedRoomId(payload, protectedHeader.kid, KEY_ID);
    } catch {
        console.error("JWT verification failed");
        return null;
    }
};
