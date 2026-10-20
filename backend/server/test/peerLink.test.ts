import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { Identity } from "../../shared/distributed/identity";
import { attachLink, bufferPeerSocket, type ClusterSocket } from "../../shared/distributed/link";
import { credentials, network, freshRoom } from "./clusterFixture";
import { PeerControl } from "../../shared/distributed/peers";

function sockets(): [ClusterSocket, ClusterSocket] {
    const listeners = [
        new Map<string, ((event: any) => void)[]>(),
        new Map<string, ((event: any) => void)[]>(),
    ];
    let closed = false;
    return [0, 1].map((i) => ({
        send(data: string) {
            queueMicrotask(() => {
                if (!closed)
                    listeners[1 - i]
                        .get("message")
                        ?.forEach((fn) => fn({ data }));
            });
        },
        close() {
            if (closed) return;
            closed = true;
            for (const side of listeners)
                side.get("close")?.forEach((fn) => fn({}));
        },
        addEventListener(event: string, listener: (event: any) => void) {
            listeners[i].set(event, [
                ...(listeners[i].get(event) ?? []),
                listener,
            ]);
        },
    })) as [ClusterSocket, ClusterSocket];
}
async function identities() {
    return Promise.all(
        (
            await credentials(["https://primary.test", "https://worker.test"])
        ).map((bundle) => Identity.create(JSON.stringify(bundle))),
    );
}
test("outbound TLS target and inbound client negotiate public topology before RPC", async () => {
    const [a, b] = await identities(),
        [left, right] = sockets();
    const [client, server] = await Promise.all([
        attachLink(
            left,
            a,
            b.member.id,
            async () => null,
            () => {},
            () => {},
        ),
        attachLink(
            right,
            b,
            undefined,
            async (peer) => peer.id,
            () => {},
            () => {},
        ),
    ]);
    try {
        assert.equal(client.member.id, b.member.id);
        assert.equal(server.member.id, a.member.id);
        assert.equal(await client.call("status", {}), a.member.id);
    } finally {
        client.close();
    }
});
test("two inbound handshakes with the wrong direction are rejected", async () => {
    const [a, b] = await identities(),
        [left, right] = sockets();
    let ready = 0,
        calls = 0;
    const results = await Promise.allSettled([
        attachLink(
            left,
            a,
            undefined,
            async () => ++calls,
            () => {
                ready++;
            },
            () => {},
        ),
        attachLink(
            right,
            b,
            undefined,
            async () => ++calls,
            () => {
                ready++;
            },
            () => {},
        ),
    ]);
    assert.ok(results.every((result) => result.status === "rejected"));
    assert.equal(ready, 0);
    assert.equal(calls, 0);
});

for (const transport of ["in-memory", "real WebSocket"]) test(
    `an immediately issued RPC waits for both handshake records: ${transport}`,
    async (t) => {
        const [a, b] = await identities();
        let left: ClusterSocket, right: ClusterSocket;
        if (transport === "in-memory") [left, right] = sockets();
        else {
            const listener = new WebSocketServer({ host: "127.0.0.1", port: 0 });
            await once(listener, "listening");
            const address = listener.address();
            assert.ok(address && typeof address !== "string");
            const incoming = once(listener, "connection");
            const outgoing = new WebSocket(`ws://127.0.0.1:${address.port}`);
            const [[accepted]] = await Promise.all([incoming, once(outgoing, "open")]);
            left = outgoing as unknown as ClusterSocket;
            right = accepted as unknown as ClusterSocket;
            t.after(() => new Promise<void>((resolve) => {
                outgoing.terminate();
                accepted.terminate();
                listener.close(() => resolve());
            }));
        }
        const proof = a.statement.bind(a);
        // Metadata processing can finish after the opposite direction has verified its hello.
        // Start the first RPC as soon as the local link announces readiness.
        a.statement = async (...args: Parameters<Identity["statement"]>) => {
            await new Promise((resolve) => setTimeout(resolve, 100));
            return proof(...args);
        };
        const client = attachLink(left, a, b.member.id, async () => null, () => {}, () => {});
        const server = attachLink(right, b, undefined, async (peer) => peer.id, () => {}, () => {});
        try {
            const [response] = await Promise.all([
                client.then((link) => link.call("status", {})),
                server,
            ]);
            assert.equal(response, a.member.id);
        } finally {
            left.close();
        }
    },
);

test("first route after Primary restart reads the live Render owner over WebSocket", async (t) => {
    const n = await network(), room = freshRoom();
    await n.hosts[0].call("open", {
        roomId: room.id,
        initial: { game: { room, revision: 0 }, sessions: {}, events: {} },
    });
    const old = (await n.hosts[0].read(room.id))!;
    n.alive[0] = n.alive[1] = false;
    const current = await n.hosts[2].call("report", { roomId: room.id, owner: n.ids[0], revision: 0 });
    assert.equal(current.ownership.owner, n.ids[2]);
    n.hosts[2].links.delete(n.ids[0]);
    const listener = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    await once(listener, "listening");
    const address = listener.address();
    assert.ok(address && typeof address !== "string");
    listener.on("connection", (socket) => { void n.hosts[2].accept(socket as unknown as ClusterSocket).catch(() => {}); });
    t.after(() => new Promise<void>((resolve) => {
        for (const socket of listener.clients) socket.terminate();
        listener.close(() => resolve());
    }));
    const identity = n.hosts[0].identity, proof = identity.statement.bind(identity);
    identity.statement = async (...args: Parameters<Identity["statement"]>) => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return proof(...args);
    };
    const restarted = new PeerControl(identity, n.hosts[0].config, async (id) => {
        if (id !== n.ids[2]) throw new Error("Secondary offline");
        const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
        const buffered = bufferPeerSocket(socket as unknown as ClusterSocket);
        await once(socket, "open");
        // Force the remote challenge to arrive before attachLink is installed.
        await new Promise((resolve) => setTimeout(resolve, 20));
        t.after(() => socket.terminate());
        return buffered;
    }, {
        async load() { return { committed: old, promised: old.ownership.epoch, candidate: n.ids[0], contact: 0 }; },
        async save() {},
    });
    const route = await restarted.call("read", { roomId: room.id });
    assert.equal(route.ownership.owner, n.ids[2], "first route must not expose the persisted former owner");
    assert.equal(route.ownership.epoch, current.ownership.epoch);
});

test("a buffered close before handshake rejects without sending on a closed socket", async () => {
    const [identity] = await identities();
    const listeners = new Map<string, (event: any) => void>();
    const socket = bufferPeerSocket({
        send() { assert.fail("cannot send on a closed socket"); },
        close() {},
        addEventListener(type, listener) { listeners.set(type, listener); },
    });
    listeners.get("close")!({});
    await assert.rejects(
        attachLink(socket, identity, undefined, async () => null, () => {}, () => {}),
        /Peer disconnected/,
    );
});
