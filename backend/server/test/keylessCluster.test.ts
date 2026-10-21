import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseETBClusterConfig } from "../../shared/clusterConfig";
import { clusterConfig } from "../../shared/distributed/control";
import { Identity } from "../../shared/distributed/identity";
import { clusterStateRoot, persistentPeerIdentity, topologyStateDirectory } from "../src/lib/peerStorage";
const raw = JSON.stringify({ version: 1, servers: ["https://primary.test", "https://worker.test/ws", "https://render.test"] });
const servers = parseETBClusterConfig(raw);

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

test("Node chooses its server only from current environment, not old SQLite", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "etb-current-config-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const declaration = await Identity.generate(servers, servers[2].origin);
    const first = await persistentPeerIdentity(declaration, dir);
    const boot = first.identity.member.boot;
    first.storage.close();

    // An old Render URL is never discovered from saved metadata.
    assert.equal(clusterConfig({ ETB_CLUSTER_CONFIG: raw }, "socket.io")!.id, servers[0].origin);
    assert.equal(clusterConfig({
        ETB_CLUSTER_CONFIG: raw, SERVER_PUBLIC_URL: servers[2].origin,
    }, "socket.io")!.id, servers[2].origin);

    const db = new DatabaseSync(join(topologyStateDirectory(dir, declaration), "cluster.sqlite"), { readOnly: true });
    assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM state WHERE key = 'identity'").get()!.value as string),
        { boot, rooms: [] }, "the disk must contain the incarnation and voter room IDs, not a previous server configuration");
    db.close();
    const second = await persistentPeerIdentity(declaration, dir);
    assert.equal(second.identity.member.boot, boot, "same topology keeps recovery identity");
    second.storage.close();
});

test("a new topology starts in an isolated state directory; old votes remain untouched", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "etb-current-roster-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const original = await Identity.generate(servers, servers[2].origin);
    const added = parseETBClusterConfig(JSON.stringify({ version: 1,
        servers: [...JSON.parse(raw).servers, "https://new.test"] }));
    const changed = await Identity.generate(added, servers[2].origin);
    assert.notEqual(topologyStateDirectory(root, original), topologyStateDirectory(root, changed));
    const first = await persistentPeerIdentity(original, root);
    const boot = first.identity.member.boot;
    await first.storage.save("room", { promised: 73, candidate: "owner", contact: 10 });
    first.storage.close();

    const next = await persistentPeerIdentity(changed, root);
    assert.notEqual(next.identity.member.boot, boot);
    assert.equal(await next.storage.load("room"), undefined);
    next.storage.close();
    const restored = await persistentPeerIdentity(original, root);
    assert.equal(restored.identity.member.boot, boot);
    assert.equal((await restored.storage.load("room"))!.promised, 73);
    restored.storage.close();
});

test("legacy root SQLite containing a former cluster declaration is never read or overwritten", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "etb-old-database-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const old = new DatabaseSync(join(root, "cluster.sqlite"));
    old.exec("CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    old.prepare("INSERT INTO state VALUES ('identity', ?)").run(JSON.stringify({
        id: "https://old.test", declaration: "old-roster", boot: "old-boot",
    }));
    old.close();
    const declaration = await Identity.generate(servers, servers[0].origin);
    const current = await persistentPeerIdentity(declaration, root);
    assert.notEqual(current.identity.member.boot, "old-boot");
    current.storage.close();
    const untouched = new DatabaseSync(join(root, "cluster.sqlite"), { readOnly: true });
    assert.equal(JSON.parse(untouched.prepare("SELECT value FROM state WHERE key = 'identity'").get()!.value as string).boot, "old-boot");
    untouched.close();
});

test("production state directory cannot be relative or located within the source checkout", () => {
    const cwd = resolve(tmpdir(), "etb-project", "backend", "server");
    assert.throws(() => clusterStateRoot({ CLUSTER_STATE_DIR: ".cluster-state" }, cwd), /absolute/);
    assert.throws(() => clusterStateRoot({ CLUSTER_STATE_DIR: resolve(cwd, ".cluster-state") }, cwd), /outside the repository/);
    assert.throws(() => clusterStateRoot({ CLUSTER_STATE_DIR: resolve(cwd, "..", "elsewhere") }, cwd), /outside the repository/);
    assert.equal(clusterStateRoot({ CLUSTER_STATE_DIR: resolve(tmpdir(), "etb-external-storage") }, cwd),
        resolve(tmpdir(), "etb-external-storage"));
});
