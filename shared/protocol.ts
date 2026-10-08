import type { Room } from "./types";

export type RoomSnapshot = Omit<Room, "password"> & {
    words: { jp: string; en: string }[];
};
export function roomToWireSnapshot(room: Room): RoomSnapshot {
    const { password: _password, ...snapshot } = room;
    return {
        ...snapshot,
        words: room.items?.map(({ prompt, answer }) => ({ jp: prompt, en: answer })) ?? [],
    };
}
export type ClientEventPayloads = {
    "auth:response": { jwtToken: string; displayName: string };
    "room:join": undefined;
    "room:leave": undefined;
    "game:start": undefined;
    "word:success": undefined;
    currentInput: string;
    "health:ping": string;
    "health:database": string;
};
export type ServerEventPayloads = {
    "auth:request": undefined;
    "room:broadcast": RoomSnapshot;
    "typing:input": { input: string };
    "game:end": { holderUserId: string; holderDisplayName?: string };
    "game:quited": undefined;
    error: { message: string };
    "health:pong": string;
    "health:database-result": { requestId: string; ok: boolean; latencyMs: number | null };
};
// Native WebSocket framing is separate from application callbacks. WorkerSocket
// consumes connect/pong internally; Socket.IO supplies its own lifecycle events.
export type ClientWirePayloads = ClientEventPayloads & { ping: undefined };
export type ServerWirePayloads = ServerEventPayloads & { connect: { id: string }; pong: undefined };
type EventUnion<T> = {
    [K in keyof T]: T[K] extends undefined ? { event: K; data?: undefined } : { event: K; data: T[K] }
}[keyof T];
export type ClientGameEvent = EventUnion<ClientEventPayloads>;
export type ServerGameEvent = EventUnion<ServerEventPayloads>;
export type ClientWirePacket = EventUnion<ClientWirePayloads>;
export type ServerWirePacket = EventUnion<ServerWirePayloads>;
export type SocketCallbacks<T> = {
    [K in keyof T]: T[K] extends undefined ? () => void : (data: T[K]) => void;
};
export type ClientSocketEvents = SocketCallbacks<ClientEventPayloads>;
export type ServerSocketEvents = SocketCallbacks<ServerEventPayloads>;
