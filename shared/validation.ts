import type { Room } from "./types";

export class ClientError extends Error {}
export function validateDisplayName(value: unknown): string {
    if (typeof value !== "string" || !value.length || value.length > 50 || /[\p{Cc}\p{Cf}]/u.test(value)) {
        throw new ClientError("表示名が不正です。");
    }
    return value;
}
export function requireRoomItems(room: Pick<Room, "items">): void {
    if (!Array.isArray(room.items) || !room.items.length || room.items.some((item: unknown) =>
        !item || typeof item !== "object" ||
        !("id" in item) || typeof item.id !== "string" ||
        !("type" in item) || item.type !== "typed_recall" ||
        !("prompt" in item) || typeof item.prompt !== "string" ||
        !("answer" in item) || typeof item.answer !== "string"
    )) {
        throw new ClientError("ルームに問題が設定されていません。問題を設定してから再度お試しください。");
    }
}
export function validateAuthResponse(value: unknown): { jwtToken: string; displayName: string } {
    if (!value || typeof value !== "object" || !("jwtToken" in value) || typeof value.jwtToken !== "string") {
        throw new ClientError("認証情報が不正です。ルームに入り直してください。");
    }
    return {
        jwtToken: value.jwtToken,
        displayName: validateDisplayName("displayName" in value ? value.displayName : undefined),
    };
}
export function isHealthRequestId(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
