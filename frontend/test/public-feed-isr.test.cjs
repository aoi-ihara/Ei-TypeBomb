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
        const pathToPage = path.join(__dirname, "../app/(game)/(browse)/", page);
        const code = readFileSync(pathToPage, "utf8");
        assert.match(code, /export const dynamic = "force-static"/);
        assert.match(code, /export const revalidate = 3600/);
        assert.match(code, /getPublicRooms\(\{ failOnError: true \}\)/);
        assert.match(code, /deferViewer/);
        assert.doesNotMatch(code, /getRoomListData|getUserDetails|searchParams/);
    }
    const client = readFileSync(
        path.join(__dirname, "../app/(game)/(browse)/RoomList.tsx"),
        "utf8",
    );
    const provider = readFileSync(
        path.join(__dirname, "../components/rooms/RoomListViewerProvider.tsx"),
        "utf8",
    );
    const layout = readFileSync(
        path.join(__dirname, "../app/(game)/(browse)/layout.tsx"),
        "utf8",
    );
    assert.match(layout, /<RoomListViewerProvider>/);
    assert.match(client, /useRoomListViewer\(\)/);
    assert.match(client, /if \(deferViewer\) \{\s*ensureLoaded\(\);\s*\} else \{\s*initialize\(/);
    assert.match(layout, /<RoomBrowser>\{children\}<\/RoomBrowser>/);
    assert.doesNotMatch(layout, /cookies\(|headers\(|getUser/);
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
        const source = readFileSync(path.join(__dirname, "../app/(game)/(browse)/viewer-feed-internal", page), "utf8");
        assert.match(source, /force-dynamic/);
        assert.match(source, /getRoomListData/);
        assert.doesNotMatch(source, /deferViewer/);
    }
});

test("same-layout sign out clears the shared viewer before redirect and restores it on failure", () => {
    const browser = readFileSync(
        path.join(__dirname, "../app/(game)/(browse)/RoomBrowser.tsx"),
        "utf8",
    );
    const layoutProvider = readFileSync(
        path.join(__dirname, "../components/rooms/RoomListViewerProvider.tsx"),
        "utf8",
    );
    const handler = browser.slice(browser.indexOf("const handleSignOut"), browser.indexOf("const navigate"));
    const reset = handler.indexOf("viewer.resetToGuest()");
    const signOut = handler.indexOf("await signOut()");
    assert.ok(reset >= 0 && signOut > reset);
    assert.match(handler, /router\.replace\("\/"\)/);
    assert.match(handler, /viewer.restore\(previousSnapshot\)/);
    assert.match(handler, /unstable_rethrow\(error\)/);

    // A cached personalized page cannot re-seed after the provider is reset.
    assert.match(layoutProvider, /resetToGuest[\s\S]+commit\(\{ \.\.\.GUEST \}\)/);
    assert.match(layoutProvider, /initialize[\s\S]+snapshotRef\.current\.status !== "ready"/);
});

test("public feed auth transitions preserve navbar, header and CTA dimensions", () => {
    const source = readFileSync(
        path.join(__dirname, "../app/(game)/(browse)/RoomList.tsx"),
        "utf8",
    );
    const browser = readFileSync(
        path.join(__dirname, "../app/(game)/(browse)/RoomBrowser.tsx"),
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
    assert.match(source, /snapshot\.status === "idle"/);
    assert.match(browser, /className="invisible pointer-events-none"/);
    assert.match(browser, /<Button variant="text">サインイン<\/Button>/);
    assert.doesNotMatch(browser, /className="h-(?:9|10) w-28"/);
    // Keep the header dimensions stable without requiring an exact class order.
    assert.match(header, /<header className="[^"]*\bw-full\b[^"]*\bshrink-0\b[^"]*\bjustify-between\b[^"]*\bpx-4\b[^"]*\bpy-4\b/);
    assert.match(header, /className="flex min-w-0 flex-1 gap-4"/);
    assert.match(header, /<span className="(?=[^"]*\bmin-w-0\b)(?=[^"]*\btruncate\b)(?=[^"]*\bfont-extrabold\b)[^"]*"/);
    assert.doesNotMatch(header, /min-h-\[|absolute right-4/);
    assert.match(source, /disabled=\{viewerLoading \|\| viewerError\}/);
    assert.match(button, /opacity-50 pointer-events-none/);
});

test("saved room toggles in personalized feeds update the shared viewer too", () => {
    const source = readFileSync(
        path.join(__dirname, "../app/(game)/(browse)/RoomList.tsx"),
        "utf8",
    );
    assert.match(source, /\{ snapshot, ensureLoaded, initialize, setSavedRoomIds \} = useRoomListViewer\(\)/);
    assert.match(source, /useServerViewer \? initialSavedRoomIds : snapshot.savedRoomIds/);
    assert.match(source, /setSavedRoomIds\(nextSavedIds\)/);
    assert.match(source, /setSavedRoomIds\(\(current\) =>/);
});
