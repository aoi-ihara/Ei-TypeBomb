/**
 * Authorization policy for a tab-scoped session JWT.
 * Every runtime MUST verify the ES256 signature, expiry and key ID first.
 */
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getVerifiedSessionId(
    payload: Record<string, unknown>,
    keyId: string | undefined,
    expectedKeyId: string,
    roomId: string,
): string {
    if (keyId !== expectedKeyId) throw new Error("Unexpected session JWT key");
    if (payload.role !== "client_session")
        throw new Error("Invalid session role");
    if (payload.roomId !== roomId)
        throw new Error("Session belongs to another room");
    if (
        typeof payload.sessionId !== "string" ||
        !UUID.test(payload.sessionId)
    ) {
        throw new Error("Invalid client session ID");
    }
    return payload.sessionId;
}
