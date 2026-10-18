import { Identity, verify, type Member } from "./identity";
export const MAX_CLUSTER_FRAME_BYTES = 2 * 1024 * 1024;
export type ClusterSocket = {
    send(data: string): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: string, listener: (event: any) => void): void;
};
export type PeerLink = {
    member: Member;
    call(op: string, args: Record<string, unknown>): Promise<any>;
    close(): void;
};
/** Mutual challenge-response authenticates the connection before any RPC. A
 * per-connection challenge prevents replay of a previously recorded hello. */
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
        rejectReady(new Error("Peer authentication timeout"));
        socket.close();
    }, 2000);
    const send = (value: unknown) => socket.send(JSON.stringify(value));
    const close = () => {
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
    socket.addEventListener("message", (event) => {
        void (async () => {
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
                    throw new Error("Repeated authentication challenge");
                answeredChallenge = true;
                if (
                    typeof message.nonce !== "string" ||
                    message.nonce.length > 100
                )
                    throw new Error("Invalid challenge");
                send({
                    type: "hello",
                    certificate: identity.member.certificate,
                    boot: identity.member.boot,
                    proof: await identity.proof(expected ?? message.id, {
                        challenge: message.nonce,
                    }),
                });
            } else if (message.type === "hello") {
                const member = await Identity.inspect(
                    message.certificate,
                    identity.credential.authorityKey,
                    message.boot,
                );
                if (expected && member.id !== expected)
                    throw new Error("Wrong peer");
                const proof = await verify(
                    message.proof,
                    member.publicKey,
                    identity.member.id,
                    member.id,
                );
                if (proof.challenge !== nonce || proof.sub !== member.boot)
                    throw new Error("Replay of peer authentication");
                if (peer) return;
                peer = member;
                link = {
                    member,
                    call: (op, args) =>
                        new Promise((resolve, reject) => {
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
                if (!peer || !link) throw new Error("Unauthenticated peer");
                if (message.type === "reply") {
                    const p = pending.get(message.id);
                    if (!p) return;
                    pending.delete(message.id);
                    clearTimeout(p.timer);
                    if (message.error)
                        p.reject(
                            new Error(
                                "Peer rejected request: " + message.error,
                            ),
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
                            value: await dispatch(
                                peer,
                                message.op,
                                message.args,
                            ),
                        });
                    } catch (error) {
                        send({
                            type: "reply",
                            id: message.id,
                            error:
                                error instanceof Error
                                    ? error.message
                                    : "Rejected",
                        });
                    }
                } else throw new Error("Invalid peer packet");
            }
        })().catch(() => socket.close(1008, "Invalid cluster message"));
    });
    send({ type: "challenge", id: identity.member.id, nonce });
    return ready;
}
