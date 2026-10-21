import { Identity, readStatement, type Member } from "./identity";
export const MAX_CLUSTER_FRAME_BYTES = 2 * 1024 * 1024;
export type ClusterSocket = {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: string, listener: (event: any) => void): void;
};
/** Capture frames immediately after socket creation, before awaiting open.
 * Some transports deliver open and the first message in the same callback. */
export function bufferPeerSocket(socket: ClusterSocket): ClusterSocket {
    const listeners = new Map<string, ((event: any) => void)[]>();
    const waiting = new Map<string, any[]>();
    let bytes = 0,
        frames = 0;
    for (const type of ["message", "close", "error"]) {
        socket.addEventListener(type, (event) => {
            const handlers = listeners.get(type);
            if (handlers?.length) {
                for (const listener of handlers) listener(event);
                return;
            }
            if (type === "message") {
                if (
                    typeof event.data !== "string" ||
                    event.data.length > MAX_CLUSTER_FRAME_BYTES
                ) {
                    socket.close(1008, "Invalid cluster message");
                    return;
                }
                bytes += new TextEncoder().encode(event.data).byteLength;
                if (++frames > 128 || bytes > MAX_CLUSTER_FRAME_BYTES) {
                    socket.close(1008, "Cluster handshake buffer exceeded");
                    return;
                }
            }
            const queued = waiting.get(type) ?? [];
            // Only one terminal event of each kind needs to be replayed.
            if (type === "message" || !queued.length) queued.push(event);
            waiting.set(type, queued);
        });
    }
    return {
        send: (data) => socket.send(data),
        close: (code, reason) => socket.close(code, reason),
        addEventListener(type, listener) {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
            const queued = waiting.get(type) ?? [];
            waiting.delete(type);
            for (const event of queued) listener(event);
        },
    };
}
export type PeerLink = {
    member: Member;
    call(op: string, args: Record<string, unknown>): Promise<any>;
    close(): void;
};
/** Protocol negotiation and ordering only. Declarations/nonces are unsigned;
 * anyone with network access can impersonate a configured peer. */
export function attachLink(
    socket: ClusterSocket,
    identity: Identity,
    expected: string | undefined,
    dispatch: (
        member: Member,
        op: string,
        args: Record<string, unknown>,
    ) => Promise<unknown>,
    onReady: (link: PeerLink) => void,
    onClose: (link: PeerLink) => void,
): Promise<PeerLink> {
    const nonce = crypto.randomUUID();
    let answeredChallenge = false;
    let closed = false;
    let negotiation = Promise.resolve();
    let handshakeFrames = 0;
    let handshakeBytes = 0;
    let peer: Member | undefined;
    let link: PeerLink | undefined;
    const pending = new Map<
        string,
        {
            resolve: (v: any) => void;
            reject: (e: Error) => void;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    let resolveReady!: (link: PeerLink) => void,
        rejectReady!: (error: Error) => void;
    const ready = new Promise<PeerLink>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const timer = setTimeout(() => {
        rejectReady(new Error("Peer handshake timeout"));
        socket.close();
    }, 2000);
    const send = (value: unknown) => socket.send(JSON.stringify(value));
    const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        rejectReady(new Error("Peer disconnected"));
        for (const p of pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error("Peer disconnected"));
        }
        pending.clear();
        if (link) onClose(link);
    };
    socket.addEventListener("close", close);
    socket.addEventListener("error", close);
    const receive = async (event: any) => {
        if (closed) return;
        if (
            typeof event.data !== "string" ||
            event.data.length > MAX_CLUSTER_FRAME_BYTES ||
            new TextEncoder().encode(event.data).byteLength >
                MAX_CLUSTER_FRAME_BYTES
        )
            throw new Error("Peer frame too large");
        const message = JSON.parse(event.data);
        if (message.type === "challenge") {
            if (answeredChallenge)
                throw new Error("Repeated handshake challenge");
            answeredChallenge = true;
            if (typeof message.nonce !== "string" || message.nonce.length > 100)
                throw new Error("Invalid challenge");
            send({
                type: "hello",
                version: 3,
                declaration: identity.member.declaration,
                boot: identity.member.boot,
                // Direction and nonce detect accidental crossed/replayed frames;
                // these public values do not authenticate the remote process.
                statement: await identity.statement(
                    expected ?? identity.member.id,
                    {
                        challenge: message.nonce,
                        direction: expected ? "client" : "server",
                    },
                ),
            });
        } else if (message.type === "hello") {
            if (message.version !== 3)
                throw new Error("Incompatible cluster protocol");
            const member = await identity.inspectPeer(
                message.declaration,
                message.boot,
            );
            if (expected && member.id !== expected)
                throw new Error("Wrong peer");
            const proof = readStatement(
                message.statement,
                expected ?? identity.member.id,
                member.id,
            );
            if (
                proof.direction !== (expected ? "server" : "client") ||
                proof.challenge !== nonce ||
                proof.sub !== member.boot
            )
                throw new Error("Invalid peer handshake");
            if (closed || peer) return;
            peer = member;
            link = {
                member,
                call: (op, args) =>
                    new Promise((resolve, reject) => {
                        if (closed) {
                            reject(new Error("Peer disconnected"));
                            return;
                        }
                        if (pending.size >= 128) {
                            reject(new Error("Peer backpressure"));
                            return;
                        }
                        const id = crypto.randomUUID();
                        const timer = setTimeout(() => {
                            pending.delete(id);
                            reject(new Error("Peer ACK timeout"));
                        }, 1500);
                        pending.set(id, { resolve, reject, timer });
                        send({ type: "rpc", id, op, args });
                    }),
                close: () => socket.close(),
            };
            clearTimeout(timer);
            onReady(link);
            resolveReady(link);
        } else {
            if (!peer || !link) throw new Error("Peer handshake incomplete");
            if (message.type === "reply") {
                const p = pending.get(message.id);
                if (!p) return;
                pending.delete(message.id);
                clearTimeout(p.timer);
                if (message.error)
                    p.reject(
                        new Error("Peer rejected request: " + message.error),
                    );
                else p.resolve(message.value);
            } else if (message.type === "rpc") {
                if (
                    typeof message.id !== "string" ||
                    message.id.length > 100 ||
                    typeof message.op !== "string"
                )
                    throw new Error("Invalid RPC");
                try {
                    send({
                        type: "reply",
                        id: message.id,
                        value: await dispatch(peer, message.op, message.args),
                    });
                } catch (error) {
                    send({
                        type: "reply",
                        id: message.id,
                        error:
                            error instanceof Error ? error.message : "Rejected",
                    });
                }
            } else throw new Error("Invalid peer packet");
        }
    };
    const invalid = () => {
        close();
        socket.close(1008, "Invalid cluster message");
    };
    socket.addEventListener("message", (event) => {
        if (closed) return;
        if (peer) {
            void receive(event).catch(invalid);
            return;
        }
        // WebSocket preserves frame order, but async handshake processing does
        // not. Finish challenge and hello in order before processing the first
        // RPC. After negotiation, dispatch concurrently so nested RPC replies
        // are never blocked behind the request that needs them.
        if (
            typeof event.data !== "string" ||
            event.data.length > MAX_CLUSTER_FRAME_BYTES
        ) {
            invalid();
            return;
        }
        const size = new TextEncoder().encode(event.data).byteLength;
        handshakeBytes += size;
        if (
            ++handshakeFrames > 128 ||
            handshakeBytes > MAX_CLUSTER_FRAME_BYTES
        ) {
            invalid();
            return;
        }
        negotiation = negotiation
            .then(async () => {
                if (peer) void receive(event).catch(invalid);
                else await receive(event);
            })
            .catch(invalid)
            .finally(() => {
                handshakeFrames--;
                handshakeBytes -= size;
            });
    });
    if (!closed) send({ type: "challenge", id: identity.member.id, nonce });
    return ready;
}
