import type { ClientGameEvent, ClientPayloads } from "./protocol";
import type { Room } from "./types";
export class ClientError extends Error {}
export const MAX_DISPLAY_NAME_LENGTH = 50;
export const MAX_CURRENT_INPUT_LENGTH = 32;
export function validateDisplayName(value: unknown): string {
    if (
        typeof value !== "string" ||
        !value.length ||
        value.length > MAX_DISPLAY_NAME_LENGTH ||
        /[\p{Cc}\p{Cf}]/u.test(value)
    ) {
        throw new ClientError("表示名が不正です。");
    }
    return value;
}
export function isRequestId(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value,
        )
    );
}
export function requireRoomItems(room: Pick<Room, "items">): void {
    if (
        !Array.isArray(room.items) ||
        !room.items.length ||
        room.items.some(
            (item) =>
                !item ||
                typeof item.id !== "string" ||
                item.type !== "typed_recall" ||
                typeof item.prompt !== "string" ||
                typeof item.answer !== "string",
        )
    ) {
        throw new ClientError(
            "ルームに問題が設定されていません。問題を設定してから再度お試しください。",
        );
    }
}
// No-payload actions intentionally ignore extra data, as the existing clients do.
export function parseClientEvent(
    event: unknown,
    data: unknown,
): ClientGameEvent | null {
    switch (event) {
        case "room:join":
        case "room:leave":
        case "game:start":
        case "word:success":
        case "ping":
            return { event, data: undefined };
        case "currentInput":
            return typeof data === "string" ? { event, data } : null;
        case "health:ping":
        case "health:database":
            return isRequestId(data) ? { event, data } : null;
        case "auth:response":
            if (
                !data ||
                typeof data !== "object" ||
                !("jwtToken" in data) ||
                typeof data.jwtToken !== "string"
            ) {
                throw new ClientError(
                    "認証情報が不正です。ルームに入り直してください。",
                );
            }
            return {
                event,
                data: {
                    jwtToken: data.jwtToken,
                    displayName: validateDisplayName(
                        "displayName" in data ? data.displayName : undefined,
                    ),
                },
            };
        default:
            return null;
    }
}
export function validateAuthPayload(
    data: unknown,
): ClientPayloads["auth:response"] {
    const parsed = parseClientEvent("auth:response", data);
    if (!parsed || parsed.event !== "auth:response")
        throw new ClientError("認証情報が不正です。");
    return parsed.data;
}
