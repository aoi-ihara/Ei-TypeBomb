import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Identity, verify, type IdentityPins, type PublicIdentity } from "../../shared/distributed/identity";
import { clusterConfig } from "../../shared/distributed/control";
import { parseETBClusterConfig } from "../../shared/clusterConfig";
import { NodePeerStorage, persistentPeerIdentity } from "../src/lib/peerStorage";
import { credentials } from "./clusterFixture";

test("tokenless topology selects Render automatically and refuses ambiguous Node hosts", () => {
    const ETB_CLUSTER_CONFIG = JSON.stringify({ version: 1, servers: [
        "https://primary.test", "https://worker.test/ws", "https://render.test",
    ] });
    assert.deepEqual(clusterConfig({ ETB_CLUSTER_CONFIG, RENDER_EXTERNAL_URL: "https://render.test" }, "socket.io"), {
        id: "https://render.test", parent: "https://worker.test", primary: "https://primary.test", transport: "socket.io",
    });
    assert.equal(clusterConfig({ ETB_CLUSTER_CONFIG }, "websocket")!.id, "https://worker.test");
    assert.throws(() => clusterConfig({ ETB_CLUSTER_CONFIG }, "socket.io"), /SERVER_PUBLIC_URL/);
    assert.throws(() => clusterConfig({ ETB_CLUSTER_CONFIG, SERVER_PUBLIC_URL: "https://evil.test" }, "socket.io"));
});

test("origin discovery authenticates keys, pins durably, and verifies offline after restart", async (t) => {
    let document: PublicIdentity;
    let requests = 0;
    const server = createServer((req, res) => {
        requests++;
        assert.equal(req.url, "/cluster/identity");
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(document));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const remote = `http://127.0.0.1:${address.port}`;
    const local = "https://render.test";
    const servers = parseETBClusterConfig(JSON.stringify({ version: 1, servers: [remote, local] }));
    const peer = await Identity.create(await Identity.generate(servers, remote));
    document = peer.publicIdentity();
    assert.equal("privateKey" in document, false);
    assert.equal("d" in document.authorityKey, false);
    const dir = await mkdtemp(join(tmpdir(), "etb-auto-identity-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const first = await persistentPeerIdentity(undefined, dir, { servers, id: local });
    const member = await first.identity.inspectPeer(peer.member.certificate, peer.member.boot);
    await verify(await peer.proof(local, { nonce: "challenge" }), member.publicKey, local, remote);
    assert.equal(requests, 1);
    await Promise.all(Array.from({ length: 3 }, () => first.identity.inspectPeer(peer.member.certificate, peer.member.boot)));
    assert.equal(requests, 1);
    assert.equal((await stat(join(dir, "cluster.sqlite"))).mode & 0o777, 0o600);
    const impostor = await Identity.create(await Identity.generate(servers, remote));
    await assert.rejects(first.identity.inspectPeer(impostor.member.certificate, impostor.member.boot), /Pinned peer identity changed/);
    const originalCertificate = first.identity.member.certificate;
    const originalBoot = first.identity.member.boot;
    first.storage.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    const second = await persistentPeerIdentity(undefined, dir, { servers, id: local });
    t.after(() => second.storage.close());
    assert.equal(second.identity.member.certificate, originalCertificate);
    assert.equal(second.identity.member.boot, originalBoot);
    assert.equal((await second.identity.inspectPeer(peer.member.certificate, peer.member.boot)).id, remote);
    assert.equal(requests, 1);
});

test("discovery rejects forged certificates, redirects, topology changes and failed pin writes", async (t) => {
    let document: PublicIdentity;
    let redirect = false;
    let requests = 0;
    const server = createServer((_req, res) => {
        requests++;
        if (redirect) res.writeHead(302, { Location: "http://127.0.0.1:1/" });
        res.end(JSON.stringify(document));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(() => { server.closeAllConnections(); server.close(); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const remote = `http://127.0.0.1:${address.port}`;
    const local = "https://render.test";
    const servers = parseETBClusterConfig(JSON.stringify({ version: 1, servers: [remote, local] }));
    const peer = await Identity.create(await Identity.generate(servers, remote));
    const attacker = await Identity.create(await Identity.generate(servers, remote));
    const identity = await Identity.create(await Identity.generate(servers, local));
    let saved: IdentityPins = {};
    identity.enableDiscovery(servers, {}, async pins => { saved = pins; });
    document = peer.publicIdentity();
    await assert.rejects(identity.inspectPeer(attacker.member.certificate, attacker.member.boot), /HTTPS origin/);
    assert.deepEqual(saved, {});
    redirect = true;
    await assert.rejects(identity.inspectPeer(peer.member.certificate, peer.member.boot));
    redirect = false;
    const changed = [...servers].reverse();
    const wrong = await Identity.create(await Identity.generate(changed, remote));
    document = wrong.publicIdentity();
    await assert.rejects(identity.inspectPeer(wrong.member.certificate, wrong.member.boot), /configured topology/);
    document = peer.publicIdentity();
    identity.enableDiscovery(servers, {}, async () => { throw new Error("Disk full"); });
    await assert.rejects(identity.inspectPeer(peer.member.certificate, peer.member.boot), /Disk full/);
    await assert.rejects(identity.inspectPeer(peer.member.certificate, peer.member.boot), /Disk full/);
    const outsider = await Identity.create(await Identity.generate(parseETBClusterConfig(JSON.stringify({ version: 1,
        servers: ["https://evil.test", local] })), "https://evil.test"));
    const before = requests;
    await assert.rejects(identity.inspectPeer(outsider.member.certificate, outsider.member.boot), /Unconfigured/);
    assert.equal(requests, before);
});

test("an existing credential is retained when the token setting is removed", async (t) => {
    const ids = ["https://primary.test", "https://render.test"];
    const servers = parseETBClusterConfig(JSON.stringify({ version: 1, servers: [ids[0], ids[1] + "/ws"] }));
    const bundles = await credentials(ids);
    const bundle = JSON.stringify(bundles[0]);
    const offlinePeer = await Identity.create(JSON.stringify(bundles[1]));
    const dir = await mkdtemp(join(tmpdir(), "etb-credential-migration-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const first = await persistentPeerIdentity(bundle, dir, { servers, id: ids[0] });
    const certificate = first.identity.member.certificate;
    const boot = first.identity.member.boot;
    // Neither .test origin exists: the legacy CA must verify old checkpoints
    // during an offline upgrade before discovery has established any pins.
    assert.equal((await first.identity.inspectPeer(offlinePeer.member.certificate, offlinePeer.member.boot)).id, ids[1]);
    first.storage.close();
    const second = await persistentPeerIdentity(undefined, dir, { servers, id: ids[0] });
    t.after(() => second.storage.close());
    assert.equal(second.identity.member.certificate, certificate);
    assert.equal(second.identity.member.boot, boot);
    assert.equal((await second.identity.inspectPeer(offlinePeer.member.certificate, offlinePeer.member.boot)).id, ids[1]);
});


test("removing the token before a legacy upgrade fails without overwriting votes or identity", async (t) => {
    const ids = ["https://primary.test", "https://render.test"];
    const servers = parseETBClusterConfig(JSON.stringify({ version: 1, servers: ids }));
    const credential = (await credentials(ids))[0];
    const dir = await mkdtemp(join(tmpdir(), "etb-legacy-no-key-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    // The previous release persisted certificate + boot, but no signing key.
    const old = new NodePeerStorage(dir, credential.certificate);
    const boot = old.boot;
    await old.save("room", { promised: 91, candidate: ids[0], contact: 10 });
    old.close();
    await assert.rejects(persistentPeerIdentity(undefined, dir, { servers, id: ids[0] }), /upgrade once with CLUSTER_SERVER_TOKEN/);
    const upgraded = await persistentPeerIdentity(JSON.stringify(credential), dir, { servers, id: ids[0] });
    t.after(() => upgraded.storage.close());
    assert.equal(upgraded.identity.member.boot, boot);
    assert.equal((await upgraded.storage.load("room"))!.promised, 91);
});
