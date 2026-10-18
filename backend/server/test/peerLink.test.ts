import assert from "node:assert/strict";
import test from "node:test";
import { Identity } from "../../shared/distributed/identity";
import { attachLink, type ClusterSocket } from "../../shared/distributed/link";
import { credentials } from "./clusterFixture";

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
test("outbound TLS target and inbound client mutually authenticate before RPC", async () => {
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
test("relaying two inbound authentication challenges cannot impersonate a client", async () => {
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
