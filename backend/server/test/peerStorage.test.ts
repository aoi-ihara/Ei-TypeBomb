import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodePeerStorage, persistentPeerIdentity } from "../src/lib/peerStorage";
import { credentials, freshRoom } from "./clusterFixture";
import { PeerControl } from "../../shared/distributed/peers";

test("durable incarnation and promises survive reopen; a second SQLite connection cannot share the voter", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "etb-vote-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const first = new NodePeerStorage(dir, "certificate");
    const boot = first.boot;
    await first.save("room", { promised: 73, candidate: "owner", contact: 10 });
    assert.throws(() => new NodePeerStorage(dir, "certificate"), /locked/);
    first.close();
    const second = new NodePeerStorage(dir, "certificate");
    assert.equal(second.boot, boot);
    assert.equal((await second.load("room"))!.promised, 73);
    assert.equal(await second.load("unknown"), undefined);
    second.close();
    assert.throws(() => new NodePeerStorage(dir, "changed-certificate"), /certificate changed/);
});

test("restored sole owner recovers its certified game without changing boot or instance", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "etb-owner-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const ids = ["https://primary.test", "https://render.test"];
    const bundles = await credentials(ids);
    const bundle = JSON.stringify(bundles[0]);
    const config = { id: ids[0], parent: null, primary: ids[0], transport: "socket.io" as const };
    const dial = async (): Promise<never> => { throw new Error("Offline"); };
    const first = await persistentPeerIdentity(bundle, dir);
    const peer = new PeerControl(first.identity, config, dial, first.storage);
    const room = freshRoom();
    await peer.call("open", { roomId: room.id,
        initial: { game: { room, revision: 0 }, sessions: {}, events: {} } });
    const cp = (await peer.read(room.id))!;
    await peer.call("open", { roomId: room.id });
    const advanced = (await peer.read(room.id))!;
    // Simulate a record with a newer certified non-voting mirror and an old
    // committed vote. Loading it must not hide the newer route after restart.
    const oldRecord = (await first.storage.load(room.id))!;
    await first.storage.save(room.id, {
        ...oldRecord,
        committed: cp,
        mirror: advanced,
    });
    peer.close();
    first.storage.close();
    const second = await persistentPeerIdentity(bundle, dir);
    t.after(() => second.storage.close());
    const reboot = new PeerControl(second.identity, config, dial, second.storage);
    const loaded = await reboot.call("read", { roomId: room.id });
    assert.equal(loaded.ownership.epoch, advanced.ownership.epoch);
    const restored = await reboot.call("open", { roomId: room.id });
    assert.equal(second.identity.member.boot, first.identity.member.boot);
    assert.equal(restored.ownership.instance, cp.ownership.instance);
    assert.ok(restored.ownership.epoch > cp.ownership.epoch);
    assert.equal(restored.ownership.lifecycle, "MIGRATING");
    await assert.rejects(reboot.call("read", { roomId: "unknown", expectedInstance: "old" }),
        /Expected checkpoint/);
    await assert.rejects(reboot.call("open", { roomId: "unknown", expectedInstance: "old" }),
        /Expected checkpoint/);
});

test("corrupt persistent storage fails closed instead of generating a fresh incarnation", async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "etb-corrupt-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, "cluster.sqlite"), "broken disk data");
    assert.throws(() => new NodePeerStorage(dir, "certificate"), /database/);
});
