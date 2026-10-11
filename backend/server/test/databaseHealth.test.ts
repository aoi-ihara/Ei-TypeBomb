import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient, QueryResult } from "pg";
import {
    DATABASE_HEALTH_TIMEOUT_MS,
    probeRoomDatabase,
} from "../src/lib/databaseHealth";

const result: QueryResult<never> = { rows: [], rowCount: 0 };

const createDatabase = (failSelect = false) => {
    const queries: string[] = [];
    let released = false;
    const client: PoolClient = {
        async query(text) {
            queries.push(text);
            if (failSelect && text.startsWith("SELECT")) {
                throw new Error("statement timeout");
            }
            return result;
        },
        release() {
            released = true;
        },
    };
    const database = { connect: async () => client } as Pool;

    return { database, queries, wasReleased: () => released };
};

test("database probe applies a server-side statement timeout", async () => {
    const probe = createDatabase();

    await probeRoomDatabase(probe.database);

    assert.deepEqual(probe.queries, [
        "BEGIN",
        `SET LOCAL statement_timeout = ${DATABASE_HEALTH_TIMEOUT_MS}`,
        "SELECT id FROM public.ei_typebomb_rooms LIMIT 1",
        "ROLLBACK",
    ]);
    assert.equal(probe.wasReleased(), true);
    assert.ok(DATABASE_HEALTH_TIMEOUT_MS < 7_000);
});

test("database probe releases its connection after a timed-out statement", async () => {
    const probe = createDatabase(true);

    await assert.rejects(
        probeRoomDatabase(probe.database),
        /statement timeout/,
    );

    assert.equal(probe.queries.at(-1), "ROLLBACK");
    assert.equal(probe.wasReleased(), true);
});
