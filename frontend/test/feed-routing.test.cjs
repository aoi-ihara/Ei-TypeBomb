/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const code = readFileSync(path.join(__dirname, "../proxy.ts"), "utf8");
const compiled = ts.transpileModule(code, {
    compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
    },
}).outputText;

function createFixture({ pathname = "/", cookies = [], claims = null, error = null, rotate = false } = {}) {
    const calls = [];
    const values = new Map(cookies.map((c) => [c.name, c.value]));
    const req = {
        nextUrl: {
            pathname,
            clone() {
                return { pathname, toString() { return this.pathname; } };
            },
        },
        cookies: {
            getAll() {
                return [...values].map(([name, value]) => ({ name, value }));
            },
            set(name, value) {
                values.set(name, value);
            },
        },
    };
    const responses = [];
    function mockResponse(type, destination) {
        const entries = new Map();
        const result = {
            type,
            destination,
            headers: new Map(),
            cookies: {
                getAll() { return [...entries].map(([name, value]) => ({ name, value })); },
                set(name, value) { entries.set(name, value); },
            },
        };
        responses.push(result);
        return result;
    }
    const exported = {};
    vm.runInNewContext(compiled, {
        exports: exported,
        process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" } },
        require(id) {
            if (id === "next/server")
                return {
                    NextResponse: {
                        next() { return mockResponse("next", null); },
                        rewrite(destination) { return mockResponse("rewrite", destination.pathname); },
                    },
                };
            if (id === "@/lib/db/cookie-options") return { cookieOptions: {} };
            if (id === "@supabase/ssr")
                return {
                    createServerClient(_url, _anon, options) {
                        calls.push("createClient");
                        return {
                            auth: {
                                async getClaims() {
                                    calls.push("getClaims");
                                    if (rotate) {
                                        options.cookies.setAll([{
                                            name: "sb-project-auth-token",
                                            value: "renewed",
                                            options: { path: "/", sameSite: "lax" },
                                        }]);
                                    }
                                    return { data: claims ? { claims } : null, error };
                                },
                            },
                        };
                    },
                };
            throw Error("Unexpected dependency " + id);
        },
    });
    return { proxy: exported.proxy, req, calls, responses };
}

test("guests keep public ISR without any auth or Supabase lookup", async () => {
    for (const pathname of ["/", "/latest"]) {
        const f = createFixture({ pathname });
        const response = await f.proxy(f.req);
        assert.equal(response.type, "next");
        assert.deepEqual(f.calls, []);
    }
});

test("authenticated feed uses private SSR, preserves visible URL and disables shared caching", async () => {
    for (const [pathname, destination] of [["/", "/feed-ssr/recommended"], ["/latest", "/feed-ssr/latest"]]) {
        const f = createFixture({
            pathname,
            cookies: [{ name: "sb-project-auth-token.0", value: "chunk" }],
            claims: { sub: "user-123" },
        });
        const response = await f.proxy(f.req);
        assert.equal(response.type, "rewrite");
        assert.equal(response.destination, destination);
        assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0");
        assert.deepEqual(f.calls, ["createClient", "getClaims"]);
    }
});

test("invalid/stale login cookies never select personalized SSR", async () => {
    const f = createFixture({
        pathname: "/",
        cookies: [{ name: "sb-project-auth-token", value: "expired" }],
        error: { message: "expired" },
    });
    assert.equal((await f.proxy(f.req)).type, "next");
    assert.deepEqual(f.calls, ["createClient", "getClaims"]);
});

test("code verifier cookies do not turn anonymous visits into dynamic SSR", async () => {
    const f = createFixture({
        pathname: "/",
        cookies: [{ name: "sb-project-auth-token-code-verifier", value: "verifier" }],
    });
    assert.equal((await f.proxy(f.req)).type, "next");
    assert.deepEqual(f.calls, []);
});

test("session refresh retains Set-Cookie on the rewritten response", async () => {
    const f = createFixture({
        pathname: "/",
        cookies: [{ name: "sb-project-auth-token", value: "expiring" }],
        claims: { sub: "user-123" },
        rotate: true,
    });
    const response = await f.proxy(f.req);
    assert.equal(response.type, "rewrite");
    assert.equal(response.cookies.getAll()[0].value, "renewed");
    assert.equal(f.req.cookies.getAll()[0].value, "renewed");
});

test("unrelated account routes continue through the existing auth refresh", async () => {
    const f = createFixture({ pathname: "/mine", claims: { sub: "user-123" } });
    assert.equal((await f.proxy(f.req)).type, "next");
    assert.deepEqual(f.calls, ["createClient", "getClaims"]);
});
