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
    assert.match(client, /if \(deferViewer\) \{\s*ensureLoaded\(\);\s*\} else \{\s*reconcile\(/);
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

    assert.match(handler, /finally \{\s*viewer.finishSignOut\(\)/);
    assert.match(layoutProvider, /resetToGuest[\s\S]+commit\(GUEST\)/);
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

function viewerProvider({ fetch, toggleSavedRoom } = {}) {
    const compiled = ts.transpileModule(readFileSync(
        path.join(__dirname, "../components/rooms/RoomListViewerProvider.tsx"), "utf8",
    ), { compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
    } }).outputText;
    const hooks = [];
    let cursor = 0;
    const exports = {};
    vm.runInNewContext(compiled, {
        exports, AbortController, fetch, console,
        require(id) {
            if (id === "@/lib/room/save") return { toggleSavedRoom };
            if (id === "react/jsx-runtime") return { jsx: (_, props) => props };
            if (id === "react") return {
                createContext: () => ({ Provider: Symbol() }),
                useCallback: value => value,
                useMemo: fn => fn(),
                useRef(value) {
                    const index = cursor++;
                    hooks[index] ??= { current: value };
                    return hooks[index];
                },
                useState(value) {
                    const index = cursor++;
                    if (!(index in hooks)) hooks[index] = value;
                    return [hooks[index], next => { hooks[index] = next; }];
                },
            };
            throw Error("Unexpected module: " + id);
        },
    });
    return () => {
        cursor = 0;
        return exports.RoomListViewerProvider({ children: null }).value;
    };
}

const viewerData = (id, savedRoomIds = []) => ({
    currentUser: id ? { id, email: null, displayName: null } : null,
    ownedRoomIds: id ? ["owned-" + id] : [],
    savedRoomIds,
});
const assertSaves = (viewer, expected) => assert.deepEqual([...viewer().snapshot.savedRoomIds], expected);
const nextTick = () => new Promise(resolve => setImmediate(resolve));

test("fresh personalized routes reconcile a ready guest, identity changes and bookmark reads", () => {
    const viewer = viewerProvider();
    viewer().reconcile(viewerData(null));
    viewer().reconcile(viewerData("one", ["saved"]));
    assert.equal(viewer().snapshot.currentUser.id, "one");
    assertSaves(viewer, ["saved"]);
    viewer().reconcile(viewerData("one", ["external"]));
    assertSaves(viewer, ["external"]);
    viewer().reconcile(viewerData("one", null));
    assertSaves(viewer, ["external"]);
    viewer().reconcile(viewerData("two", ["account-two"]));
    assert.equal(viewer().snapshot.currentUser.id, "two");
    assertSaves(viewer, ["account-two"]);
});

test("server snapshots replace settled bookmarks while only pending edits remain optimistic", async () => {
    let complete;
    const viewer = viewerProvider({ toggleSavedRoom: () => new Promise(resolve => { complete = resolve; }) });
    viewer().reconcile(viewerData("one", ["removed"]));
    const attempt = viewer().toggleSaved("one", "pending");
    assertSaves(viewer, ["removed", "pending"]);
    viewer().reconcile(viewerData("one", ["external"]));
    assertSaves(viewer, ["external", "pending"]);
    complete({ error: "failed", saved: false });
    await attempt;
    assertSaves(viewer, ["external"]);

    const success = viewer().toggleSaved("one", "confirmed");
    complete({ error: null, saved: true });
    await success;
    assertSaves(viewer, ["external", "confirmed"]);
    viewer().reconcile(viewerData("one", ["external"]));
    assertSaves(viewer, ["external"]);

    const stale = viewer().toggleSaved("one", "old-user");
    viewer().reconcile(viewerData("two", ["account-two"]));
    complete({ error: null, saved: true });
    assert.equal(await stale, null);
    assertSaves(viewer, ["account-two"]);
});

test("sign-out ignores cached personalized props until fresh auth confirms an identity", async () => {
    let payload = viewerData(null);
    let requests = 0;
    const viewer = viewerProvider({ fetch: async () => {
        requests++;
        return { ok: true, json: async () => payload };
    } });
    const old = viewerData("one", ["private"]);
    viewer().reconcile(old);
    viewer().resetToGuest();
    viewer().reconcile(old);
    assert.equal(requests, 0);
    assertSaves(viewer, []);
    viewer().finishSignOut();
    viewer().reconcile(old);
    viewer().reconcile(old);
    await nextTick();
    assert.equal(requests, 1);
    assert.equal(viewer().snapshot.currentUser, null);
    assertSaves(viewer, []);

    payload = viewerData("two", ["verified"]);
    viewer().reconcile(old);
    await nextTick();
    assert.equal(requests, 2);
    assert.equal(viewer().snapshot.currentUser.id, "two");
    assertSaves(viewer, ["verified"]);
    viewer().reconcile(old);
    assert.equal(viewer().snapshot.currentUser.id, "two");
    await nextTick();
    assert.equal(viewer().snapshot.currentUser.id, "two");
    viewer().reconcile(viewerData("two", ["fresh"]));
    assertSaves(viewer, ["fresh"]);
});

test("room lists and details share the existing directional navigation and Shell width", () => {
    const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");
    const browser = read("app/(game)/(browse)/RoomBrowser.tsx");
    const list = read("app/(game)/(browse)/RoomList.tsx");
    const detail = read("app/(game)/(browse)/[link]/page.tsx");
    const shell = read("app/(game)/(browse)/[link]/RoomDetailShell.tsx");
    const card = read("components/rooms/RoomCard.tsx");
    assert.match(browser, /<Navigation>\{children\}<\/Navigation>/);
    assert.match(browser, /useState\("\/"\)/);
    assert.match(browser, /isFeed && signedInItems\.some/);
    assert.match(browser, /setBackHref\(listPath\)/);
    assert.match(list, /size="xlarge"/);
    assert.match(detail, /<RoomDetailShell title=\{title\} roomId=\{result.id\}>/);
    assert.match(shell, /size="xlarge"/);
    assert.match(shell, /back=\{backHref\}/);
    assert.match(card, /navigate\?\.\(`\/\$\{roomLink\}`, "push", event\.preventDefault,\s+source \? \{ transition: "morph", source \}/);
    assert.match(card, /href=\{`\/\$\{roomLink\}`\}\s+navigation="push"/);
    assert.match(card, /href=\{`\/\$\{roomLink\}\/edit`\}\s+navigation="push"\s+navigationScope="root"/);
});

test("editor links use a persistent root navigation across route groups", () => {
    const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.match(read("app/layout.tsx"), /<Navigation root>\{children\}<\/Navigation>/);
    assert.match(read("app/(game)/(browse)/[link]/PlayRoom.tsx"), /href=\{"\/" \+ link \+ "\/edit"\}\s+prefetch=\{false\}\s+navigation="push"\s+navigationScope="root"/);
    assert.match(read("components/ui/Button.tsx"), /useNavigation\(navigationScope\)/);
    assert.doesNotMatch(read("app/(editor)/[link]/edit/EditorClient.tsx"), /animateAppear=\{true\}/);
});

test("room-card entry and return share a keyed morph while editor keeps slide", () => {
    const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");
    const card = read("components/rooms/RoomCard.tsx");
    const nav = read("components/layout/Navigation.tsx");
    const css = read("components/layout/navigation.css");
    assert.match(card, /navigationTransition="morph"\s+navigationMorphSource=\{articleRef\}/);
    assert.match(read("app/(game)/(browse)/[link]/RoomDetailShell.tsx"), /size="xlarge"\s+morphTarget=\{roomId\}/);
    assert.match(nav, /capturePageMorph\(node, source\)/);
    assert.match(nav, /request.morph.play\(destination,/);
    assert.match(nav, /clearMorph\(request\)/);
    assert.doesNotMatch(css, /etb-navigation-morph/);
    assert.match(card, /href=\{\x60\/\$\{roomLink\}\/edit\x60\}\s+navigation="push"\s+navigationScope="root"/);
});

test("page morph uses slide timing and retargets the live destination", () => {
    const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");
    const morph = read("components/layout/page-morph.ts");
    assert.match(morph, /const \{ timing \} = getSlideMotion\(\)/);
    assert.match(morph, /const next = measure\(\)/);
    assert.match(morph, /clock = createMorphClock\(overlay, timing\)/);
    assert.match(morph, /advanceMorphRect\(current, target, mix, progress\)/);
    assert.doesNotMatch(morph, /restart\(/);
    assert.match(morph, /trackMorphCursorElement\(destination\)/);
    assert.match(read("components/ui/Morph.tsx"), /createMorphClock\(root,/);
});

test("room detail back morph selects only the original room card", () => {
    const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");
    const nav = read("components/layout/Navigation.tsx");
    const shell = read("components/layout/Shell.tsx");
    const card = read("components/rooms/RoomCard.tsx");
    assert.match(card, /data-navigation-morph-target=\{room.id\}/);
    assert.match(shell, /navigation=\{back \? "pop" : undefined\}\s+navigationTransition=\{morphTarget \? "morph" : "slide"\}\s+navigationMorphSource=\{morphTarget \? morphRef : undefined\}/);
    assert.match(read("components/layout/page-morph.ts"), /key: source.dataset.navigationMorphTarget/);
    assert.match(nav, /element !== source && \(key === undefined \|\| element.dataset.navigationMorphTarget === key\)/);
    assert.match(nav, /if \(request.direction === "pop"\) \{\s*\/\/[^\n]+\n\s*destination.scrollIntoView/);
    assert.match(nav, /if \(!destination \|\|[^}]+cancel\(\)/);
});

test("nested navigation releases document state only for the current transition owner", () => {
    const nav = readFileSync(path.join(__dirname, "..", "components/layout/Navigation.tsx"), "utf8");
    assert.match(nav, /function releaseDocumentTransition\(request: Request\) \{\s*if \(documentTransition\?\.request !== request\) return;\s*documentTransition = null;/);
    assert.match(nav, /documentTransition\?\.cancel\(\);\s*documentTransition = \{ request, cancel \};/);
    assert.match(nav, /clearMorph\(request\);\s*releaseDocumentTransition\(request\);\s*node.style.viewTransitionName = "";/);
});

test("morph pushes reset scroll before redirect or missing-target cancellation", () => {
    const nav = readFileSync(path.join(__dirname, "..", "components/layout/Navigation.tsx"), "utf8");
    assert.match(nav, /if \(request\.morph\) \{\s*stop\(request\);[\s\S]*?if \(request\.direction === "push"\) \{\s*window\.scrollTo\(\{ top: 0, behavior: "instant" \}\);\s*\}\s*if \(!matches\) \{ cancel\(\); return; \}[\s\S]*?if \(!destination \|\|[^}]+cancel\(\)/);
});

test("page morph crops both outgoing and incoming layers without changing page layout", () => {
    const morph = readFileSync(path.join(__dirname, "..", "components/layout/page-morph.ts"), "utf8");
    assert.match(morph, /const origin = intersectMorphRect\(fullOrigin, screenRect\(\)\)/);
    assert.match(morph, /clipToVisible\(oldSource, fullOrigin, origin\)/);
    assert.match(morph, /let target = intersectMorphRect\(fullTarget, screenRect\(\)\)/);
    assert.match(morph, /clipToVisible\(destination, fullTarget, target\)/);
    assert.match(morph, /const visible = intersectMorphRect\(next, screenRect\(\)\)/);
    assert.match(morph, /const properties = \[[^\]]*"clip-path"\]/);
});
