import type { DurableRoom } from "./types";
export type Delta = {
    game: Omit<DurableRoom["game"], "room"> & {
        room: Partial<DurableRoom["game"]["room"]>;
    };
    removed: string[];
    rest: Omit<DurableRoom, "game">;
};
export function difference(before: DurableRoom, after: DurableRoom): Delta {
    const room: Partial<DurableRoom["game"]["room"]> = {};
    for (const key of Object.keys(after.game.room) as (keyof typeof room)[])
        if (
            JSON.stringify(before.game.room[key]) !==
            JSON.stringify(after.game.room[key])
        )
            Object.assign(room, { [key]: after.game.room[key] });
    const { game, ...rest } = after;
    return {
        game: { ...game, room },
        rest,
        removed: Object.keys(before.game.room).filter(
            (key) => after.game.room[key as keyof typeof room] === undefined,
        ),
    };
}
export function applyDifference(
    before: DurableRoom,
    delta: Delta,
): DurableRoom {
    const room = { ...before.game.room, ...delta.game.room };
    for (const key of delta.removed)
        delete (room as unknown as Record<string, unknown>)[key];
    return { ...delta.rest, game: { ...delta.game, room } };
}
export async function readLimitedBody(
    request: Request,
    limit: number,
): Promise<string> {
    if (Number(request.headers.get("Content-Length") ?? 0) > limit)
        throw new RangeError("Payload too large");
    const reader = request.body?.getReader();
    if (!reader) throw new Error("Missing request body");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > limit) {
            void reader.cancel();
            throw new RangeError("Payload too large");
        }
        chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(buffer);
}
