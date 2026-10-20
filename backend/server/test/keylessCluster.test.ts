import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { parseETBClusterConfig } from "../../shared/clusterConfig";
import { clusterConfig } from "../../shared/distributed/control";
import { Identity, digest } from "../../shared/distributed/identity";
import { PeerControl } from "../../shared/distributed/peers";
import { nodeClusterEnv, persistentPeerIdentity } from "../src/lib/peerStorage";
import { freshRoom } from "./clusterFixture";
const raw = JSON.stringify({ version: 1, servers: ["https://primary.test", "https://worker.test/ws", "https://render.test"] });
const servers = parseETBClusterConfig(raw);
const offline = async (): Promise<never> => { throw new Error("Offline"); };

test("public declarations and statements contain no private keys and provide no identity authentication", async () => {
    const declaration = await Identity.generate(servers, servers[0].origin);
    assert.deepEqual(Object.keys(JSON.parse(declaration)).sort(), ["depth", "id", "parent", "roster", "servers", "transport"]);
    const original = await Identity.create(declaration, "original-process");
    const sameClaim = await Identity.create(declaration, "another-process");
    // Anyone may claim a configured URL: this is explicitly NOT authentication.
    assert.equal((await original.inspectPeer(sameClaim.member.declaration!, sameClaim.member.boot)).boot, "another-process");
    const statement = await original.statement("test", { hash: "public-value" });
    assert.equal(JSON.parse(statement).hash, "public-value");
    await assert.rejects(original.inspectPeer(await Identity.generate([
        {origin:"https://outsider.test",endpoint:"https://outsider.test",transport:"socket.io"}
    ], "https://outsider.test"), "boot"), /Unconfigured/);
});

test("a persisted Render URL and boot survive restart without token or public URL variables", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "etb-keyless-restart-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const declaration = await Identity.generate(servers, servers[2].origin);
    const first = await persistentPeerIdentity(declaration, dir);
    const boot = first.identity.member.boot;
    first.storage.close();
    const env = { ETB_CLUSTER_CONFIG: raw, CLUSTER_STATE_DIR: dir };
    const restored = nodeClusterEnv(env);
    assert.equal("SERVER_PUBLIC_URL" in env, false);
    assert.equal(clusterConfig(restored, "socket.io")!.id, servers[2].origin);
    const second = await persistentPeerIdentity(declaration, dir);
    assert.equal(second.identity.member.boot, boot);
    second.storage.close();
    const db = new DatabaseSync(join(dir, "cluster.sqlite"));
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM state WHERE key IN ('credential', 'identity-pins')").get()!.count, 0);
    db.close();
});

test("legacy certificates/checkpoints restore without any old signing key and retain boot, votes and game", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "etb-keyless-legacy-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const id = servers[2].origin, boot = "legacy-boot";
    const declaration = await Identity.generate(servers, id);
    const identity = await Identity.create(declaration, boot);
    const config = { id, parent: servers[1].origin, primary: servers[0].origin, transport: "socket.io" as const };
    const peer = new PeerControl(identity, config, offline);
    const room = freshRoom();
    await peer.call("open", { roomId: room.id, initial: { game: { room, revision: 0 }, sessions: {}, events: {} } });
    const cp = structuredClone((await peer.read(room.id))!);
    const keys = await generateKeyPair("ES256");
    const publicKey = await exportJWK(keys.publicKey);
    // Produce the exact previous persisted format. Its private key is never saved.
    const certificate = await new SignJWT({depth:2,parent:servers[1].origin,transport:"socket.io",publicKey,
        roster:servers.map(s=>s.origin)}).setProtectedHeader({alg:"ES256",typ:"JWT"})
        .setIssuer("etb-cluster").setAudience("etb-cluster-server").setSubject(id).setExpirationTime("1y").sign(keys.privateKey);
    cp.voters = [Identity.inspect(certificate, boot)];
    cp.value!.game.room.gameId = "legacy-game";
    const {hash:ignoredHash,decision:ignoredDecision,...value} = cp;
    cp.hash = await digest(value);
    cp.decision = await new SignJWT({hash:cp.hash,boot,voters:[id]}).setProtectedHeader({alg:"ES256",typ:"JWT"})
        .setIssuer(id).setSubject(boot).setAudience("etb-room-decision").setExpirationTime("1y").sign(keys.privateKey);
    const db = new DatabaseSync(join(dir, "cluster.sqlite"));
    db.exec("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const put = (key:string,value:unknown) => db.prepare("INSERT INTO state (key,value) VALUES (?,?)").run(key,JSON.stringify(value));
    put("identity", {certificate,boot});
    put("credential", "old key already deleted");
    put("identity-pins", {unused:"obsolete"});
    put(`room:${room.id}`, { committed:cp,promised:cp.ownership.epoch,candidate:id,contact:0 });
    db.close();
    const env = nodeClusterEnv({ETB_CLUSTER_CONFIG:raw,CLUSTER_STATE_DIR:dir});
    assert.equal(env.SERVER_PUBLIC_URL, id);
    const restored = await persistentPeerIdentity(declaration, dir);
    t.after(() => restored.storage.close());
    assert.equal(restored.identity.member.boot, boot);
    const recovered = new PeerControl(restored.identity, config, offline, restored.storage);
    assert.equal((await recovered.read(room.id))!.value!.game.room.gameId, "legacy-game");
    const reopened = await recovered.call("open", {roomId:room.id});
    assert.equal(reopened.ownership!.instance, cp.ownership.instance);
    assert.ok(reopened.ownership!.epoch > cp.ownership.epoch);
});


test("an interrupted first database creation can bootstrap without saved identity metadata", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "etb-keyless-empty-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    new DatabaseSync(join(dir, "cluster.sqlite")).close();
    const env = nodeClusterEnv({ETB_CLUSTER_CONFIG:raw,CLUSTER_STATE_DIR:dir});
    assert.equal(clusterConfig(env, "socket.io")!.id, servers[0].origin);
    const initialized = await persistentPeerIdentity(await Identity.generate(servers, servers[0].origin), dir);
    initialized.storage.close();
});
