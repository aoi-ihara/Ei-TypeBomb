import { createHash } from "node:crypto";
import { UUID } from "./memory-sync-format";

export function memoryStorageId(roomId: string, itemId: string): string {
    if (UUID.test(itemId)) return itemId.toLowerCase();

    // RFC 9562 version 8 layout with a room-scoped SHA-256 digest.
    const hash = createHash("sha256")
        .update(JSON.stringify(["ei-typebomb/item-memory", roomId.toLowerCase(), itemId]))
        .digest();
    hash[6] = (hash[6] & 0x0f) | 0x80;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.subarray(0, 16).toString("hex");
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
