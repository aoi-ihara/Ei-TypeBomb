/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function fixture({ concurrentRename = false, deletedAlias = "old-link", visibility = "public" } = {}) {
    const events = [];
    let deleteFilters = {};
    let deleteAttempted = false;
    const db = {
        from(table) {
            assert.equal(table, "ei_typebomb_rooms");
            let action = "read";
            const filters = {};
            const query = {
                select() { return query; },
                eq(column, value) { filters[column] = value; return query; },
                delete() { action = "delete"; return query; },
                async maybeSingle() {
                    if (action === "read") {
                        assert.equal(filters.id, "room-a");
                        assert.equal(filters.user_id, "owner");
                        return { data: { id: "room-a", link: "old-link", visibility,
                            edit_version: 7 }, error: null };
                    }
                    deleteAttempted = true;
                    deleteFilters = { ...filters };
                    assert.equal(filters.id, "room-a");
                    assert.equal(filters.user_id, "owner");
                    // Simulate the database trigger bumping the revision when
                    // another tab changes the slug after the initial lookup.
                    const revision = concurrentRename ? 8 : 7;
                    return {
                        data: filters.edit_version === revision
                            ? { id: "room-a", link: deletedAlias } : null,
                        error: null,
                    };
                },
            };
            return query;
        },
    };
    const exported = {};
    const compiled = ts.transpileModule(
        readFileSync(path.join(__dirname, "../lib/room/delete.ts"), "utf8"),
        { compilerOptions: { target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
    ).outputText;
    vm.runInNewContext(compiled, {
        exports: exported, console,
        require(id) {
            const dependencies = {
                "./revalidate": { revalidateRoomContent: () => events.push("revalidate") },
                "./get": { invalidatePublicRooms: async () => events.push("list") },
                "./room-data-cache": {
                    blockRoomDataCache: async (...ids) => {
                        events.push("block:" + ids.join(","));
                        return "blocked:test";
                    },
                    releaseRoomDataCache: async (token, ...ids) =>
                        events.push("release:" + token + ":" + ids.join(",")),
                    invalidateRoomDataCache: async (...ids) =>
                        events.push("invalidate:" + ids.join(",")),
                },
                "@/lib/auth/sign-in-url": { getSignInUrl: () => "/sign-in" },
                "../db/server": { createAdminClient: async () => db },
                "../auth/session": { getUser: async () => "owner" },
                "next/navigation": { redirect: () => { throw Error("redirect"); } },
                "@/lib/posthog-server": { getPostHogClient: () => ({
                    capture: () => events.push("capture"),
                    shutdown: async () => events.push("shutdown"),
                }) },
            };
            if (!(id in dependencies)) throw Error("Unexpected dependency: " + id);
            return dependencies[id];
        },
    });
    return { remove: () => exported.deleteRoom("room-a"), events,
        get deleteFilters() { return deleteFilters; },
        get deleteAttempted() { return deleteAttempted; } };
}

test("delete is conditional on the revision used to fence the original alias", async () => {
    const f = fixture({ concurrentRename: true });
    const result = await f.remove();
    assert.match(result, /更新/);
    assert.equal(f.deleteAttempted, true);
    assert.equal(f.deleteFilters.edit_version, 7);
    assert.ok(f.events.includes("block:room-a,old-link"));
    assert.ok(f.events.includes("release:blocked:test:room-a,old-link"));
    assert.equal(f.events.includes("list"), false);
    assert.equal(f.events.includes("capture"), false);
});

test("successful deletion releases the original link and invalidates a changed returned alias", async () => {
    const f = fixture({ deletedAlias: "new-link" });
    assert.equal(await f.remove(), null);
    assert.ok(f.events.includes("release:blocked:test:room-a,old-link"));
    assert.ok(f.events.includes("invalidate:new-link"));
    assert.ok(f.events.includes("list"));
    assert.ok(f.events.includes("revalidate"));
});

test("a private room deletion still invalidates the room ID and slug", async () => {
    const f = fixture({ visibility: "private" });
    assert.equal(await f.remove(), null);
    assert.equal(f.events.some((event) => event.startsWith("block:")), false);
    assert.ok(f.events.includes("invalidate:room-a,old-link"));
});
