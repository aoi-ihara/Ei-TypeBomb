/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const loadUpstashRest = require("./helpers/load-upstash-rest.cjs");

const filename = path.join(__dirname, "../lib/room/public-rooms-cache.ts");
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
    let unavailable = false;
    let dynamicBailout = false;
    const errors = [];
    const source = {
        id: "public-room",
        title: "Public",
        visibility: "public",
        items: [],
        itemCount: 24,
        maxPlayers: 2,
    };

    const mockedFetch = async (_url, options) => {
        if (dynamicBailout) {
            const error = new Error("Next.js dynamic server usage");
            error.digest = "DYNAMIC_SERVER_USAGE";
            throw error;
        }
        if (unavailable) throw new Error("Upstash offline");
        assert.equal(options.headers.Authorization, "Bearer test-secret");
        assert.equal(options.cache, "no-store");

        const args = JSON.parse(options.body);
        commands.push(args);
        const [operation, key, value, flag, ttl] = args;
        let result;
        switch (operation) {
            case "GET":
                result = keys.get(key) ?? null;
                break;
            case "EVAL": {
                assert.equal(value, 1);
                const generation = String(keys.get(flag) ?? "0");
                result = [generation, keys.get(ttl + generation) ?? null];
                break;
            }
            case "SET":
                assert.equal(flag, "EX");
                assert.equal(ttl, Number(env.PUBLIC_ROOM_CACHE_TTL_SECONDS ?? 3600));
                keys.set(key, value);
                result = "OK";
                break;
            case "INCR":
                result = Number(keys.get(key) ?? "0") + 1;
                keys.set(key, String(result));
                break;
            default:
                throw new Error("Unexpected Redis command: " + operation);
        }
        return { ok: true, json: async () => ({ result }) };
    };

    const exported = {};
    const runtime = {
        process: {
            env: {
                UPSTASH_REDIS_REST_URL: "https://cache.example",
                UPSTASH_REDIS_REST_TOKEN: "test-secret",
                NODE_ENV: "test",
                ...env,
            },
        },
        fetch: mockedFetch,
        AbortSignal,
        console,
    };
    vm.runInNewContext(compiled, {
        ...runtime,
        exports: exported,
        require(id) {
            if (id === "server-only") return {};
            if (id === "./upstash-rest") return loadUpstashRest(runtime);
            if (id === "next/navigation") return {
                unstable_rethrow(error) {
                    if (error?.digest === "DYNAMIC_SERVER_USAGE") throw error;
                },
            };
            if (id === "@/lib/server-console")
                return { serverError: (message) => errors.push(message) };
            throw new Error("Unexpected dependency: " + id);
        },
    });

    return {
        cache: exported,
        keys,
        commands,
        errors,
        source,
        setUnavailable(value) { unavailable = value; },
        setDynamicBailout(value) { dynamicBailout = value; },
    };
}

test("cache miss, write and hit return only public summary fields", async () => {
    const f = fixture();
    const first = await f.cache.readPublicRoomsCache();
    assert.equal(first.status, "miss");
    assert.equal(first.generation, "0");
    assert.equal(f.commands.length, 1, "one Redis HTTP request per read");

    await f.cache.writePublicRoomsCache([{ ...f.source, extraSecret: "excluded" }], first.generation);
    const second = await f.cache.readPublicRoomsCache();
    assert.equal(second.status, "hit");
    assert.equal(second.rooms.length, 1);
    assert.equal(second.rooms[0].title, "Public");
    assert.equal(second.rooms[0].extraSecret, undefined);
    assert.deepEqual(Array.from(second.rooms[0].items), []);
});

test("invalidations use generations to prevent late writes from reviving stale lists", async () => {
    const f = fixture();
    const old = await f.cache.readPublicRoomsCache();
    await f.cache.invalidatePublicRoomsCache();
    await f.cache.writePublicRoomsCache([f.source], old.generation);

    const next = await f.cache.readPublicRoomsCache();
    assert.equal(next.status, "miss");
    assert.equal(next.generation, "1");
    await f.cache.writePublicRoomsCache([{ ...f.source, title: "New" }], next.generation);
    assert.equal((await f.cache.readPublicRoomsCache()).rooms[0].title, "New");
});

test("private or item-bearing data is never served from the shared list cache", async () => {
    const f = fixture();
    const read = await f.cache.readPublicRoomsCache();
    await f.cache.writePublicRoomsCache([{ ...f.source, visibility: "private" }], read.generation);
    assert.equal((await f.cache.readPublicRoomsCache()).status, "miss");

    await f.cache.writePublicRoomsCache([f.source], read.generation);
    const key = f.commands.find((args) => args[0] === "SET")[1];
    f.keys.set(key, JSON.stringify([{ ...f.source, items: [{ answer: "private" }] }]));
    assert.equal((await f.cache.readPublicRoomsCache()).status, "unavailable");
});

test("Redis failure and missing configuration do not break Supabase fallback", async () => {
    const f = fixture();
    f.setUnavailable(true);
    const result = await f.cache.readPublicRoomsCache();
    assert.equal(result.status, "unavailable");
    await f.cache.writePublicRoomsCache([f.source], result.generation);
    await f.cache.invalidatePublicRoomsCache();
    assert.ok(f.errors.length > 0);

    const disabled = fixture({
        UPSTASH_REDIS_REST_URL: "",
        UPSTASH_REDIS_REST_TOKEN: "",
    });
    assert.equal((await disabled.cache.readPublicRoomsCache()).status, "disabled");
    await disabled.cache.invalidatePublicRoomsCache();
    assert.equal(disabled.commands.length, 0);
});

test("cache namespaces separate preview and production deployments", async () => {
    const production = fixture({ VERCEL_ENV: "production" });
    const preview = fixture({
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/cache",
    });
    await production.cache.readPublicRoomsCache();
    await preview.cache.readPublicRoomsCache();

    const productionKey = production.commands[0][3];
    const previewKey = preview.commands[0][3];
    assert.notEqual(productionKey, previewKey);
    assert.ok(previewKey.includes("feature%2Fcache"));
});

test("Next.js dynamic-rendering bailout is rethrown, not logged as Redis failure", async () => {
    const f = fixture();
    f.setDynamicBailout(true);
    await assert.rejects(
        f.cache.readPublicRoomsCache(),
        (error) => error.digest === "DYNAMIC_SERVER_USAGE",
    );
    await assert.rejects(
        f.cache.writePublicRoomsCache([f.source], "0"),
        (error) => error.digest === "DYNAMIC_SERVER_USAGE",
    );
    await assert.rejects(
        f.cache.invalidatePublicRoomsCache(),
        (error) => error.digest === "DYNAMIC_SERVER_USAGE",
    );
    assert.deepEqual(f.errors, []);
});

test("configured TTL overrides the one-hour default", async () => {
    const f = fixture({ PUBLIC_ROOM_CACHE_TTL_SECONDS: "7200" });
    const first = await f.cache.readPublicRoomsCache();
    await f.cache.writePublicRoomsCache([f.source], first.generation);
    assert.equal(f.commands.find((args) => args[0] === "SET")[4], 7200);
});
