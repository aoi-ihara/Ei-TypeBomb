/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const filename = path.join(__dirname, "../lib/room/room-data-cache.ts");
const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
    },
}).outputText;

function fixture(env = {}) {
    const keys = new Map();
    const commands = [];
    const errors = [];
    let unavailable = false;
    const source = {
        id: "room-a",
        link: "slug-a",
        title: "Test",
        user_id: "owner",
        explanation: null,
        max_players: 2,
        bomb_count: null,
        created_at: null,
        updated_at: null,
        items: [{ id: "word", prompt: "hello", answer: "こんにちは" }],
        game_duration: 2,
        visibility: "public",
    };

    const exported = {};
    vm.runInNewContext(compiled, {
        exports: exported,
        require(id) {
            if (id === "server-only") return {};
            if (id === "next/navigation") return {
                unstable_rethrow(error) {
                    if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
                },
            };
            if (id === "@/lib/server-console")
                return { serverError: (message) => errors.push(message) };
            throw Error("Unexpected dependency " + id);
        },
        process: { env: {
            UPSTASH_REDIS_REST_URL: "https://cache.example",
            UPSTASH_REDIS_REST_TOKEN: "secret",
            NODE_ENV: "test",
            ...env,
        } },
        fetch: async (_url, options) => {
            if (unavailable) throw Error("Redis offline");
            assert.equal(options.cache, "no-store");
            assert.equal(options.headers.Authorization, "Bearer secret");
            const args = JSON.parse(options.body);
            commands.push(args);
            const [verb, key, value, ex, ttl] = args;
            if (verb === "GET") return { ok: true, json: async () => ({ result: keys.get(key) ?? null }) };
            if (verb === "SET") {
                assert.equal(ex, "EX");
                assert.equal(ttl, Number(env.ROOM_DATA_CACHE_TTL_SECONDS ?? 86400));
                keys.set(key, value);
                return { ok: true, json: async () => ({ result: "OK" }) };
            }
            if (verb === "INCR") {
                const next = Number(keys.get(key) ?? "0") + 1;
                keys.set(key, String(next));
                return { ok: true, json: async () => ({ result: next }) };
            }
            throw Error("Unexpected command " + verb);
        },
        AbortSignal, console,
    });
    return { cache: exported, keys, commands, source, errors,
        setUnavailable(value) { unavailable = value; } };
}

test("room cache stores only public/unlisted source fields, never passwords", async () => {
    const f = fixture();
    const first = await f.cache.readRoomDataCache("slug-a");
    assert.equal(first.status, "miss");
    await f.cache.writeRoomDataCache("slug-a", {
        ...f.source,
        password: "must-not-cache",
        authorized: true,
        isOwner: true,
    }, first.generation);
    const next = await f.cache.readRoomDataCache("slug-a");
    assert.equal(next.status, "hit");
    assert.equal(next.room.title, "Test");
    assert.equal(next.room.items[0].answer, "こんにちは");
    assert.equal(next.room.password, undefined);
    assert.equal(next.room.authorized, undefined);
    assert.equal(next.room.isOwner, undefined);
});

test("private room entries are never cached or accepted from Redis", async () => {
    const f = fixture();
    const initial = await f.cache.readRoomDataCache("slug-a");
    await f.cache.writeRoomDataCache("slug-a",
        { ...f.source, visibility: "private" }, initial.generation);
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "miss");
    await f.cache.writeRoomDataCache("slug-a", f.source, initial.generation);
    const key = f.commands.find((c) => c[0] === "SET")[1];
    f.keys.set(key, JSON.stringify({ ...f.source, visibility: "private" }));
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "unavailable");
});

test("invalidation fences delayed writes and affects only selected aliases", async () => {
    const f = fixture();
    const before = await f.cache.readRoomDataCache("old-slug");
    const independent = await f.cache.readRoomDataCache("another-slug");
    await f.cache.writeRoomDataCache("another-slug", f.source, independent.generation);
    await f.cache.invalidateRoomDataCache("room-a", "old-slug", "new-slug");
    await f.cache.writeRoomDataCache("old-slug", f.source, before.generation);
    assert.equal((await f.cache.readRoomDataCache("old-slug")).status, "miss");
    assert.equal((await f.cache.readRoomDataCache("new-slug")).status, "miss");
    assert.equal((await f.cache.readRoomDataCache("another-slug")).status, "hit");
});

test("cache is optional, falls back on errors, and supports TTL override", async () => {
    const f = fixture({ ROOM_DATA_CACHE_TTL_SECONDS: "3600" });
    const initial = await f.cache.readRoomDataCache("slug-a");
    await f.cache.writeRoomDataCache("slug-a", f.source, initial.generation);
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "hit");
    f.setUnavailable(true);
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "unavailable");
    await f.cache.invalidateRoomDataCache("slug-a");
    assert.ok(f.errors.length > 0);
    const disabled = fixture({
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
    });
    assert.equal((await disabled.cache.readRoomDataCache("slug-a")).status, "disabled");
    await disabled.cache.writeRoomDataCache("slug-a", disabled.source, "0");
    assert.equal(disabled.commands.length, 0);
});

test("namespaces keep unrelated deployments apart", async () => {
    const a = fixture({ VERCEL_ENV: "production" });
    const b = fixture({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "example" });
    await a.cache.readRoomDataCache("slug-a");
    await b.cache.readRoomDataCache("slug-a");
    assert.notEqual(a.commands[0][1], b.commands[0][1]);
});
