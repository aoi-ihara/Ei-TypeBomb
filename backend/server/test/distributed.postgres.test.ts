import { signReplication } from "../../shared/distributed/serverJwt";
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { DistributedRoom } from "../../shared/distributed/runtime";
import {
    Replicator,
    receiveReplica,
} from "../../shared/distributed/replication";
import type {
    Control,
    ControlResult,
    Command,
} from "../../shared/distributed/types";
import type { Room } from "../../shared/types";

const database = process.env.ETB_TEST_DATABASE_URL;
// Dedicated disposable database ONLY. The suite deliberately drops etb_private.
test(
    "PostgreSQL authority: ordered failover, durable events, fencing and lifecycle",
    { skip: !database },
    async (t) => {
        const pool = new pg.Pool({ connectionString: database });
        t.after(() => pool.end());
        await pool.query(
            "drop function if exists public.etb_cluster(text,text,text,jsonb); drop schema if exists etb_private cascade",
        );
        await pool.query(
            await readFile(
                resolve(
                    __dirname,
                    "../../../supabase/migrations/20261018142210_distributed_room_control.sql",
                ),
                "utf8",
            ),
        );
        const ids = [
            "https://primary.test",
            "https://worker.test",
            "https://render.test",
            "https://extra.test",
        ];
        const tokens = ids.map(() => randomUUID() + randomUUID());
        for (let i = 0; i < 3; i++)
            await pool.query(
                "insert into etb_private.servers(id,token_hash,parent,depth,transport) values($1,sha256(convert_to($2,'UTF8')),$3,$4,$5)",
                [
                    ids[i],
                    tokens[i],
                    ids[i - 1] ?? null,
                    i,
                    i === 1 ? "websocket" : "socket.io",
                ],
            );
        const control = (i: number): Control => ({
            async call(operation, args = {}) {
                const result = await pool.query(
                    "select public.etb_cluster($1,$2,$3,$4) value",
                    [ids[i], tokens[i], operation, args],
                );
                return result.rows[0].value as ControlResult;
            },
        });
        const register = (i: number) =>
            control(i).call("register", {
                id: ids[i],
                parent: ids[i - 1] ?? null,
                primary: ids[0],
                transport: i === 1 ? "websocket" : "socket.io",
            });
        await Promise.all([0, 1, 2].map(register));
        const roomId = randomUUID();
        const room: Room = {
            id: roomId,
            items: [
                {
                    id: "q1",
                    type: "typed_recall",
                    prompt: "one",
                    answer: "one",
                },
                {
                    id: "q2",
                    type: "typed_recall",
                    prompt: "two",
                    answer: "two",
                },
            ],
            users: [],
            maxPlayers: 6,
            gameDuration: 20,
            isStart: false,
            bombHolder: 0,
            bombStatus: 0,
        };
        let time = Date.now();
        const broadcasts: unknown[] = [];
        const make = (i: number) =>
            new DistributedRoom(
                roomId,
                control(i),
                (result) => broadcasts.push(result),
                async () => {},
                () => time,
                () => 0,
            );
        const p = make(0);
        await t.test("1 new rooms use the healthy primary", async () => {
            await assert.rejects(make(1).open(room), /Higher server/);
            await p.open(room);
            assert.equal(p.checkpoint.ownership.owner, ids[0]);
        });
        const a = randomUUID(),
            b = randomUUID();
        const command = (
            runtime: DistributedRoom,
            player: string,
            type: Command["event"]["type"],
            id = randomUUID(),
        ): Command => ({
            originRevision: runtime.checkpoint.ownership.revision,
            id,
            instance: runtime.checkpoint.ownership.instance,
            epoch: runtime.checkpoint.ownership.epoch,
            revision: runtime.checkpoint.ownership.revision,
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
        await p.connect(a);
        await p.connect(b);
        await p.command(command(p, a, "room:join"), a);
        await p.command(command(p, b, "room:join"), b);
        await p.command(command(p, a, "game:start"), a);
        time += 3_001;
        await p.tick(); // Finish countdown using injectable game clock.
        const gameId = p.state.room.gameId;
        const initialSeats = p.state.room.users;
        const answer = command(p, a, "word:success");
        await t.test(
            "8 correct-answer/bomb transfer is durable before publication",
            async () => {
                await p.command(answer, a);
                const saved = await control(1).call("read", { roomId });
                assert.equal(saved.value!.game.room.bombs![0].holder, 1);
                assert.equal(saved.value!.game.room.bombs![0].turn, 1);
                assert.ok(broadcasts.length);
            },
        );
        await t.test(
            "9 duplicate event IDs cannot transfer the bomb twice",
            async () => {
                const rev = p.state.revision;
                assert.equal(await p.command(answer, a), "accepted");
                assert.equal(p.state.revision, rev);
            },
        );
        const before = structuredClone(p.state);
        await pool.query(
            "update etb_private.ownership set lease_until=clock_timestamp()-interval '1 second' where room_id=$1",
            [roomId],
        );
        const secondary = make(1);
        await t.test(
            "2 primary crash restores the same game and pauses deadlines",
            async () => {
                time += 5_000;
                await secondary.open();
                assert.equal(secondary.state.room.gameId, gameId);
                assert.deepEqual(secondary.state.room.users, initialSeats);
                assert.equal(
                    secondary.state.room.bombs![0].holder,
                    before.room.bombs![0].holder,
                );
                assert.equal(
                    secondary.checkpoint.ownership.epoch,
                    p.checkpoint.ownership.epoch + 1,
                );
                assert.ok(
                    secondary.state.room.bombs![0].at >
                        before.room.bombs![0].at,
                );
                await secondary.connect(a);
                await secondary.connect(b);
                assert.equal(
                    secondary.checkpoint.value!.resumeUntil,
                    undefined,
                );
            },
        );
        await t.test(
            "3,10 primary recovery never reclaims the migrated game or commits old epoch",
            async () => {
                await register(0);
                await assert.rejects(make(0).open(), /failback/);
                await assert.rejects(
                    p.command(command(p, b, "word:success"), b),
                    /Fenced/,
                );
                assert.equal(p.halted, true);
                assert.equal(
                    (await control(0).call("read", { roomId })).ownership.owner,
                    ids[1],
                );
            },
        );
        await t.test("4 new rooms still choose recovered primary", async () => {
            const newId = randomUUID();
            const fresh = new DistributedRoom(
                newId,
                control(0),
                () => {},
                async () => {},
                () => time,
            );
            await fresh.open({ ...room, id: newId });
            assert.equal(fresh.checkpoint.ownership.owner, ids[0]);
        });
        await t.test(
            "6,7 stable sessions survive new transports and separate tabs remain distinct",
            async () => {
                await secondary.disconnect(a);
                await secondary.connect(a);
                assert.equal(
                    secondary.state.room.users.filter((user) => user.id === a)
                        .length,
                    1,
                );
                assert.notEqual(a, b);
                assert.equal(
                    Object.keys(secondary.checkpoint.value!.sessions).length,
                    2,
                );
            },
        );
        await t.test(
            "12 provision another Node server without interrupting a room",
            async () => {
                const before = secondary.state.revision;
                await pool.query(
                    "insert into etb_private.servers(id,token_hash,parent,depth,transport) values($1,sha256(convert_to($2,'UTF8')),$3,3,'socket.io')",
                    [ids[3], tokens[3], ids[2]],
                );
                await register(3);
                assert.equal(
                    (await control(1).call("read", { roomId })).servers.length,
                    4,
                );
                assert.equal(secondary.state.revision, before);
            },
        );
        let tertiary: DistributedRoom;
        await t.test(
            "5,13 secondary failure and concurrent lower claims have one winner",
            async () => {
                await pool.query(
                    "update etb_private.ownership set lease_until=clock_timestamp()-interval '1 second' where room_id=$1",
                    [roomId],
                );
                const third = make(2),
                    fourth = make(3);
                const results = await Promise.allSettled([
                    third.open(),
                    fourth.open(),
                ]);
                assert.equal(
                    results.filter((result) => result.status === "fulfilled")
                        .length,
                    1,
                );
                tertiary = results[0].status === "fulfilled" ? third : fourth;
                assert.equal(tertiary.state.room.gameId, gameId);
                const own = tertiary.checkpoint.ownership;
                await assert.rejects(
                    control(1).call("commit", {
                        roomId,
                        instance: own.instance,
                        epoch: own.epoch - 1,
                        revision: own.revision,
                        value: tertiary.checkpoint.value,
                    }),
                    /Fenced/,
                );
                await tertiary.connect(a);
                await tertiary.connect(b);
            },
        );
        await t.test(
            "14 forged server registration and replication are rejected",
            async () => {
                await assert.rejects(
                    pool.query(
                        "select public.etb_cluster($1,'wrong','register','{}')",
                        [ids[0]],
                    ),
                    /capability/,
                );
                await assert.rejects(
                    control(2).call("register", {
                        id: ids[2],
                        parent: ids[0],
                        primary: ids[0],
                        transport: "socket.io",
                    }),
                    /topology/,
                );
                const request = new Request(
                    "https://worker.test/internal/replicate",
                    {
                        method: "POST",
                        body: JSON.stringify({ roomId, receipt: randomUUID() }),
                    },
                );
                assert.equal(
                    (
                        await receiveReplica(request, control(2), async () =>
                            assert.fail(),
                        )
                    ).status,
                    403,
                );
                const client = await pool.connect();
                try {
                    await client.query("set role anon");
                    await assert.rejects(
                        client.query("select * from etb_private.checkpoints"),
                        /permission/,
                    );
                } finally {
                    await client.query("reset role");
                    client.release();
                }
            },
        );
        await t.test(
            "11 deletion tombstones prevent old snapshots from resurrecting",
            async () => {
                const runtime = tertiary!;
                const stale = structuredClone(runtime.checkpoint);
                await runtime.command(command(runtime, a, "room:leave"), a);
                await runtime.disconnect(a);
                await runtime.disconnect(b);
                time += 20_001;
                await runtime.tick();
                assert.equal(runtime.deleted, true);
                const own = stale.ownership;
                const i = ids.indexOf(own.owner);
                await assert.rejects(
                    control(i).call("commit", {
                        roomId,
                        instance: own.instance,
                        epoch: own.epoch,
                        revision: own.revision,
                        value: stale.value,
                    }),
                    /Fenced/,
                );
                assert.equal(
                    (await control(i).call("read", { roomId })).value,
                    null,
                );
                const peer = ids.indexOf(own.owner) + 1;
                if (peer < ids.length)
                    await assert.rejects(
                        control(peer).call("receive", {
                            roomId,
                            receipt: stale.receipt,
                            jwt: await signReplication(
                                tokens[i],
                                ids[i],
                                ids[peer],
                                stale.ownership,
                            ),
                        }),
                        /sender JWT|receipt/,
                    );
                const recreated = new DistributedRoom(
                    roomId,
                    control(0),
                    () => {},
                    async () => {},
                    () => time,
                );
                await recreated.open(room);
                assert.notEqual(
                    recreated.checkpoint.ownership.instance,
                    own.instance,
                );
            },
        );
        await t.test(
            "replication reaches every downstream directly and repairs a revision gap",
            async () => {
                const read = await control(0).call("read", { roomId });
                const targets: string[] = [];
                let stored = 0;
                const replicator = new Replicator(
                    ids[0],
                    tokens[0],
                    async (input, init) => {
                        targets.push(String(input));
                        const peer = ids.findIndex((id) =>
                            String(input).startsWith(id),
                        );
                        return receiveReplica(
                            new Request(String(input), init),
                            control(peer),
                            async (checkpoint) => {
                                stored++;
                                assert.equal(
                                    checkpoint.ownership.instance,
                                    read.ownership.instance,
                                );
                            },
                        );
                    },
                );
                await replicator.send(read, true);
                assert.equal(targets.length, 3);
                assert.equal(stored, 3);
                const proof = await signReplication(
                    tokens[0],
                    ids[0],
                    ids[1],
                    read.ownership,
                );
                await control(1).call("receive", {
                    roomId,
                    receipt: read.receipt,
                    jwt: proof,
                });
                await assert.rejects(
                    control(2).call("receive", {
                        roomId,
                        receipt: read.receipt,
                        jwt: proof,
                    }),
                    /sender JWT/,
                );
                await assert.rejects(
                    control(1).call("receive", {
                        roomId,
                        receipt: read.receipt,
                        jwt: await signReplication(
                            tokens[1],
                            ids[0],
                            ids[1],
                            read.ownership,
                        ),
                    }),
                    /sender JWT/,
                );
                const anon = await pool.connect();
                try {
                    await anon.query("set role anon");
                    await anon.query(
                        "select public.etb_cluster($1,$2,'read',$3)",
                        [ids[0], tokens[0], { roomId }],
                    );
                    await assert.rejects(
                        anon.query(
                            "select public.etb_cluster($1,'forged','read',$2)",
                            [ids[0], { roomId }],
                        ),
                        /capability/,
                    );
                } finally {
                    await anon.query("reset role");
                    anon.release();
                }

                assert.ok(targets.some((url) => url.startsWith(ids[2])));
            },
        );
    },
);
