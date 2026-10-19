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
                        lifecycle: "ACTIVE",
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
        command,
        published,
        calls,
        advance: (ms: number) => (now += ms),
        fail: (op: string) => (failure = op),
    };
}
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
test("distributed mode refuses missing credentials and plaintext public endpoints", () => {
    assert.equal(clusterConfig({}, "socket.io"), null);
    assert.throws(
        () =>
            clusterConfig(
                {
                    PRIMARY_SERVER_URL: "https://primary.test",
                    SERVER_PUBLIC_URL: "https://primary.test",
                },
                "socket.io",
            ),
        /requires/i,
    );
    assert.throws(
        () =>
            clusterConfig(
                {
                    PRIMARY_SERVER_URL: "http://primary.test",
                    SERVER_PUBLIC_URL: "http://primary.test",
                    CLUSTER_SERVER_TOKEN: "token",
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
