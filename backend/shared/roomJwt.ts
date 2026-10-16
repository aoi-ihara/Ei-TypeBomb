/**
 * The room-authorization policy after cryptographic JWT verification.
 * Each runtime must verify signature, expiry and ES256 before calling this.
 */
const ROOM_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getAuthenticatedRoomId(
    payload: Record<string, unknown>,
    keyId: string | undefined,
    expectedKeyId: string,
): string {
    if (keyId !== expectedKeyId) throw new Error("Unexpected JWT key ID");
    if (payload.role !== "authenticated") throw new Error("Invalid JWT role");
    if (typeof payload.id !== "string" || !ROOM_ID_PATTERN.test(payload.id)) {
        throw new Error("Invalid room ID");
    }
    return payload.id;
}
