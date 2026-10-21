import { readLimitedBody } from "../../shared/distributed/replication";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
    DistributedRoom,
    resumeDeadlines,
} from "../../shared/distributed/runtime";
import { clusterConfig } from "../../shared/distributed/control";
import type {
    Control,
    ControlResult,
    Command,
} from "../../shared/distributed/types";
import type { GameState, Room } from "../../shared/types";

const room: Room = {
    id: randomUUID(),
    items: [{ id: "q", type: "typed_recall", prompt: "q", answer: "a" }],
    users: [],
    maxPlayers: 4,
    gameDuration: 20,
    isStart: false,
    bombHolder: 0,
    bombStatus: 0,
};
function fixture() {
    let now = 10_000;
    let failure = "";
    const published: unknown[] = [],
        calls: string[] = [];
    let result: ControlResult = {
        ownership: {
            roomId: room.id,
            instance: randomUUID(),
            owner: "https://owner.test",
            epoch: 1,
            revision: 0,
            lifecycle: "CREATING",
            savedAt: now,
        },
        value: {
            game: { room: structuredClone(room), revision: 0 },
            sessions: {},
            events: {},
        },
        servers: [],
    };
    const control: Control = {
        async call(op, args = {}) {
            calls.push(op);
            if (op === failure) throw new Error("Control unreachable");
            if (op === "commit")
                result = {
                    ...result,
                    value: structuredClone(
                        args.value,
                    ) as ControlResult["value"],
                    ownership: {
                        ...result.ownership,
                        revision: result.ownership.revision + 1,
                        lifecycle: (args.value as NonNullable<ControlResult["value"]>).resumeUntil ? "MIGRATING" : "ACTIVE",
                        savedAt: now,
                    },
                };
            return structuredClone(result);
        },
    };
    const runtime = new DistributedRoom(
        room.id,
        control,
        (result) => published.push(result),
        () => now,
        () => 0,
    );
    const command = (
        player: string,
        type: "room:join" | "game:start" | "word:success",
    ): Command => ({
        originRevision: runtime.state.revision,
        id: randomUUID(),
        instance: runtime.checkpoint.ownership.instance,
        epoch: runtime.checkpoint.ownership.epoch,
        revision: runtime.state.revision,
        gameId: runtime.state.room.gameId,
        bombId: runtime.state.room.bombs?.find(
            (bomb) => runtime.state.room.users[bomb.holder]?.id === player,
        )?.id,
        turn: runtime.state.room.bombs?.find(
            (bomb) => runtime.state.room.users[bomb.holder]?.id === player,
        )?.turn,
        event:
            type === "room:join"
                ? { type, player: { id: player } }
                : ({ type, playerId: player } as Command["event"]),
    });
    return {
        runtime,
        control,
        now: () => now,
        command,
        published,
        calls,
        advance: (ms: number) => (now += ms),
        fail: (op: string) => (failure = op),
    };
}
test("duplicate transport loss cannot renew a player's first reconnect deadline", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["a", "b", "spectator"]) await f.runtime.connect(id, id);
    for (const id of ["a", "b"]) await f.runtime.command(f.command(id, "room:join"), id);
    await f.runtime.command(f.command("a", "game:start"), "a");
    await f.runtime.disconnect("a", "lobby", 8_000);
    const expires = f.runtime.checkpoint.value!.sessions.a.expires;
    const publications = f.published.length;
    f.advance(19_999);
    await f.runtime.disconnect("a", "lobby", 8_000);
    assert.equal(f.runtime.checkpoint.value!.sessions.a.expires, expires);
    assert.equal(f.published.length, publications, "duplicate loss is not another commit");
    f.advance(1);
    await f.runtime.tick();
    assert.equal(f.runtime.checkpoint.value!.sessions.a, undefined);
    assert.equal(f.runtime.state.room.users.some(p => p.id === "a"), false);
    assert.equal(f.runtime.state.room.isStart, false, "expired participant uses ordinary game cancellation");
});

test("a delayed disconnect for a replaced connection cannot remove the reconnected seat", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a", "old");
    await f.runtime.command(f.command("a", "room:join"), "a");
    // Queue both calls without awaiting: the connection fence must be checked
    // inside the room's serialized mutation, after the replacement commits.
    const reconnect = f.runtime.connect("a", "new");
    const staleClose = f.runtime.disconnect("a", "lobby", 8_000, undefined, "old");
    await reconnect;
    await assert.rejects(staleClose, /replaced/);
    assert.equal(f.runtime.checkpoint.value!.sessions.a.connectionId, "new");
    assert.equal(f.runtime.checkpoint.value!.sessions.a.connected, true);
    assert.deepEqual(f.runtime.state.room.users.map(p => p.id), ["a"]);
    await f.runtime.disconnect("a", "lobby", 8_000, undefined, "new");
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, true);
});

test("an unconfirmed explicit leave must reject after authority halts, so it cannot be ACKed", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.command(f.command("a", "room:join"), "a");
    f.runtime.dispose();
    const before = structuredClone(f.runtime.checkpoint);
    await assert.rejects(f.runtime.leave("a"), /paused/);
    await assert.rejects(f.runtime.closeSession("a", f.runtime.checkpoint.ownership.instance), /paused/);
    assert.deepEqual(f.runtime.checkpoint, before);
});

test("repeated disconnect/reconnect sequences retain one seat and finally delete the room", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (let cycle = 0; cycle < 25; cycle++) {
        await f.runtime.connect("a", String(cycle));
        await f.runtime.command(f.command("a", "room:join"), "a");
        await f.runtime.command(f.command("a", "room:join"), "a");
        assert.deepEqual(f.runtime.state.room.users.map(p => p.id), ["a"]);
        await f.runtime.disconnect("a", false, 8_000);
        f.advance(7_999);
        await f.runtime.connect("a", String(cycle + 1));
        f.advance(2);
        await f.runtime.tick();
        assert.deepEqual(f.runtime.state.room.users.map(p => p.id), ["a"]);
        await f.runtime.leave("a");
        await f.runtime.leave("a");
        assert.deepEqual(f.runtime.state.room.users, []);
    }
    await f.runtime.disconnect("a", "lobby");
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, true);
});
test("unacknowledged commit never publishes or changes local state", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("player");
    const before = structuredClone(f.runtime.state),
        publications = f.published.length;
    f.fail("commit");
    await assert.rejects(
        f.runtime.command(f.command("player", "room:join"), "player"),
        /unreachable/,
    );
    assert.deepEqual(f.runtime.state, before);
    assert.equal(f.published.length, publications);
    assert.equal(f.runtime.halted, true);
    await assert.rejects(f.runtime.connect("other"), /paused/);
});
test("authority confirmation failure stops deadline progression", async () => {
    const f = fixture();
    await f.runtime.open(room);
    const before = f.published.length;
    f.advance(1001);
    f.fail("confirm");
    await assert.rejects(f.runtime.tick(), /unreachable/);
    assert.equal(f.runtime.halted, true);
    assert.equal(f.published.length, before);
});
test("input coalesces per player and unchanged input does not replicate", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    await f.runtime.command(f.command("a", "game:start"), "a");
    f.advance(3001);
    await f.runtime.tick();
    const before = f.calls.filter((op) => op === "commit").length;
    await f.runtime.apply({ type: "currentInput", playerId: "a", input: "a" });
    await f.runtime.apply({ type: "currentInput", playerId: "a", input: "ab" });
    assert.equal(f.calls.filter((op) => op === "commit").length, before);
    f.advance(100);
    await f.runtime.tick();
    assert.equal(f.runtime.state.room.typingFocusInput, "ab");
    const after = f.calls.filter((op) => op === "commit").length;
    await f.runtime.apply({ type: "currentInput", playerId: "a", input: "ab" });
    f.advance(100);
    await f.runtime.tick();
    assert.equal(f.calls.filter((op) => op === "commit").length, after);
});
test("stale/evicted commands cannot poison authority or reapply an old action", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    const command = f.command("a", "room:join");
    command.revision--;
    assert.equal(await f.runtime.command(command, "a"), "retry");
    assert.equal(f.runtime.halted, false);
    command.originRevision = -4097;
    command.revision = f.runtime.state.revision;
    assert.equal(await f.runtime.command(command, "a"), "rejected");
});
test("pause shifts all deadlines together without changing questions, bombs or seats", () => {
    const state: GameState = {
        room: {
            ...room,
            gameId: "same-game",
            users: [{ id: "a" }, { id: "b" }],
            bombs: [
                {
                    id: "same-bomb",
                    holder: 1,
                    status: 3,
                    wordIndex: 0,
                    at: 20_000,
                    turn: 7,
                },
            ],
        },
        revision: 4,
        wordAt: 12_000,
        bombAt: 20_000,
    };
    const restored = resumeDeadlines(state, 30_000);
    assert.equal(restored.wordAt, 42_000);
    assert.equal(restored.bombAt, 50_000);
    assert.equal(restored.room.bombs![0].at, 50_000);
    assert.equal(restored.room.bombs![0].turn, 7);
    assert.equal(restored.room.bombs![0].holder, 1);
    assert.deepEqual(restored.room.users, state.room.users);
    assert.equal(state.bombAt, 20_000);
});
test("distributed mode requires public topology and refuses plaintext public endpoints", () => {
    assert.equal(clusterConfig({}, "socket.io"), null);
    // Former per-node topology values may not silently reenable clustering.
    assert.equal(clusterConfig({
        SERVER_PUBLIC_URL: "https://primary.test",
    }, "socket.io"), null);
    assert.throws(
        () =>
            clusterConfig(
                {
                    PRIMARY_SERVER_URL: "http://primary.test",
                    SERVER_PUBLIC_URL: "http://primary.test",
                    ETB_CLUSTER_CONFIG: JSON.stringify({version:1,servers:["http://primary.test"]}),
                },
                "socket.io",
            ),
        /HTTPS/,
    );
});

test("oversized chunked replication is rejected before control I/O", async () => {
    const request = new Request("https://replica.test/internal/replicate", {
        method: "POST",
        body: "x".repeat(524289),
    });
    await assert.rejects(readLimitedBody(request, 524288), RangeError);
});
test("a finished game outcome survives a lost game:end delivery", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    await f.runtime.command(f.command("a", "game:start"), "a");
    const gameId = f.runtime.state.room.gameId;
    for (let phase = 0; phase < 5; phase++) {
        f.advance(30001);
        await f.runtime.tick();
    }
    const snapshot = f.runtime.snapshot();
    assert.equal(snapshot.isStart, false);
    assert.equal(snapshot.outcome?.gameId, gameId);
    assert.ok(snapshot.outcome?.data.losers?.length);
});

test("explicit distributed leave removes the player and broadcasts before grace expires", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    const before = f.published.length;
    await f.runtime.leave("a");
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b"]);
    assert.equal(f.runtime.checkpoint.value?.sessions.a?.connected, true);
    assert.ok(f.published.length > before);
    await f.runtime.command(f.command("a", "room:join"), "a");
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b", "a"]);
    await f.runtime.leave("a");
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b"]);
});

test("temporary disconnect retains player until grace window expires", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.disconnect("a");
    assert.equal(f.runtime.state.room.users.length, 1);
    f.advance(1000);
    await f.runtime.tick();
    assert.equal(f.runtime.state.room.users.length, 1);
});

test("reliable leave command permits rejoining over the same authenticated session", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    // Model the routed client's retry-stable game:command for room:leave.
    const leave = f.command("a", "room:join");
    leave.event = { type: "room:leave", playerId: "a", reason: "room_leave" };
    assert.equal(await f.runtime.command(leave, "a"), "accepted");
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b"]);
    assert.equal(await f.runtime.command(leave, "a"), "accepted");
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b"]);
    assert.equal(await f.runtime.command(f.command("a", "room:join"), "a"), "accepted");
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b", "a"]);
});

test("Node socket disconnect removes a distributed player immediately and publishes the room", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    const before = f.published.length;
    await f.runtime.disconnect("a", true);
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b"]);
    assert.equal(f.runtime.checkpoint.value?.sessions.a, undefined);
    assert.ok(f.published.length > before);
    // Duplicate disconnects must not remove other players or publish again.
    const after = f.published.length;
    await f.runtime.disconnect("a", true);
    assert.equal(f.published.length, after);
});

test("a disconnected Node player can authenticate again and rejoin", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    await f.runtime.disconnect("a", true);
    await f.runtime.connect("a");
    assert.equal(await f.runtime.command(f.command("a", "room:join"), "a"), "accepted");
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b", "a"]);
});

test("last player disconnect retires the distributed room without a second grace period", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.disconnect("a", true);
    assert.deepEqual(f.runtime.state.room.users, []);
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, true);
    assert.ok(f.calls.includes("delete"));
});

test("last explicit leave retains a room while its socket remains connected", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.leave("a");
    // Avoid narrowing Room.users to never[] in the subsequent rejoin assertion.
    assert.equal(f.runtime.state.room.users.length, 0);
    assert.equal(f.runtime.checkpoint.value?.sessions.a?.connected, true);
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, false);
    // Rejoin without reauthenticating or creating a new room instance.
    const instance = f.runtime.checkpoint.ownership.instance;
    assert.equal(await f.runtime.command(f.command("a", "room:join"), "a"), "accepted");
    assert.deepEqual(f.runtime.state.room.users.map((p) => p.id), ["a"]);
    assert.equal(f.runtime.checkpoint.ownership.instance, instance);
    await f.runtime.leave("a");
    await f.runtime.disconnect("a", false, 8_000);
    f.advance(7_999);
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, false);
    f.advance(2);
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, true);
});

test("empty room is retained until every authenticated socket has disconnected", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("spectator");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.leave("a");
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, false);
    await f.runtime.disconnect("a", false, 8_000);
    f.advance(8_001);
    await f.runtime.tick();
    // A spectator socket is still authenticated and can become a player.
    assert.equal(f.runtime.deleted, false);
    assert.equal(
        await f.runtime.command(f.command("spectator", "room:join"), "spectator"),
        "accepted",
    );
    assert.deepEqual(f.runtime.state.room.users.map((p) => p.id), ["spectator"]);
    await f.runtime.leave("spectator");
    await f.runtime.disconnect("spectator", false, 8_000);
    f.advance(8_001);
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, true);
});

test("connected spectator prevents a temporary player disconnect cancelling a match", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.connect("spectator");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    await f.runtime.command(f.command("a", "game:start"), "a");
    const gameId = f.runtime.state.room.gameId;
    await f.runtime.disconnect("a", false, 8_000);
    await f.runtime.disconnect("b", false, 8_000);
    f.advance(8_001);
    await f.runtime.tick();
    assert.equal(f.runtime.state.room.isStart, true);
    assert.equal(f.runtime.state.room.gameId, gameId);
    assert.deepEqual(f.runtime.state.room.users.map((p) => p.id), ["a", "b"]);
    await f.runtime.connect("a");
    assert.equal(f.runtime.state.room.gameId, gameId);
});

test("fresh empty room keeps the initial grace window until the first participant", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("spectator");
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, false);
});


test("transient Node disconnect preserves an active game and player seat past lobby grace", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    await f.runtime.command(f.command("a", "game:start"), "a");
    const originalGameId = f.runtime.state.room.gameId;
    const seats = f.runtime.state.room.users.map((player) => player.id);
    await f.runtime.disconnect("a", false, 8_000);
    assert.equal(f.runtime.checkpoint.value?.sessions.a?.connected, false);
    f.advance(8_001);
    await f.runtime.tick();
    assert.equal(f.runtime.state.room.isStart, true);
    assert.equal(f.runtime.state.room.gameId, originalGameId);
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), seats);
    await f.runtime.connect("a");
    assert.equal(f.runtime.checkpoint.value?.sessions.a?.connected, true);
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), seats);
});

test("abandoned live-game seat is cleaned when reconnect grace expires", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    await f.runtime.command(f.command("a", "game:start"), "a");
    await f.runtime.disconnect("a", false, 8_000);
    f.advance(19_999);
    await f.runtime.tick();
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["a", "b"]);
    f.advance(2);
    await f.runtime.tick();
    assert.equal(f.runtime.state.room.isStart, false);
    await f.runtime.tick();
    // A living player's expired reconnect grace has the usual leave semantics.
    assert.deepEqual(f.runtime.state.room.users, []);
    assert.equal(f.runtime.checkpoint.value?.sessions.a, undefined);
});

test("briefly disconnected lobby players leave after the Node grace window", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    await f.runtime.disconnect("a", false, 8_000);
    f.advance(7_999);
    await f.runtime.tick();
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["a", "b"]);
    f.advance(2);
    await f.runtime.tick();
    assert.deepEqual(f.runtime.state.room.users.map((player) => player.id), ["b"]);
});


test("Socket.IO lobby disconnect removes a seat and its session immediately", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    const published = f.published.length;

    await f.runtime.disconnect("a", "lobby", 8_000);
    assert.deepEqual(f.runtime.state.room.users.map((user) => user.id), ["b"]);
    assert.equal(f.runtime.checkpoint.value?.sessions.a, undefined);
    assert.equal(f.runtime.checkpoint.value?.sessions.b?.connected, true);
    assert.ok(f.published.length > published, "Other players see the departure promptly");
});

test("an active match is not canceled by the lobby-only immediate disconnect", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.command(f.command("b", "room:join"), "b");
    await f.runtime.command(f.command("a", "game:start"), "a");
    const gameId = f.runtime.state.room.gameId;

    await f.runtime.disconnect("a", "lobby", 8_000);
    assert.equal(f.runtime.state.room.isStart, true);
    assert.equal(f.runtime.state.room.gameId, gameId);
    assert.equal(f.runtime.checkpoint.value?.sessions.a?.connected, false);
    assert.ok(f.runtime.state.room.users.some((user) => user.id === "a"));
    await f.runtime.connect("a");
    assert.equal(f.runtime.checkpoint.value?.sessions.a?.connected, true);
    assert.equal(f.runtime.state.room.gameId, gameId);
});

test("last disconnected lobby player retires its room on the next tick", async () => {
    const f = fixture();
    await f.runtime.open(room);
    await f.runtime.connect("a");
    await f.runtime.command(f.command("a", "room:join"), "a");
    await f.runtime.disconnect("a", "lobby", 8_000);
    assert.deepEqual(f.runtime.state.room.users, []);
    assert.equal(Object.keys(f.runtime.checkpoint.value?.sessions ?? {}).length, 0);
    await f.runtime.tick();
    assert.equal(f.runtime.deleted, true);
});

test("all players disconnect: freeze deadlines and retain seats through recovery grace", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["a", "b"]) {
        await f.runtime.connect(id);
        await f.runtime.command(f.command(id, "room:join"), id);
    }
    await f.runtime.command(f.command("a", "game:start"), "a");
    const gameId = f.runtime.state.room.gameId;
    const wordAt = f.runtime.state.wordAt;
    await f.runtime.disconnect("a", "lobby", 8_000);
    await f.runtime.disconnect("b", "lobby", 8_000);
    f.advance(9_000);
    await f.runtime.tick();
    assert.equal(f.runtime.state.room.isStart, true);
    assert.equal(f.runtime.state.room.gameId, gameId);
    assert.deepEqual(f.runtime.state.room.users.map((p) => p.id), ["a", "b"]);
    assert.ok(f.runtime.checkpoint.value!.resumeUntil);
    await f.runtime.connect("a");
    await f.runtime.connect("b");
    assert.equal(f.runtime.checkpoint.value!.resumeUntil, undefined);
    if (wordAt !== undefined) assert.equal(f.runtime.state.wordAt, wordAt + 9_000);
});

test("a closed game tab expires even while another player remains connected", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["a", "b"]) {
        await f.runtime.connect(id);
        await f.runtime.command(f.command(id, "room:join"), id);
    }
    await f.runtime.command(f.command("a", "game:start"), "a");
    await f.runtime.disconnect("a", "lobby", 8_000);
    f.advance(19_999);
    await f.runtime.tick();
    assert.equal(f.runtime.state.room.isStart, true);
    assert.equal(f.runtime.state.room.users.some((p) => p.id === "a"), true);
    f.advance(2);
    await f.runtime.tick();
    assert.equal(f.runtime.checkpoint.value!.sessions.a, undefined);
    assert.equal(f.runtime.state.room.users.some((p) => p.id === "a"), false);
    assert.equal(f.runtime.checkpoint.value!.sessions.b.connected, true);
    assert.equal(f.runtime.deleted, false);
});

test("a new page session cannot keep the closed page's old name alive past grace", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["old-page", "opponent"]) {
        await f.runtime.connect(id);
        const join = f.command(id, "room:join");
        join.event = { type: "room:join", player: { id, displayName: id === "old-page" ? "Previous name" : "Opponent" } };
        await f.runtime.command(join, id);
    }
    await f.runtime.command(f.command("old-page", "game:start"), "old-page");
    await f.runtime.disconnect("old-page", "lobby", 8_000);
    // A new browser page gets a new session, rather than reviving old-page.
    await f.runtime.connect("new-page");
    f.advance(20_001);
    await f.runtime.tick();
    assert.equal(f.runtime.checkpoint.value!.sessions["old-page"], undefined);
    const join = f.command("new-page", "room:join");
    join.event = { type: "room:join", player: { id: "new-page", displayName: "New name" } };
    await f.runtime.command(join, "new-page");
    assert.deepEqual(f.runtime.snapshot().users.map((user) => user.displayName), ["New name"]);
});

test("an active match does not extend a closed spectator's shorter cleanup deadline", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["a", "b"]) {
        await f.runtime.connect(id);
        await f.runtime.command(f.command(id, "room:join"), id);
    }
    await f.runtime.connect("spectator");
    await f.runtime.command(f.command("a", "game:start"), "a");
    await f.runtime.disconnect("spectator", "lobby", 8_000);
    f.advance(8_001);
    await f.runtime.tick();
    assert.equal(f.runtime.checkpoint.value!.sessions.spectator, undefined);
    assert.equal(f.runtime.state.room.isStart, true);
});


test("reopening an already migrating room preserves the original reconnect deadline", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["a", "b"]) {
        await f.runtime.connect(id);
        await f.runtime.command(f.command(id, "room:join"), id);
    }
    await f.runtime.command(f.command("a", "game:start"), "a");
    await f.runtime.disconnect("a");
    await f.runtime.disconnect("b");
    const deadline = f.runtime.checkpoint.value!.resumeUntil;
    f.advance(5_000);
    const reopened = new DistributedRoom(room.id, f.control, () => {}, f.now);
    await reopened.open();
    assert.equal(reopened.checkpoint.value!.resumeUntil, deadline);
    await reopened.connect("new-page");
    f.advance(15_001);
    await reopened.tick();
    assert.equal(reopened.snapshot().migrating, false);
    assert.equal(reopened.state.room.isStart, false);
});

test("leaving a paused match clears migration wait so a new page can join immediately", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["a", "b"]) {
        await f.runtime.connect(id);
        await f.runtime.command(f.command(id, "room:join"), id);
    }
    await f.runtime.command(f.command("a", "game:start"), "a");
    await f.runtime.disconnect("a");
    await f.runtime.disconnect("b");
    await f.runtime.connect("new-page");
    await f.runtime.leave("a");
    assert.equal(f.runtime.snapshot().migrating, false);
    assert.equal(await f.runtime.command(f.command("new-page", "room:join"), "new-page"), "accepted");
    assert.deepEqual(f.runtime.state.room.users.map((user) => user.id), ["new-page"]);
});

test("restoring an expired migration wait cannot create a fresh grace period", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["a", "b"]) {
        await f.runtime.connect(id);
        await f.runtime.command(f.command(id, "room:join"), id);
    }
    await f.runtime.command(f.command("a", "game:start"), "a");
    await f.runtime.disconnect("a");
    await f.runtime.disconnect("b");
    const deadline = f.runtime.checkpoint.value!.resumeUntil;
    f.advance(20_001);
    const reopened = new DistributedRoom(room.id, f.control, () => {}, f.now);
    await reopened.open();
    assert.equal(reopened.checkpoint.value!.resumeUntil, deadline);
    await reopened.connect("new-page");
    await reopened.tick();
    assert.equal(reopened.snapshot().migrating, false);
    assert.equal(await reopened.command({ ...f.command("new-page", "room:join"),
        instance: reopened.checkpoint.ownership.instance,
        epoch: reopened.checkpoint.ownership.epoch,
        revision: reopened.state.revision, originRevision: reopened.state.revision }, "new-page"), "accepted");
});

test("intentional page exit immediately clears the active seat and session, unlike transport loss", async () => {
    const f = fixture();
    await f.runtime.open(room);
    for (const id of ["a", "b"]) {
        await f.runtime.connect(id, `${id}-old`);
        await f.runtime.command(f.command(id, "room:join"), id);
    }
    await f.runtime.command(f.command("a", "game:start"), "a");
    const instance = f.runtime.checkpoint.ownership.instance;
    await assert.rejects(f.runtime.closeSession("a", "retired-instance"), /Room instance changed/);
    assert.equal(f.runtime.state.room.isStart, true);
    assert.equal(f.runtime.checkpoint.value!.sessions.a.connected, true);
    await f.runtime.connect("a", "a-new");
    await assert.rejects(f.runtime.closeSession("a", instance, "a-old"), /Page session was replaced/);
    assert.equal(f.runtime.state.room.isStart, true);
    await f.runtime.closeSession("a", instance, "a-new");
    assert.equal(f.runtime.state.room.isStart, false);
    assert.equal(f.runtime.state.room.users.some(player => player.id === "a"), false);
    assert.equal(f.runtime.checkpoint.value!.sessions.a, undefined);
    assert.equal(f.runtime.checkpoint.value!.sessions.b.connected, true);
    await f.runtime.closeSession("a", instance); // duplicate unload delivery is harmless
    assert.equal(f.runtime.checkpoint.value!.sessions.b.connected, true);
});
