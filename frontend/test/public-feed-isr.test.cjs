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

test("anonymous feeds keep their ISR pages with no private data", () => {
    for (const page of ["page.tsx", "latest/page.tsx"]) {
        const code = readFileSync(path.join(__dirname, "../app/(game)/", page), "utf8");
        assert.match(code, /export const dynamic = "force-static"/);
        assert.match(code, /export const revalidate = 3600/);
        assert.match(code, /getPublicRooms\\(\\{ failOnError: true \\}\\)/);
        assert.match(code, /currentUser=\\{null\\}/);
        assert.doesNotMatch(code, /deferViewer|getRoomListData|getUserDetails/);
    }
});

test("authenticated feeds verify identity in uncached server routes", () => {
    const pages = [
        ["feed-session/page.tsx", "recommended"],
        ["feed-session/latest/page.tsx", "latest"],
    ];
    for (const [filename, view] of pages) {
        const code = readFileSync(path.join(__dirname, "../app/(game)/", filename), "utf8");
        assert.match(code, /export const dynamic = "force-dynamic"/);
        assert.match(code, /robots: \\{ index: false, follow: false \\}/);
        assert.ok(code.includes('getRoomListData("' + view + '")'));
        assert.doesNotMatch(code, /deferViewer/);
    }
    const listData = readFileSync(path.join(__dirname, "../app/(game)/room-list-data.ts"), "utf8");
    assert.match(listData, /getUserDetails\\(\\)/);
    assert.match(listData, /getOwnedRoomIdsForUser/);
    assert.match(listData, /getSavedRoomIdsForUser/);
});

test("room UI uses server-provided viewer directly; shared layout is untouched", () => {
    const source = readFileSync(path.join(__dirname, "../app/(game)/RoomList.tsx"), "utf8");
    const sidebar = readFileSync(path.join(__dirname, "../components/rooms/RoomNavigation.tsx"), "utf8");
    const header = readFileSync(path.join(__dirname, "../components/layout/Header.tsx"), "utf8");
    const button = readFileSync(path.join(__dirname, "../components/ui/Button.tsx"), "utf8");

    assert.doesNotMatch(source, /deferViewer|viewerLoading|viewerError|useRoomListViewer/);
    assert.doesNotMatch(sidebar, /viewerLoading|viewer-placeholder/);
    assert.match(source, /currentUser \\? \\(/);
    assert.match(source, /<Menu/);
    assert.match(source, /サインイン/);
    assert.match(source, /setLocalCurrentUser\\(null\\)/);
    assert.match(source, /setLocalSavedRoomIds\\(\\[\\]\\)/);
    assert.match(source, /unstable_rethrow\\(error\\)/);
    assert.match(header, /className="flex shrink-0 top-0 left-0 w-full justify-between px-4 py-4"/);
    assert.match(button, /opacity-50 pointer-events-none/);
});

function proxyFixture({ pathname = "/", method = "GET", cookieNames = [], refreshCookies = [] } = {}) {
    const code = readFileSync(path.join(__dirname, "../proxy.ts"), "utf8");
    const compiled = ts.transpileModule(code, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
    }).outputText;
    const exports = {};
    const cookieValues = new Map(cookieNames.map((name) => [name, "old"]));
    const authCalls = [];
    const request = {
        method,
        nextUrl: {
            pathname,
            clone() { return new URL("https://ei-typebomb.com" + pathname + "?sort=keep"); },
        },
        cookies: {
            getAll() { return [...cookieValues].map(([name, value]) => ({ name, value })); },
            set(name, value) { cookieValues.set(name, value); },
        },
    };
    const response = (kind, url = null) => ({
        kind,
        url,
        writtenCookies: [],
        cookies: {
            set(name, value, options) {
                this.writtenCookies.push?.([name, value, options]);
            },
        },
    });
    // The response's cookies.set must be observable by the test.
    const makeResponse = (kind, url) => {
        const result = response(kind, url);
        result.cookies.set = (name, value, options) =>
            result.writtenCookies.push([name, value, options]);
        return result;
    };
    vm.runInNewContext(compiled, {
        exports,
        process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test" } },
        require(id) {
            if (id === "next/server") return {
                NextResponse: {
                    next: () => makeResponse("next"),
                    rewrite: (url) => makeResponse("rewrite", url),
                },
            };
            if (id === "@/lib/db/cookie-options") return { cookieOptions: {} };
            if (id === "@supabase/ssr") return {
                createServerClient: (_url, _key, options) => ({
                    auth: {
                        async getClaims() {
                            authCalls.push("getClaims");
                            if (refreshCookies.length) options.cookies.setAll(refreshCookies);
                            return { data: { claims: null }, error: null };
                        },
                    },
                }),
            };
            throw Error("Unexpected dependency " + id);
        },
        URL,
    });
    return { proxy: exports.proxy, request, authCalls, cookieValues };
}

test("public guest feed stays ISR without auth lookups", async () => {
    for (const pathname of ["/", "/latest"]) {
        const f = proxyFixture({ pathname });
        const result = await f.proxy(f.request);
        assert.equal(result.kind, "next");
        assert.deepEqual(f.authCalls, []);
    }
});

test("unrelated cookies never opt visitors out of public ISR", async () => {
    const f = proxyFixture({ cookieNames: ["theme", "sb-other-code-verifier"] });
    assert.equal((await f.proxy(f.request)).kind, "next");
    assert.deepEqual(f.authCalls, []);
});

test("Supabase session cookie routes / and /latest to uncached SSR", async () => {
    for (const [pathname, destination] of [
        ["/", "/feed-session"],
        ["/latest", "/feed-session/latest"],
    ]) {
        const f = proxyFixture({ pathname, cookieNames: ["sb-project-auth-token.0"] });
        const result = await f.proxy(f.request);
        assert.equal(result.kind, "rewrite");
        assert.equal(result.url.pathname, destination);
        assert.equal(result.url.search, "?sort=keep");
        assert.deepEqual(f.authCalls, ["getClaims"]);
    }
});

test("refreshed session cookies survive SSR rewrite", async () => {
    const f = proxyFixture({
        cookieNames: ["sb-project-auth-token"],
        refreshCookies: [{ name: "sb-project-auth-token", value: "renewed", options: { path: "/" } }],
    });
    const result = await f.proxy(f.request);
    assert.equal(result.kind, "rewrite");
    assert.equal(f.cookieValues.get("sb-project-auth-token"), "renewed");
    assert.equal(result.writtenCookies[0][1], "renewed");
});

test("Server Action POST is never rewritten, but still refreshes authentication", async () => {
    const f = proxyFixture({ method: "POST", cookieNames: ["sb-project-auth-token"] });
    const result = await f.proxy(f.request);
    assert.equal(result.kind, "next");
    assert.deepEqual(f.authCalls, ["getClaims"]);
});

test("direct dynamic route remains subject to normal auth processing", async () => {
    const f = proxyFixture({ pathname: "/feed-session" });
    const result = await f.proxy(f.request);
    assert.equal(result.kind, "next");
    assert.deepEqual(f.authCalls, ["getClaims"]);
});
