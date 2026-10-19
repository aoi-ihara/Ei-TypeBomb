import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Identity, type Credential } from "../../shared/distributed/identity";
import { PeerControl } from "../../shared/distributed/peers";
import type { Room } from "../../shared/types";
import { randomUUID } from "node:crypto";
export async function credentials(ids: string[]) {
    const ca = await generateKeyPair("ES256");
    const authorityKey = await exportJWK(ca.publicKey);
    return Promise.all(
        ids.map(async (id, depth) => {
            const pair = await generateKeyPair("ES256", { extractable: true });
            const privateKey = await exportJWK(pair.privateKey),
                publicKey = await exportJWK(pair.publicKey);
            const certificate = await new SignJWT({
                depth,
                parent: ids[depth - 1] ?? null,
                transport: depth === 1 ? "websocket" : "socket.io",
                publicKey,
                roster: ids,
            })
                .setProtectedHeader({ alg: "ES256", typ: "JWT" })
                .setSubject(id)
                .setIssuer("etb-cluster")
                .setAudience("etb-cluster-server")
                .setExpirationTime("1y")
                .sign(ca.privateKey);
            return { privateKey, authorityKey, certificate } as Credential;
        }),
    );
}
export const freshRoom = (): Room => ({
    id: randomUUID(),
    items: [{ id: "q", type: "typed_recall", prompt: "q", answer: "a" }],
    users: [],
    maxPlayers: 6,
    gameDuration: 120,
    isStart: false,
    bombHolder: 0,
    bombStatus: 0,
});
export async function network() {
    const ids = [
        "https://primary.test",
        "https://worker.test",
        "https://render.test",
    ];
    const bundles = await credentials(ids);
    const hosts: PeerControl[] = [];
    const alive = [true, true, true],
        blocked = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
        const identity = await Identity.create(JSON.stringify(bundles[i]));
        hosts.push(
            new PeerControl(
                identity,
                {
                    id: ids[i],
                    parent: ids[i - 1] ?? null,
                    primary: ids[0],
                    transport: i === 1 ? "websocket" : "socket.io",
                },
                async () => {
                    throw new Error("Unavailable");
                },
            ),
        );
    }
    for (let i = 0; i < hosts.length; i++)
        for (let j = 0; j < hosts.length; j++)
            if (i !== j) {
                hosts[i].members.set(
                    ids[j],
                    structuredClone(hosts[j].identity.member),
                );
                hosts[i].links.set(ids[j], {
                    member: hosts[j].identity.member,
                    close() {},
                    async call(op, args) {
                        if (!alive[i] || !alive[j] || blocked.has(`${i}:${j}`))
                            throw new Error("Partition");
                        return structuredClone(
                            await hosts[j].dispatch(
                                hosts[i].identity.member,
                                op,
                                structuredClone(args),
                            ),
                        );
                    },
                });
            }
    return { ids, hosts, bundles, alive, blocked };
}
