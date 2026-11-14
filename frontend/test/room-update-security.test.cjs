/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function load(file, dependencies, globals = {}) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(
        readFileSync(path.join(__dirname, "..", file), "utf8"),
        { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
    ).outputText, {
        exports, console, ...globals,
        require(id) {
            if (!(id in dependencies)) throw Error(`Unexpected dependency ${id}`);
            return dependencies[id];
        },
    });
    return exports;
}

function editor({ user = "owner", owner = "owner", version = 3, busy = false,
    race = false, lookupError = false } = {}) {
    const calls = [], writes = [];
    let filters = {}, writing = false;
    const db = { from() {
        filters = {}; writing = false;
        const query = {
            select() { return query; },
            eq(key, value) { filters[key] = value; return query; },
            update(data) { writing = true; writes.push({ ...data }); return query; },
            async maybeSingle() {
                calls.push(writing ? "write" : "lookup");
                if (writing) {
                    assert.equal(filters.user_id, "owner");
                    assert.equal(filters.edit_version, 3);
                    return { data: race ? null : { id: "room", edit_version: 4 } };
                }
                return { data: filters.id === "room" && filters.user_id === owner
                    ? { id: "room", items: [], edit_version: version } : null,
                    error: lookupError ? Error("database unavailable") : null };
            },
        };
        return query;
    } };
    const prepared = load("lib/room/prepare-update.ts", {
        "./readings": { prepareItemReadings: async (items) => items },
    });
    const validators = load("lib/auth/validator.ts", {
        "../room/item-limits.mjs": require("../lib/room/item-limits.mjs"),
    });
    const partial = load("lib/room/partial-update.ts", {
        "./item-limits.mjs": require("../lib/room/item-limits.mjs"),
        "../auth/validator": validators,
    });
    const action = load("lib/room/update.ts", {
        "./prepare-update": prepared,
        "./partial-update": partial,
        "./revalidate": { revalidateRoomContent() { calls.push("revalidate"); } },
        "./get": { invalidatePublicRooms: async () => calls.push("invalidate") },
        "@/lib/auth/sign-in-url": { getSignInUrl: () => "/sign-in" },
        "../db/server": { createAdminClient: async () => db },
        "../auth/session": { getUser: async () => { calls.push("auth"); return user; } },
        "next/navigation": { redirect() { throw Error("redirect"); } },
        "../auth/hash": { hashPassword: async (password) => {
            calls.push("hash");
            assert.equal(password, "password123");
            return busy ? null : "argon2-hash";
        } },
        "@/lib/posthog-server": { getPostHogClient: () => ({
            capture() {}, shutdown: async () => {},
        }) },
        "../auth/validator": validators,
    });
    const route = load("app/api/mcp/route.ts", {
        "@posthog/mcp": {},
        "@/lib/room/item-limits.mjs": require("../lib/room/item-limits.mjs"),
        "@/lib/config/base-url": { getEtbUrl: (p) => p },
        "@/lib/mcp/oauth": {
            authenticateMcpRequest: async () => user ? { userId: user } : null,
            unauthorizedMcpResponse: () => ({ unauthorized: true }),
        },
        "next/server": { NextResponse: { json: (body) => body } },
        "@/lib/db/server": { createAdminClient: async () => db },
        "@/lib/auth/hash": { hashPassword: async (password) => {
            calls.push("hash");
            assert.equal(password, "password123"); return busy ? null : "argon2-hash";
        } },
        "@/lib/auth/validator": validators,
        "@/lib/room/readings": { prepareItemReadings: async (items) => items },
        "@/lib/room/prepare-update": prepared,
        "@/lib/room/get": { invalidatePublicRooms: async () => calls.push("invalidate") },
        "@/lib/room/revalidate": { revalidateRoomContent() {} },
        "@/lib/room/list-data": {}, "@/lib/room/list-view": {},
    }, { TextEncoder, performance, process: { env: {} }, crypto: require("node:crypto") });
    return { update: action.updateRoomFromId, calls, writes,
        mcp: (args, name = "update_room") => route.POST({
            headers: new Map([["content-type", "application/json"]]),
            text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1,
                method: "tools/call", params: { name, arguments: args } }),
        }),
    };
}

test("anonymous, non-owner, missing room, stale version and lookup failure never hash", async () => {
    for (const [options, id] of [
        [{ user: null }, "room"], [{ owner: "another" }, "room"],
        [{}, "missing"], [{ version: 4 }, "room"], [{ lookupError: true }, "room"],
    ]) {
        const h = editor(options);
        if (options.user === null)
            await assert.rejects(h.update({ id, password: "password123" }, 3), /redirect/);
        else assert.notEqual((await h.update({ id, password: "password123" }, 3)).status, "saved");
        assert.ok(!h.calls.includes("hash"));
        assert.equal(h.writes.length, 0);
    }
});

test("valid owner hashes after authorization and preserves the conditional edit write", async () => {
    const h = editor();
    const result = await h.update({ id: "room", password: "password123" }, 3);
    assert.equal(result.status, "saved"); assert.equal(result.editVersion, 4);
    assert.deepEqual(h.calls.slice(0, 4), ["auth", "lookup", "hash", "write"]);
    assert.equal(h.writes[0].password, "argon2-hash");
    const race = editor({ race: true });
    assert.equal((await race.update({ id: "room", password: "password123" }, 3)).status, "conflict");
    assert.ok(!race.calls.includes("invalidate"));
});

test("password retention, clearing and invalid values preserve existing semantics", async () => {
    for (const patch of [{ password: null }, { visibility: "public", password: "x" },
        { visibility: "unlisted", password: "password123" }, { visibility: "private" }]) {
        const h = editor();
        assert.equal((await h.update({ id: "room", ...patch }, 3)).status, "saved");
        assert.ok(!h.calls.includes("hash"));
        if (patch.visibility === "private") assert.ok(!("password" in h.writes[0]));
        else assert.equal(h.writes[0].password, null);
    }
    for (const password of ["", "short", "x".repeat(65)]) {
        const h = editor();
        assert.equal((await h.update({ id: "room", password }, 3)).status, "error");
        assert.ok(!h.calls.includes("hash")); assert.equal(h.writes.length, 0);
    }
    const h = editor();
    assert.equal((await h.update({ id: "room", password: "password123" }, -1)).status, "error");
    assert.ok(!h.calls.includes("hash"));
});

test("busy admission never clears or writes a password", async () => {
    const h = editor({ busy: true });
    assert.equal((await h.update({ id: "room", password: "password123" }, 3)).status, "error");
    assert.equal(h.writes.length, 0);
});

test("MCP updates reject unauthorized and stale edits before hashing; owner edits save", async () => {
    const args = { room_id: "room", password: "password123", expected_edit_version: 3 };
    for (const options of [{ user: null }, { owner: "another" }, { version: 4 },
        { lookupError: true }]) {
        const h = editor(options);
        const response = await h.mcp(args);
        assert.ok(response.unauthorized || response.result.isError);
        assert.ok(!h.calls.includes("hash")); assert.equal(h.writes.length, 0);
    }
    const invalid = editor();
    assert.ok((await invalid.mcp({ ...args, expected_edit_version: -1 })).result.isError);
    assert.ok(!invalid.calls.includes("hash"));
    const h = editor();
    assert.ok(!(await h.mcp(args)).result.isError);
    assert.deepEqual(h.calls.slice(0, 3), ["lookup", "hash", "write"]);
    assert.equal(h.writes[0].password, "argon2-hash");
    for (const name of ["update_room", "create_room"]) {
        const busy = editor({ busy: true });
        const response = await busy.mcp({ ...args, visibility: "private" }, name);
        assert.ok(response.result.isError);
        assert.match(response.result.content[0].text, /混み合/);
        assert.ok(busy.calls.includes("hash"));
        assert.equal(busy.writes.length, 0);
    }
});

test("hashing has bounded concurrency, per-user cooldown and releases capacity on failure", async () => {
    let now = 0, active = 0, peak = 0;
    const jobs = [];
    const { hashPassword } = load("lib/auth/hash.ts", { argon2: {
        argon2id: 2,
        hash() {
            active++; peak = Math.max(peak, active);
            return new Promise((resolve, reject) => jobs.push({
                resolve: () => { active--; resolve("hash"); },
                reject: () => { active--; reject(Error("hash failed")); },
            }));
        },
    } }, { Date: { now: () => now } });
    const first = hashPassword("password123", "a");
    assert.equal(await hashPassword("password123", "a"), null);
    const second = hashPassword("password123", "b");
    assert.equal(await hashPassword("password123", "c"), null);
    const failed = assert.rejects(first, /hash failed/);
    jobs.shift().reject(); await failed;
    const third = hashPassword("password123", "c");
    jobs.shift().resolve(); jobs.shift().resolve();
    assert.equal(await second, "hash"); assert.equal(await third, "hash");
    assert.equal(await hashPassword("password123", "a"), null);
    now = 10_001;
    const retry = hashPassword("password123", "a");
    jobs.shift().resolve(); assert.equal(await retry, "hash");
    assert.equal(peak, 2);
});

test("cooldown storage rejects excess identities and recovers after expiry", async () => {
    let now = 0, calls = 0;
    const { hashPassword } = load("lib/auth/hash.ts", { argon2: {
        argon2id: 2, hash: async () => { calls++; return "hash"; },
    } }, { Date: { now: () => now } });
    for (let i = 0; i < 1024; i++)
        assert.equal(await hashPassword("password123", String(i)), "hash");
    assert.equal(await hashPassword("password123", "overflow"), null);
    assert.equal(calls, 1024);
    now = 10_001;
    assert.equal(await hashPassword("password123", "overflow"), "hash");
});

test("admitted password hashes remain compatible with the existing Argon2 verifier", async () => {
    const argon2 = require("argon2");
    const { hashPassword } = load("lib/auth/hash.ts", { argon2 });
    const hash = await hashPassword("password123", "verified-owner");
    assert.match(hash, /^\$argon2id\$/);
    assert.equal(await argon2.verify(hash, "password123"), true);
    assert.equal(await argon2.verify(hash, "wrong-password"), false);
});
