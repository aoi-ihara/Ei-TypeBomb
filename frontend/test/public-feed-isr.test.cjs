/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = readFileSync(
    path.join(__dirname, "../app/(api)/api/room-list-viewer/route.ts"),
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
        assert.match(code, /getPublicRooms\(\{ failOnError: true \}\)/);
        assert.match(code, /deferViewer/);
        assert.doesNotMatch(code, /getRoomListData|getUserDetails|searchParams/);
    }
    const client = readFileSync(
        path.join(__dirname, "../app/(game)/RoomList.tsx"),
        "utf8",
    );
    const provider = readFileSync(
        path.join(__dirname, "../components/rooms/RoomListViewerProvider.tsx"),
        "utf8",
    );
    const layout = readFileSync(
        path.join(__dirname, "../app/(game)/layout.tsx"),
        "utf8",
    );
    assert.match(layout, /<RoomListViewerProvider>/);
    assert.match(client, /useRoomListViewer\(\)/);
    assert.match(client, /viewer\.ensureLoaded\(\)/);
    assert.match(provider, /fetch\("\/api\/room-list-viewer"/);
    assert.match(provider, /cache: "no-store"/);
    assert.match(provider, /requestRef\.current/);
    assert.match(provider, /ownedRoomIds/);
});

test("cookie-bearing feed requests bypass guest ISR", () => {
    const proxy = readFileSync(path.join(__dirname, "../proxy.ts"), "utf8");
    assert.match(proxy, /hasAuthCookie\(request\)/);
    assert.match(proxy, /NextResponse\.rewrite\(destination/);
    assert.match(proxy, /\/viewer-feed-internal/);
    assert.doesNotMatch(proxy, /\/_viewer-feed/);
    for (const page of ["page.tsx", "latest/page.tsx"]) {
        const source = readFileSync(path.join(__dirname, "../app/(game)/viewer-feed-internal", page), "utf8");
        assert.match(source, /force-dynamic/);
        assert.match(source, /getRoomListData/);
        assert.doesNotMatch(source, /deferViewer/);
    }
});

test("same-route sign out clears deferred ownership and save controls before redirect", () => {
    const source = readFileSync(
        path.join(__dirname, "../app/(game)/RoomList.tsx"),
        "utf8",
    );
    const handlerStart = source.indexOf("const handleSignOut = async () => {");
    const handlerEnd = source.indexOf("const viewTitle =", handlerStart);
    assert.ok(handlerStart >= 0 && handlerEnd > handlerStart);
    const handler = source.slice(handlerStart, handlerEnd);
    const redirect = handler.indexOf("await signOut()");
    assert.ok(redirect > 0, "sign-out Server Action must still execute");
    const sharedReset = handler.indexOf("viewer.resetToGuest()");
    assert.ok(sharedReset > 0 && sharedReset < redirect);
    // Logging out from /mine or /saved must also clear the shared provider.
    assert.ok(sharedReset < handler.indexOf("if (!deferViewer)"));
    assert.match(handler, /viewer.restore\(previousSnapshot\)/);
    assert.match(handler, /catch \(error\)/);
    assert.match(handler, /viewer.restore\(previousSnapshot\)/);
    assert.match(handler, /unstable_rethrow\(error\)/);
});

test("public feed auth transitions preserve navbar, header and CTA dimensions", () => {
    const source = readFileSync(
        path.join(__dirname, "../app/(game)/RoomList.tsx"),
        "utf8",
    );
    const provider = readFileSync(
        path.join(__dirname, "../components/rooms/RoomListViewerProvider.tsx"),
        "utf8",
    );
    const header = readFileSync(
        path.join(__dirname, "../components/layout/Header.tsx"),
        "utf8",
    );
    const button = readFileSync(
        path.join(__dirname, "../components/ui/Button.tsx"),
        "utf8",
    );

    assert.match(provider, /snapshotRef\.current\.status !== "idle"/);
    assert.match(provider, /resetToGuest/);
    assert.match(source, /viewer\.snapshot\.status === "idle"/);
    assert.match(source, /className="invisible pointer-events-none"/);
    assert.match(source, /<Button variant="text">サインイン<\/Button>/);
    assert.doesNotMatch(source, /className="h-(?:9|10) w-28"/);
    assert.match(header, /className="flex shrink-0 top-0 left-0 w-full justify-between px-4 py-4"/);
    assert.doesNotMatch(header, /min-h-\[|absolute right-4/);
    assert.match(source, /disabled=\{viewerLoading \|\| viewerError\}/);
    assert.match(button, /opacity-50 pointer-events-none/);
});

test("saved room toggles in personalized feeds update the shared viewer too", () => {
    const source = readFileSync(
        path.join(__dirname, "../app/(game)/RoomList.tsx"),
        "utf8",
    );
    const setterStart = source.indexOf("const setSavedRoomIds = (value:");
    const setterEnd = source.indexOf("const viewerLoading =", setterStart);
    assert.ok(setterStart >= 0 && setterEnd > setterStart);
    const setter = source.slice(setterStart, setterEnd);
    assert.match(setter, /setLocalSavedRoomIds\(value\)/);
    assert.match(setter, /viewer\.setSavedRoomIds\(value\)/);
    assert.match(setter, /viewer\.snapshot\.currentUser\?\.id === localCurrentUser\?\.id/);
    const saveHandler = source.slice(
        source.indexOf("const toggleSavedRoomState = async"),
        source.indexOf("useEffect(() => {\n        if (!currentUser)", source.indexOf("const toggleSavedRoomState = async")),
    );
    assert.match(saveHandler, /setSavedRoomIds\(nextSavedIds\)/);
    assert.match(saveHandler, /setSavedRoomIds\(\(current\) =>/);
});
