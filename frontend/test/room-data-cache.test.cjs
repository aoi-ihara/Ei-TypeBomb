/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const loadUpstashRest = require("./helpers/load-upstash-rest.cjs");

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
    const expirations = new Map();
    let now = 0;
    let unavailable = false;
    let loseBlockResponse = false;
    const get = (key) => {
        if (expirations.has(key) && expirations.get(key) <= now) {
            keys.delete(key);
            expirations.delete(key);
        }
        return keys.get(key) ?? null;
    };
    const put = (key, value, seconds) => {
        keys.set(key, value);
        if (seconds) expirations.set(key, now + seconds);
        else expirations.delete(key);
    };
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
    const runtime = {
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
            if (verb === "GET") return { ok: true, json: async () => ({ result: get(key) }) };
            if (verb === "SET") {
                if (ex === undefined) {
                    keys.set(key, value);
                    return { ok: true, json: async () => ({ result: "OK" }) };
                }
                assert.equal(ex, "EX");
                assert.equal(ttl, Number(env.ROOM_DATA_CACHE_TTL_SECONDS ?? 86400));
                put(key, value, ex === "EX" ? ttl : null);
                return { ok: true, json: async () => ({ result: "OK" }) };
            }
            if (verb === "EVAL") {
                const [, script, count, ...rest] = args;
                const redisKeys = rest.slice(0, count);
                const scriptArgs = rest.slice(count);
                const redisKey = redisKeys[0];
                const current = get(redisKey);
                if (script.includes("local data =")) {
                    assert.equal(count, 1);
                    const generation = current ?? "0";
                    const data = generation.startsWith("blocked:")
                        ? null : get(scriptArgs[0] + generation);
                    return { ok: true, json: async () => ({ result: [generation, data] }) };
                }
                if (script.includes("for index = 1, #KEYS do")) {
                    if (redisKeys.some((cacheKey) => get(cacheKey)?.startsWith("blocked:")))
                        return { ok: true, json: async () => ({ result: 0 }) };
                    assert.equal(scriptArgs[1], 86400 + 60);
                    redisKeys.forEach((cacheKey) => put(cacheKey, scriptArgs[0], scriptArgs[1]));
                    if (loseBlockResponse) {
                        loseBlockResponse = false;
                        unavailable = true;
                        throw Error("Lost Redis response after committing the block");
                    }
                    return { ok: true, json: async () => ({ result: 1 }) };
                }
                if (script.includes("KEYS[2]")) {
                    assert.equal(count, 2);
                    if ((current ?? "0") !== scriptArgs[0])
                        return { ok: true, json: async () => ({ result: 0 }) };
                    put(redisKeys[1], scriptArgs[1], scriptArgs[2]);
                    return { ok: true, json: async () => ({ result: 1 }) };
                }
                if (script.includes("~= ARGV[1]")) {
                    if (current !== scriptArgs[0]) return { ok: true, json: async () => ({ result: 0 }) };
                    put(redisKey, scriptArgs[1]);
                    return { ok: true, json: async () => ({ result: 1 }) };
                }
                if (current?.startsWith("blocked:"))
                    return { ok: true, json: async () => ({ result: 0 }) };
                put(redisKey, scriptArgs[0]);
                return { ok: true, json: async () => ({ result: 1 }) };
            }
            if (verb === "INCR") {
                const next = Number(keys.get(key) ?? "0") + 1;
                keys.set(key, String(next));
                return { ok: true, json: async () => ({ result: next }) };
            }
            throw Error("Unexpected command " + verb);
        },
        AbortSignal, console,
    };
    vm.runInNewContext(compiled, {
        ...runtime,
        exports: exported,
        require(id) {
            if (id === "server-only") return {};
            if (id === "./upstash-rest") return loadUpstashRest(runtime);
            if (id === "node:crypto") return require("node:crypto");
            if (id === "next/navigation") return {
                unstable_rethrow(error) {
                    if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
                },
            };
            if (id === "@/lib/server-console")
                return { serverError: (message) => errors.push(message) };
            throw Error("Unexpected dependency " + id);
        },
    });
    return { cache: exported, keys, commands, source, errors,
        setUnavailable(value) { unavailable = value; },
        loseNextBlockResponse() { loseBlockResponse = true; },
        advanceSeconds(value) { now += value; },
        seedCacheWithTTL(key, value, seconds) { put(key, value, seconds); } };
}

test("room cache stores only public/unlisted source fields, never passwords", async () => {
    const f = fixture();
    const first = await f.cache.readRoomDataCache("slug-a");
    assert.equal(first.status, "miss");
    assert.equal(f.commands.length, 1, "one Redis HTTP request per read");
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
    const key = f.commands.find((c) => c[0] === "EVAL" && c[1].includes("KEYS[2]"))[4];
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
    assert.notEqual(a.commands[0][3], b.commands[0][3]);
});

test("blocking prior to a privacy change bypasses stale data until invalidated", async () => {
    const f = fixture();
    const first = await f.cache.readRoomDataCache("slug-a");
    await f.cache.writeRoomDataCache("slug-a", f.source, first.generation);
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "hit");
    const fence = await f.cache.blockRoomDataCache("slug-a");
    const blocked = await f.cache.readRoomDataCache("slug-a");
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.room, null);
    assert.equal(blocked.generation, null);
    await f.cache.invalidateRoomDataCache("slug-a");
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "blocked");
    await f.cache.releaseRoomDataCache(fence, "slug-a");
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "miss");
});

test("a cache outage refuses privacy revocation while allowing DB fallback reads", async () => {
    const f = fixture();
    f.setUnavailable(true);
    await assert.rejects(f.cache.blockRoomDataCache("slug-a"), /protection is unavailable/);
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "unavailable");
});

test("overlapping edit cannot clear another mutation's active privacy fence", async () => {
    const f = fixture();
    const first = await f.cache.readRoomDataCache("slug-a");
    await f.cache.writeRoomDataCache("slug-a", f.source, first.generation);
    const fence = await f.cache.blockRoomDataCache("slug-a");
    await f.cache.invalidateRoomDataCache("slug-a");
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "blocked");
    await assert.rejects(f.cache.blockRoomDataCache("slug-a"), /protection is unavailable/);
    await f.cache.releaseRoomDataCache("blocked:another-mutation", "slug-a");
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "blocked");
    await f.cache.releaseRoomDataCache(fence, "slug-a");
    assert.equal((await f.cache.readRoomDataCache("slug-a")).status, "miss");
});

test("fencing multiple aliases is atomic when an alias is already blocked", async () => {
    const f = fixture();
    const firstToken = await f.cache.blockRoomDataCache("room-a", "old-alias");
    await assert.rejects(
        f.cache.blockRoomDataCache("new-alias", "old-alias"),
        /protection is unavailable/,
    );
    assert.equal((await f.cache.readRoomDataCache("new-alias")).status, "miss");
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "blocked");
    await f.cache.releaseRoomDataCache(firstToken, "room-a", "old-alias");
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "miss");
});

test("a lost block response cannot strand a permanent fence or restore stale data", async () => {
    const f = fixture();
    const original = await f.cache.readRoomDataCache("old-alias");
    await f.cache.writeRoomDataCache("old-alias", f.source, original.generation);
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "hit");

    f.loseNextBlockResponse();
    await assert.rejects(
        f.cache.blockRoomDataCache("room-a", "old-alias"),
        /protection is unavailable/,
    );
    // The block succeeded in Redis, but its response was lost and recovery
    // could not connect. Reads stay fail-closed until TTL expiry.
    f.setUnavailable(false);
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "blocked");
    assert.equal((await f.cache.readRoomDataCache("room-a")).status, "blocked");

    // A delayed write from before the block cannot revive old contents.
    await f.cache.writeRoomDataCache("old-alias", f.source, original.generation);
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "blocked");

    f.advanceSeconds(86400 + 61);
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "miss");
    assert.equal((await f.cache.readRoomDataCache("room-a")).status, "miss");
    const retry = await f.cache.blockRoomDataCache("room-a", "old-alias");
    await f.cache.releaseRoomDataCache(retry, "room-a", "old-alias");
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "miss");
});

test("shortening room-data TTL never releases a fence before old 24h payloads expire", async () => {
    const f = fixture({ ROOM_DATA_CACHE_TTL_SECONDS: "60" });
    const read = await f.cache.readRoomDataCache("old-alias");
    assert.equal(read.status, "miss");
    const readCommand = f.commands.at(-1);
    // A prior deployment sharing this namespace wrote with the maximum TTL.
    // This data must be inaccessible while a privacy fence can expire.
    f.seedCacheWithTTL(readCommand[4] + read.generation, JSON.stringify(f.source), 86400);
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "hit");

    f.loseNextBlockResponse();
    await assert.rejects(f.cache.blockRoomDataCache("room-a", "old-alias"),
        /protection is unavailable/);
    f.setUnavailable(false);

    f.advanceSeconds(121); // Longer than 60s configured cache TTL + 60s.
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "blocked");
    assert.equal((await f.cache.readRoomDataCache("room-a")).status, "blocked");

    // Even an unreleased orphan eventually recovers, but only after the
    // older maximum-TTL payload has definitely expired in Redis.
    f.advanceSeconds(86400 - 121 + 61);
    assert.equal((await f.cache.readRoomDataCache("old-alias")).status, "miss");
    assert.equal((await f.cache.readRoomDataCache("room-a")).status, "miss");
});
