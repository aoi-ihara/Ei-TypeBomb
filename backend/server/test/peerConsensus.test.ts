import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { network, freshRoom, credentials } from "./clusterFixture";
import { DistributedRoom } from "../../shared/distributed/runtime";
import { PeerControl } from "../../shared/distributed/peers";
import { Identity } from "../../shared/distributed/identity";
import type { Command } from "../../shared/distributed/types";
const initial = (room: ReturnType<typeof freshRoom>) => ({
    game: { room, revision: 0 },
    sessions: {},
    events: {},
});
test("majority confirmations: owner fencing, approved transfer and no failback", async () => {
    const n = await network(),
        room = freshRoom();
    let now = Date.now();
    const p = new DistributedRoom(
        room.id,
        n.hosts[0],
        () => {},
        () => now,
        () => 0,
    );
    await p.open(room);
    const command = (
        runtime: DistributedRoom,
        id: string,
        type: "room:join" | "game:start" | "word:success",
    ): Command => ({
        id: randomUUID(),
        instance: runtime.checkpoint.ownership.instance,
        epoch: runtime.checkpoint.ownership.epoch,
        revision: runtime.state.revision,
        originRevision: runtime.state.revision,
        gameId: runtime.state.room.gameId,
        bombId: runtime.state.room.bombs?.[0].id,
        turn: runtime.state.room.bombs?.[0].turn,
        event:
            type === "room:join"
                ? { type, player: { id } }
                : ({ type, playerId: id } as Command["event"]),
    });
    await p.connect("a");
    await p.connect("b");
    await p.command(command(p, "a", "room:join"), "a");
    await p.command(command(p, "b", "room:join"), "b");
    await p.command(command(p, "a", "game:start"), "a");
    now += 3001;
    await p.tick();
    const answer = command(p, "a", "word:success");
    await p.command(answer, "a");
    const expected = structuredClone(p.state);
    assert.equal(
        (
            await n.hosts[1].call("report", {
                roomId: room.id,
                owner: n.ids[0],
                revision: p.state.revision,
            })
        ).ownership.owner,
        n.ids[0],
    );
    n.hosts[0].draining = true;
    const moved = await n.hosts[1].call("report", {
        roomId: room.id,
        owner: n.ids[0],
        revision: p.state.revision,
    });
    assert.equal(moved.ownership.owner, n.ids[1]);
    const w = new DistributedRoom(
        room.id,
        n.hosts[1],
        () => {},
        () => now,
        () => 0,
    );
    await w.open();
    await w.connect("a");
    await w.connect("b");
    assert.equal(w.state.room.gameId, expected.room.gameId);
    assert.deepEqual(w.state.room.users, expected.room.users);
    assert.equal(w.state.room.bombs![0].turn, 1);
    const before = w.state.revision;
    assert.equal(await w.command(answer, "a"), "accepted");
    assert.equal(w.state.revision, before);
    await assert.rejects(
        p.command(command(p, "b", "word:success"), "b"),
        /Fenced|Revision/,
    );
    n.alive[0] = false;
    n.alive[1] = false;
    // One remaining replica is not a quorum, even when it has a snapshot.
    await assert.rejects(n.hosts[2].call("report", {
        roomId: room.id,
        owner: n.ids[1],
        revision: w.state.revision,
    }), /quorum/);
    n.alive[0] = true;
    await assert.rejects(
        n.hosts[0].call("open", { roomId: room.id }),
        /current owner/,
    );
    const another = freshRoom();
    // Primary + Render can still form a majority while Worker is down.
    assert.equal(
        (
            await n.hosts[0].call("open", {
                roomId: another.id,
                initial: initial(another),
            })
        ).ownership.owner,
        n.ids[0],
    );
    n.alive[1] = true;
});
test("partition and lost ACK: intersecting majorities fence stale owners", async () => {
    const n = await network(),
        room = freshRoom();
    const cp = await n.hosts[0].call("open", {
        roomId: room.id,
        initial: initial(room),
    });
    n.blocked.add("0:1");
    n.blocked.add("1:0");
    const moved = await n.hosts[1].call("report", {
        roomId: room.id,
        owner: n.ids[0],
        revision: 0,
    });
    assert.equal(moved.ownership.owner, n.ids[1]);
    await assert.rejects(
        n.hosts[0].call("commit", {
            roomId: room.id,
            instance: cp.ownership.instance,
            epoch: cp.ownership.epoch,
            revision: 0,
            value: { ...cp.value!, game: { ...cp.value!.game, revision: 1 } },
        }),
    );
    n.blocked.clear();
    const owner = await n.hosts[1].call("read", { roomId: room.id });
    const link = n.hosts[1].links.get(n.ids[2])!,
        real = link.call;
    let lost = true;
    link.call = async (op, args) => {
        const result = await real(op, args);
        if (op === "stage" && lost) {
            lost = false;
            throw new Error("ACK lost");
        }
        return result;
    };
    await assert.rejects(
        n.hosts[1].call("commit", {
            roomId: room.id,
            instance: owner.ownership.instance,
            epoch: owner.ownership.epoch,
            revision: 0,
            value: {
                ...owner.value!,
                game: { ...owner.value!.game, revision: 1 },
            },
        }),
    );
    const recovered = await n.hosts[2].call("read", { roomId: room.id });
    assert.equal(recovered.ownership.revision, 1);
    n.alive[1] = false;
    // Render knows the last committed revision, but a solo voter cannot
    // elect itself or start making new game decisions during a partition.
    await assert.rejects(n.hosts[2].call("report", {
        roomId: room.id,
        owner: n.ids[1],
        revision: 0,
    }), /quorum/);
    await assert.rejects(
        n.hosts[2].dispatch(n.hosts[1].identity.member, "stage", {
            proposal: { checkpoint: cp, mode: "commit", proof: "forged" },
        }),
    );
});
test("tail unavailability pauses; volatile voter restart cannot vote from a mirror", async () => {
    const n = await network(),
        room = freshRoom();
    await n.hosts[0].call("open", { roomId: room.id, initial: initial(room) });
    n.alive[0] = false;
    n.alive[2] = false;
    await assert.rejects(
        n.hosts[1].call("report", {
            roomId: room.id,
            owner: n.ids[0],
            revision: 0,
        }),
    );
    n.alive[2] = true;
    const cp = await n.hosts[1].call("read", { roomId: room.id });
    const restarted = await Identity.create(JSON.stringify(n.bundles[2]));
    assert.notEqual(restarted.member.boot, n.hosts[2].identity.member.boot);
    // A new process incarnation may cache the signed checkpoint, but is not
    // eligible to replace the original mandatory voter.
    const reboot = new PeerControl(restarted, n.hosts[2].config, async () => {
        throw new Error("Unavailable");
    });
    for (let i = 0; i < 2; i++) {
        reboot.members.set(
            n.ids[i],
            structuredClone(n.hosts[i].identity.member),
        );
        reboot.links.set(n.ids[i], {
            member: n.hosts[i].identity.member,
            close() {},
            call: async (op, args) =>
                structuredClone(
                    await n.hosts[i].dispatch(
                        restarted.member,
                        op,
                        structuredClone(args),
                    ),
                ),
        });
    }
    n.hosts[2] = reboot;
    await reboot.dispatch(n.hosts[0].identity.member, "mirror", {
        checkpoint: { ...cp, servers: undefined },
    });
    await assert.rejects(
        reboot.call("report", {
            roomId: room.id,
            owner: n.ids[0],
            revision: cp.ownership.revision,
        }),
        /incarnation|memory/,
    );
});
test("signed identity rejects outsiders and requires a certified voting prefix", async () => {
    const n = await network();
    const other = await credentials([
        "https://evil.test",
        "https://evil2.test",
    ]);
    const forged = await Identity.create(JSON.stringify(other[0]));
    await assert.rejects(
        n.hosts[0].restoreRegistry([forged.member]),
        /signature/,
    );
    const room = freshRoom();
    n.hosts[0].members.delete(n.ids[2]);
    n.hosts[0].links.delete(n.ids[2]);
    const created = await n.hosts[0].call("open", {
        roomId: room.id, initial: initial(room),
    });
    assert.equal(created.ownership.owner, n.ids[0]);
    assert.equal(n.hosts[0].members.has(n.ids[2]), false);
    const secondNetwork = await network();
    secondNetwork.hosts[0].members.delete(secondNetwork.ids[1]);
    secondNetwork.hosts[0].links.delete(secondNetwork.ids[1]);
    const unavailableRoom = freshRoom();
    await assert.rejects(secondNetwork.hosts[0].call("open", {
        roomId: unavailableRoom.id,
        initial: initial(unavailableRoom),
    }));
});
test("deleted room tombstones fence old snapshots, and a fresh instance starts at primary", async () => {
    const n = await network(),
        room = freshRoom();
    const cp = await n.hosts[0].call("open", {
        roomId: room.id,
        initial: initial(room),
    });
    const deleted = await n.hosts[0].call("delete", {
        roomId: room.id,
        instance: cp.ownership.instance,
        epoch: cp.ownership.epoch,
        revision: cp.ownership.revision,
    });
    assert.equal(deleted.ownership.lifecycle, "DELETED");
    // Allow the asynchronous standby replication to catch up before
    // checking that a subsequently received stale mirror is discarded.
    await n.hosts[2].dispatch(n.hosts[0].identity.member, "install", {
        checkpoint: { ...deleted, servers: undefined },
    });
    assert.equal(
        await n.hosts[2].dispatch(n.hosts[0].identity.member, "mirror", {
            checkpoint: { ...cp, servers: undefined },
        }),
        false,
    );
    assert.equal(
        (await n.hosts[2].call("read", { roomId: room.id })).ownership
            .lifecycle,
        "DELETED",
    );
    await assert.rejects(
        n.hosts[0].call("commit", {
            roomId: room.id,
            instance: cp.ownership.instance,
            epoch: cp.ownership.epoch,
            revision: cp.ownership.revision,
            value: cp.value,
        }),
    );
    await assert.rejects(
        n.hosts[2].dispatch(n.hosts[2].identity.member, "promise", {
            roomId: room.id,
            candidate: n.ids[2],
            epoch: deleted.ownership.epoch + 1,
            configuration: { ...cp, servers: undefined },
        }),
        /Deleted instance/,
    );
    const fresh = await n.hosts[0].call("open", {
        roomId: room.id,
        initial: initial(room),
    });
    assert.notEqual(fresh.ownership.instance, cp.ownership.instance);
    assert.ok(fresh.ownership.epoch > deleted.ownership.epoch);
});

test("a migrated deletion authorizes a fresh instance at stale upper voters", async () => {
    const n = await network(),
        room = freshRoom();
    const first = await n.hosts[0].call("open", {
        roomId: room.id,
        initial: initial(room),
    });
    n.alive[0] = false;
    const worker = await n.hosts[1].call("report", {
        roomId: room.id,
        owner: n.ids[0],
        revision: 0,
    });
    n.alive[1] = false;
    await assert.rejects(n.hosts[2].call("report", {
        roomId: room.id,
        owner: n.ids[1],
        revision: 0,
    }), /quorum/);
    n.alive[1] = true;
    await n.hosts[1].call("delete", {
        roomId: room.id,
        instance: worker.ownership.instance,
        epoch: worker.ownership.epoch,
        revision: worker.ownership.revision,
    });
    n.alive[0] = true;
    const fresh = await n.hosts[0].call("open", {
        roomId: room.id,
        initial: initial(room),
    });
    assert.notEqual(fresh.ownership.instance, first.ownership.instance);
    assert.ok(fresh.ownership.epoch > worker.ownership.epoch);
    for (const host of n.hosts) {
        const state = await host.call("read", { roomId: room.id });
        assert.equal(state.ownership.instance, fresh.ownership.instance);
        assert.equal(state.ownership.owner, n.ids[0]);
    }
});

test("concurrent lower candidates cannot both confirm events after an election", async () => {
    const n = await network(),
        room = freshRoom();
    await n.hosts[0].call("open", { roomId: room.id, initial: initial(room) });
    n.alive[0] = false;
    const elections = await Promise.allSettled(
        [1, 2].map((i) =>
            n.hosts[i].call("report", {
                roomId: room.id,
                owner: n.ids[0],
                revision: 0,
            }),
        ),
    );
    assert.ok(elections.some((r) => r.status === "fulfilled"));
    const commits = await Promise.allSettled(
        [1, 2].map(async (i) => {
            const cp = await n.hosts[i].call("read", { roomId: room.id });
            return n.hosts[i].call("commit", {
                roomId: room.id,
                instance: cp.ownership.instance,
                epoch: cp.ownership.epoch,
                revision: cp.ownership.revision,
                value: {
                    ...cp.value!,
                    game: {
                        ...cp.value!.game,
                        revision: cp.ownership.revision + 1,
                    },
                },
            });
        }),
    );
    assert.equal(commits.filter((r) => r.status === "fulfilled").length, 1);
});

test("migration reconnect grace expires without any returning client and commits deletion", async () => {
    const n = await network(),
        room = freshRoom();
    let now = Date.now();
    const p = new DistributedRoom(
        room.id,
        n.hosts[0],
        () => {},
        () => now,
    );
    await p.open(room);
    for (const id of ["a", "b"]) {
        await p.connect(id);
        await p.apply({ type: "room:join", player: { id } });
    }
    await p.apply({
        type: "game:start",
        playerId: "a",
        gameId: randomUUID(),
        gameDuration: 120,
    });
    n.alive[0] = false;
    await n.hosts[1].call("report", {
        roomId: room.id,
        owner: n.ids[0],
        revision: p.state.revision,
    });
    const worker = new DistributedRoom(
        room.id,
        n.hosts[1],
        () => {},
        () => now,
    );
    await worker.open();
    const turn = worker.state.room.bombs?.[0].turn;
    now += 1000;
    await worker.tick();
    assert.equal(worker.state.room.bombs?.[0].turn, turn);
    assert.equal(worker.snapshot().migrating, true);
    now += 20001;
    await worker.tick();
    assert.equal(worker.deleted, true);
    assert.equal(
        (await n.hosts[2].call("read", { roomId: room.id })).ownership
            .lifecycle,
        "DELETED",
    );
});

test("starting the migration adapter preserves the original timer pause boundary", async () => {
    const n = await network(),
        room = freshRoom();
    await n.hosts[0].call("open", { roomId: room.id, initial: initial(room) });
    const stoppedProgressAt = Date.now();
    await delay(20);
    await n.hosts[1].call("report", {
        roomId: room.id,
        owner: n.ids[0],
        revision: 0,
    });
    n.alive[0] = false;
    await delay(20);
    const election = await n.hosts[1].call("report", {
        roomId: room.id,
        owner: n.ids[0],
        revision: 0,
    });
    assert.ok(election.ownership.pausedAt! <= stoppedProgressAt);
    await delay(20);
    const restored = await n.hosts[1].call("open", { roomId: room.id });
    assert.equal(restored.ownership.pausedAt, election.ownership.pausedAt);
});

test("Render sleeping cannot delay or block Mac mini + Worker commits", async () => {
    const n = await network();
    const room = freshRoom();
    n.alive[2] = false;
    let cp = await n.hosts[0].call("open", {
        roomId: room.id, initial: initial(room),
    });
    assert.equal(cp.ownership.owner, n.ids[0]);
    for (let revision = 1; revision <= 4; revision++) {
        cp = await n.hosts[0].call("commit", {
            roomId: room.id,
            instance: cp.ownership.instance,
            epoch: cp.ownership.epoch,
            revision: cp.ownership.revision,
            value: {
                ...cp.value!,
                game: { ...cp.value!.game, revision },
            },
        });
        assert.equal(cp.ownership.revision, revision);
    }
    const backup = await n.hosts[1].call("read", { roomId: room.id });
    assert.equal(backup.ownership.revision, 4);
    assert.equal(backup.ownership.owner, n.ids[0]);
    // The upper quorum stays healthy; one client's failure report is refused.
    assert.equal((await n.hosts[1].call("report", {
        roomId: room.id,
        owner: n.ids[0],
        revision: 4,
    })).ownership.owner, n.ids[0]);
});

test("brand-new rooms can start while Render has never registered", async () => {
    const n = await network();
    const room = freshRoom();
    n.hosts[0].members.delete(n.ids[2]);
    n.hosts[0].links.delete(n.ids[2]);
    n.alive[2] = false;
    const cp = await n.hosts[0].call("open", {
        roomId: room.id, initial: initial(room),
    });
    assert.deepEqual(cp.ownership.owner, n.ids[0]);
    const config = await n.hosts[0].read(room.id);
    assert.deepEqual(config?.voters.map((v) => v.id), n.ids.slice(0, 2));
    const confirmed = await n.hosts[0].call("confirm", {
        roomId: room.id, instance: cp.ownership.instance,
        epoch: cp.ownership.epoch,
    });
    assert.equal(confirmed.ownership.instance, cp.ownership.instance);
});
