/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = readFileSync(
    path.join(__dirname, "../app/api/room-list-viewer/route.ts"),
    "utf8",
);

function fixture({ user = null, owned = [], saved = [], failure = false } = {}) {
    const calls = [];
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
    }).outputText;
    const exports = {};
    vm.runInNewContext(compiled, {
        exports,
        console,
        require(id) {
            if (id === "next/server") {
                return {
                    NextResponse: {
                        json(body, options = {}) {
                            return {
                                status: options.status ?? 200,
                                headers: options.headers,
                                body,
                            };
                        },
                    },
                };
            }
            if (id === "@/lib/auth/session")
                return {
                    getUserDetails: async () => {
                        calls.push("auth");
                        return user;
                    },
                };
            if (id === "@/lib/room/list-queries") {
                return {
                    getOwnedRoomIdsForUser: async (id) => {
                        calls.push("owned:" + id);
                        return failure ? null : owned;
                    },
                    getSavedRoomIdsForUser: async (id) => {
                        calls.push("saved:" + id);
                        return failure ? null : saved;
                    },
                };
            }
            throw Error("Unexpected module: " + id);
        },
    });
    return { route: exports, calls };
}

test("guest sees no account-specific data or ownership queries", async () => {
    const { route, calls } = fixture();
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers["Cache-Control"], "private, no-store, max-age=0");
    assert.equal(response.body.currentUser, null);
    assert.deepEqual([...response.body.ownedRoomIds], []);
    assert.deepEqual([...response.body.savedRoomIds], []);
    assert.deepEqual(calls, ["auth"]);
    assert.equal(route.dynamic, "force-dynamic");
});

test("authenticated user receives only their owned IDs and saved IDs", async () => {
    const user = { id: "viewer", email: "viewer@example.com", displayName: null };
    const { route, calls } = fixture({
        user,
        owned: [{ id: "own-room", userId: "viewer", title: "Not sent" }],
        saved: ["some-public-room"],
    });
    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.equal(response.headers["Cache-Control"], "private, no-store, max-age=0");
    assert.equal(response.body.currentUser.id, "viewer");
    assert.deepEqual([...response.body.ownedRoomIds], ["own-room"]);
    assert.deepEqual([...response.body.savedRoomIds], ["some-public-room"]);
    assert.equal(JSON.stringify(response.body).includes("Not sent"), false);
    assert.deepEqual(calls.sort(), ["auth", "owned:viewer", "saved:viewer"].sort());
});

test("failed private DB lookups fail closed and are never CDN cached", async () => {
    const { route } = fixture({ user: { id: "viewer" }, failure: true });
    const response = await route.GET();
    assert.equal(response.status, 503);
    assert.equal(response.headers["Cache-Control"], "private, no-store, max-age=0");
    assert.equal(response.body.currentUser, undefined);
});

test("public feeds are ISR pages and never await personalized room list data", () => {
    for (const page of ["page.tsx", "latest/page.tsx"]) {
        const pathToPage = path.join(__dirname, "../app/(game)/", page);
        const code = readFileSync(pathToPage, "utf8");
        assert.match(code, /export const dynamic = "force-static"/);
        assert.match(code, /export const revalidate = 3600/);
        assert.match(code, /getPublicRooms\(\)/);
        assert.match(code, /deferViewer/);
        assert.doesNotMatch(code, /getRoomListData|getUserDetails|searchParams/);
    }
    const client = readFileSync(
        path.join(__dirname, "../app/(game)/RoomList.tsx"),
        "utf8",
    );
    assert.match(client, /fetch\("\/api\/room-list-viewer"/);
    assert.match(client, /cache: "no-store"/);
    assert.match(client, /ownedRoomIds/);
});
