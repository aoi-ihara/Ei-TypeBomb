import "dotenv/config";
import { importJWK, jwtVerify, type JWK } from "jose";

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

        if (protectedHeader.kid !== KEY_ID) {
            throw new Error("Unexpected JWT key ID");
        }

        if (payload.role !== "authenticated") {
            throw new Error("Invalid JWT role");
        }

        const roomId = payload.id;

        if (
            typeof roomId !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                roomId,
            )
        ) {
            throw new Error("Invalid room ID");
        }

        return roomId;
    } catch {
        console.error("JWT verification failed");
        return null;
    }
};
