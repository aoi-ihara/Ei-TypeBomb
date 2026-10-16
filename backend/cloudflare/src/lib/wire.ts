export type WirePacket = { event: string; data?: unknown };

/** Ignore malformed, binary and oversized frames before any game processing. */
export function parseWireMessage(message: string | ArrayBuffer): WirePacket | null {
    if (typeof message !== "string" || message.length > 4096) return null;
    try {
        const value: unknown = JSON.parse(message);
        if (!value || typeof value !== "object" || !("event" in value) ||
            typeof value.event !== "string" || value.event.length > 64) return null;
        return { event: value.event, data: "data" in value ? value.data : undefined };
    } catch {
        return null;
    }
}
export function encodeWireMessage(event: string, data?: unknown): string {
    return JSON.stringify({ event, data });
}
