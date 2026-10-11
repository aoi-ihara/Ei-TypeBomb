import type { Room } from "./types";
export type ClientPayloads = {
    "auth:response": { jwtToken: string; displayName: string };
    "room:join": undefined;
    "room:leave": undefined;
    "game:start": undefined;
    "word:success": undefined;
    currentInput: string;
    "health:ping": string;
    "health:database": string;
    ping: undefined;
};
export type WireRoom = Omit<Room, "password"> & {
    revision: number;
    words: { jp: string; en: string }[];
};
export type ServerPayloads = {
    connect: { id: string };
    "auth:request": undefined;
    "room:broadcast": WireRoom;
    "typing:input": { input: string };
    "game:end": { holderUserId: string; holderDisplayName?: string };
    "game:quited": undefined;
    "health:pong": string;
    "health:database-result": {
        requestId: string;
        ok: boolean;
        latencyMs: number | null;
    };
    pong: undefined;
    error: { message: string };
};
type Packets<T> = { [K in keyof T]: { event: K; data: T[K] } }[keyof T];
export type ClientGameEvent = Packets<ClientPayloads>;
export type ServerGameEvent = Packets<ServerPayloads>;
export type EventHandlers<T> = {
    [K in keyof T]: T[K] extends undefined ? () => void : (data: T[K]) => void;
};
export function roomSnapshot(room: Room, revision = 0): WireRoom {
    const { password: _password, ...publicRoom } = room;
    return {
        ...publicRoom,
        revision,
        words: room.items.map((item) => ({ jp: item.prompt, en: item.answer })),
    };
}
