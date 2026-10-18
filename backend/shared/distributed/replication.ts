import { signReplication } from "./serverJwt";
import type { Checkpoint, Control, ControlResult, DurableRoom } from "./types";

// Room catalogs are immutable within an instance. Deltas omit unchanged catalogs
// and group input changes; a gap always falls back to the canonical checkpoint.
export type Delta = {
    game: Omit<DurableRoom["game"], "room"> & {
        room: Partial<DurableRoom["game"]["room"]>;
    };
    sessions: DurableRoom["sessions"];
    events: DurableRoom["events"];
    resumeUntil?: number;
};
export function difference(before: DurableRoom, after: DurableRoom): Delta {
    const room: Partial<DurableRoom["game"]["room"]> = {};
    for (const key of Object.keys(after.game.room) as (keyof typeof room)[]) {
        if (
            JSON.stringify(before.game.room[key]) !==
            JSON.stringify(after.game.room[key])
        )
            Object.assign(room, { [key]: after.game.room[key] });
    }
    return { ...after, game: { ...after.game, room } };
}
export class Replicator {
    private previous = new Map<string, Checkpoint>();
    constructor(
        private readonly serverId: string,
        private readonly serverToken: string,
        private readonly request: typeof fetch = (input, init) =>
            fetch(input, init),
    ) {}
    async send(result: ControlResult, full: boolean): Promise<void> {
        const own = result.ownership;
        const self = result.servers.find(
            (server) => server.id === this.serverId,
        );
        if (!self) throw new Error("Server missing from topology");
        const peers = result.servers.filter(
            (server) => server.depth > self.depth,
        );
        await Promise.allSettled(
            peers.map(async (peer) => {
                const key = `${own.roomId}|${peer.id}`;
                const previous = this.previous.get(key);
                const snapshot =
                    full ||
                    !previous?.value ||
                    !result.value ||
                    previous.ownership.instance !== own.instance;
                const body = {
                    roomId: own.roomId,
                    receipt: result.receipt,
                    baseRevision: previous?.ownership.revision,
                    ownership: own,
                    ...(snapshot
                        ? { snapshot: result.value }
                        : {
                              delta: difference(previous.value!, result.value!),
                          }),
                };
                const response = await this.request(
                    `${peer.id}/internal/replicate`,
                    {
                        method: "POST",
                        redirect: "manual",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${await signReplication(this.serverToken, this.serverId, peer.id, own)}`,
                        },
                        body: JSON.stringify(body),
                        signal: AbortSignal.timeout(800),
                    },
                );
                if (!response.ok) {
                    this.previous.delete(key);
                    throw new Error("Replica ACK missing");
                }
                this.previous.set(key, result);
                if (own.lifecycle === "DELETED") this.previous.delete(key);
            }),
        );
    }
}
export function newerReplica(
    current: Checkpoint | undefined,
    incoming: Checkpoint,
): boolean {
    return (
        !current ||
        incoming.ownership.epoch > current.ownership.epoch ||
        (incoming.ownership.epoch === current.ownership.epoch &&
            incoming.ownership.revision > current.ownership.revision)
    );
}
export async function receiveReplica(
    request: Request,
    control: Control,
    store: (checkpoint: Checkpoint, full: boolean) => Promise<void>,
): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    try {
        const body = JSON.parse(await readLimitedBody(request, 524288));
        if (typeof body.roomId !== "string" || typeof body.receipt !== "string")
            return new Response(null, { status: 403 });
        // A short-lived receipt is issued only after an authorized owner commits.
        // Control verifies this recipient is downstream; the untrusted request
        // cannot choose state, owner or epoch. This read also repairs delta gaps.
        const authorization = request.headers.get("Authorization");
        if (
            !authorization?.startsWith("Bearer ") ||
            authorization.length > 2048
        )
            return new Response(null, { status: 403 });
        const canonical = await control.call("receive", {
            roomId: body.roomId,
            receipt: body.receipt,
            jwt: authorization.slice(7),
        });
        await store(canonical, "snapshot" in body);
        return Response.json({ revision: canonical.ownership.revision });
    } catch (error) {
        return new Response(null, {
            status: error instanceof RangeError ? 413 : 403,
        });
    }
}

/** Enforce a byte limit before buffering chunked bodies. */
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
