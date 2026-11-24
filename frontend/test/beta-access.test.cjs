const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const compile = (source) =>
    ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;

function policy({
    beta = "true",
    enabled = true,
    throws = false,
    token = "project",
    now = Date.now,
} = {}) {
    const calls = [];
    const exports = {};
    const source = readFileSync(path.join(root, "lib/beta-access.ts"), "utf8");
    vm.runInNewContext(compile(source), {
        exports,
        process: {
            env: {
                NEXT_PUBLIC_BETA_ENVIRONMENT: beta,
                NEXT_PUBLIC_POSTHOG_KEY: token,
            },
        },
        Date: { now },
        require(name) {
            if (name !== "@/lib/posthog-server") throw Error(name);
            return {
                getPostHogClient() {
                    calls.push("client");
                    return {
                        async evaluateFlags(userId, options) {
                            if (throws || typeof enabled === "function" && enabled(userId) === undefined)
                                throw new Error("PostHog unavailable");
                            return { getFlag(flag, eventOptions) {
                                assert.deepEqual([...options.flagKeys], ["beta-testers"]);
                                assert.equal(eventOptions.sendFeatureFlagEvents, false);
                                calls.push([flag, userId]);
                                return typeof enabled === "function" ? enabled(userId) : enabled;
                            } };
                        },
                    };
                },
            };
        },
    });
    return { ...exports, calls };
}

test("production never asks PostHog and permits all visitors", async () => {
    const gate = policy({ beta: "false" });
    assert.equal(await gate.canAccessBeta(null), true);
    assert.equal(await gate.canAccessBeta("user"), true);
    assert.deepEqual(gate.calls, []);
});

test("beta access requires a verified user and an enabled flag on that user ID", async () => {
    const gate = policy();
    assert.equal(await gate.canAccessBeta(null), false);
    assert.deepEqual(gate.calls, []);
    assert.equal(await gate.canAccessBeta("supabase-user"), true);
    assert.equal(gate.calls[1][0], "beta-testers");
    assert.equal(gate.calls[1][1], "supabase-user");
    assert.equal(await policy({ enabled: false }).canAccessBeta("user"), false);
    assert.equal(await policy({ throws: true }).canAccessBeta("user"), false);
    assert.equal(await policy({ token: "" }).canAccessBeta("user"), false);
});

test("only explicitly public routes and assets bypass the beta gate", () => {
    const { isPublicBetaPath } = policy();
    for (const allowed of [
        "/beta-access-denied",
        "/sign-in",
        "/sign-in/reset-password",
        "/sign-up",
        "/sign-up/check-email",
        "/auth/confirm",
        "/oauth/consent",
        "/api/oauth/authorize",
        "/api/oauth/token",
        "/api/oauth/interaction/x",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource/api/mcp",
        "/ingest/array/",
        "/favicon.ico",
        "/favicon-dark.ico",
    ])
        assert.equal(isPublicBetaPath(allowed), true, allowed);
    for (const protectedPath of [
        "/",
        "/mine",
        "/saved",
        "/account",
        "/api/room-list-viewer",
        "/api/mcp",
        "/some-room/edit",
        "/server-health",
        "/favicon-light.ico",
        "/api/oauth-not-real",
    ])
        assert.equal(isPublicBetaPath(protectedPath), false, protectedPath);
});

function proxyFixture({
    beta = "true",
    userId = null,
    allowed = false,
    pathname = "/",
    refresh = false,
    action = false,
} = {}) {
    const exports = {};
    const calls = [];
    const response = (kind, destination, status = 200) => {
        const cookies = new Map();
        return {
            kind, destination, status,
            headers: new Map(),
            cookies: {
                getAll: () => [...cookies.values()],
                set: (name, value, options) => {
                    const cookie = typeof name === "string" ? { name, value, ...options } : name;
                    cookies.set(cookie.name, cookie);
                },
            },
        };
    };
    const requestCookies = new Map(userId ? [["sb-example-auth-token", "old"]] : []);
    const cookieOptions = { path: "/", httpOnly: true, secure: true };
    const refreshCookies = ({ cookies }) => {
        if (!refresh) return;
        cookies.setAll([{ name: "sb-example-auth-token", value: "fresh", options: cookieOptions }],
            { "cache-control": "private, no-store" });
        cookies.setAll([{ name: "sb-example-auth-token.1", value: "part", options: cookieOptions }], {});
    };
    const source = readFileSync(path.join(root, "proxy.ts"), "utf8");
    vm.runInNewContext(compile(source), {
        exports,
        URL,
        process: {
            env: {
                NEXT_PUBLIC_BETA_ENVIRONMENT: beta,
                NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example",
                NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
            },
        },
        require(name) {
            if (name === "next/server") {
                class NextResponse {
                    constructor(body, options) {
                        Object.assign(this, response("text", undefined, options.status), { body });
                        this.headers = new Map(Object.entries(options.headers));
                    }
                    static next() { return response("next"); }
                    static rewrite(url, options) { return response("rewrite", url.pathname, options?.status); }
                    static json(body, options) {
                        return { ...response("json", undefined, options?.status), body };
                    }
                }
                return { NextResponse };
            }
            if (name === "@/lib/auth/beta-action")
                return { BETA_ACTION_DENIED: "Beta tester access required" };
            if (name === "@supabase/ssr")
                return {
                    createServerClient: (_url, _key, options) => ({
                        auth: {
                            getClaims: async () => {
                                calls.push("claims");
                                refreshCookies(options);
                                return {};
                            },
                            getUser: async () => {
                                calls.push("getUser");
                                refreshCookies(options);
                                return {
                                    data: {
                                        user: userId ? { id: userId } : null,
                                    },
                                    error: null,
                                };
                            },
                        },
                    }),
                };
            if (name === "@/lib/db/cookie-options")
                return { cookieOptions: {} };
            if (name === "@/lib/beta-access")
                return {
                    isBetaEnvironment: () => beta === "true",
                    isPublicBetaPath: policy().isPublicBetaPath,
                    canAccessBeta: async (id) => {
                        calls.push("flag:" + id);
                        return allowed;
                    },
                };
            throw Error(name);
        },
    });
    const request = {
        nextUrl: { pathname, clone: () => ({ pathname }) },
        url: "https://beta.example" + pathname,
        method: action ? "POST" : "GET",
        headers: new Map(action ? [["next-action", "action-id"]] : []),
        cookies: {
            getAll: () => [...requestCookies].map(([name, value]) => ({ name, value })),
            set: (name, value) => requestCookies.set(name, value),
        },
    };
    return { proxy: exports.proxy, config: exports.config, request, calls };
}

test("beta pages are rewritten to the access error, never redirected", async () => {
    const { proxy, request, calls } = proxyFixture({
        pathname: "/mine",
        userId: "person",
    });
    const result = await proxy(request);
    assert.equal(result.kind, "rewrite");
    assert.equal(result.destination, "/beta-access-denied");
    assert.equal(result.status, 403);
    assert.deepEqual(calls, ["getUser", "flag:person"]);
});

test("beta API denies guest with 401 and unapproved user with 403", async () => {
    for (const userId of [null, "person"]) {
        const { proxy, request, calls } = proxyFixture({
            pathname: "/api/room-list-viewer",
            userId,
        });
        const result = await proxy(request);
        assert.equal(result.kind, "json");
        assert.equal(result.status, userId ? 403 : 401);
        if (!userId) assert.deepEqual(calls, []);
    }
});

test("authorized beta user proceeds to the existing personalized feed rewrite", async () => {
    const { proxy, request } = proxyFixture({
        userId: "person",
        allowed: true,
    });
    const result = await proxy(request);
    assert.equal(result.kind, "rewrite");
    assert.equal(result.destination, "/viewer-feed-internal");
});

test("auth and MCP protocol requests bypass browser-cookie restrictions", async () => {
    for (const pathname of [
        "/sign-in",
        "/sign-up/check-email",
        "/auth/confirm",
        "/api/oauth/token",
        "/api/mcp",
    ]) {
        const { proxy, request, calls } = proxyFixture({ pathname });
        const result = await proxy(request);
        assert.equal(result.kind, "next");
        assert.ok(!calls.includes("getUser"));
    }
});

test("normal production guest feed keeps its no-Supabase fast path", async () => {
    const { proxy, request, calls } = proxyFixture({ beta: "false" });
    const result = await proxy(request);
    assert.equal(result.kind, "next");
    assert.deepEqual(calls, []);
});

test("route groups preserve URLs and MCP resource protection follows OAuth verification", () => {
    for (const file of [
        "app/(auth)/sign-in/page.tsx",
        "app/(auth)/sign-up/page.tsx",
        "app/(auth)/sign-up/check-email/page.tsx",
        "app/(auth)/auth/confirm/route.ts",
        "app/(auth)/oauth/consent/page.tsx",
        "app/(api)/api/mcp/route.ts",
        "app/(api)/api/room-list-viewer/route.ts",
        "app/(api)/.well-known/oauth-authorization-server/route.ts",
        "app/(api)/.well-known/oauth-protected-resource/api/mcp/route.ts",
        "app/(auth)/beta-access-denied/page.tsx",
    ])
        assert.equal(existsSync(path.join(root, file)), true, file);
    assert.equal(existsSync(path.join(root, "app/api/mcp/route.ts")), false);
    const mcp = readFileSync(
        path.join(root, "app/(api)/api/mcp/route.ts"),
        "utf8",
    );
    const tokenAuth = mcp.indexOf(
        "const principal = await authenticateMcpRequest(request);",
    );
    const betaCheck = mcp.indexOf(
        "if (!(await canAccessBeta(principal.userId)))",
    );
    assert.ok(tokenAuth >= 0 && betaCheck > tokenAuth);
    assert.equal(
        mcp.split("if (!(await canAccessBeta(principal.userId)))").length - 1,
        3,
    );
});

test("beta flag cache isolates users, coalesces checks and expires allows even during outages", async () => {
    let time = 0;
    let allowed = true;
    const gate = policy({ enabled: id => id === "allowed" ? allowed : false, now: () => time });
    assert.deepEqual(await Promise.all([gate.canAccessBeta("allowed"), gate.canAccessBeta("allowed")]), [true, true]);
    assert.equal(gate.calls.length, 2);
    assert.equal(await gate.canAccessBeta("other"), false);
    allowed = undefined;
    time = 29_999;
    assert.equal(await gate.canAccessBeta("allowed"), true);
    time++;
    assert.equal(await gate.canAccessBeta("allowed"), false);
});

test("Next's matcher bypasses known assets and ingestion while covering app prefetch and POST", async () => {
    const { unstable_doesMiddlewareMatch } = await import("next/experimental/testing/server.js");
    const { config } = proxyFixture();
    const matches = (url, headers) => unstable_doesMiddlewareMatch({ config, url, headers });
    for (const url of ["/ingest", "/ingest/static/recorder.js", "/_next/static/chunk.js",
        "/_next/image?url=foo", "/favicon-dark.ico", "/icon-light.png", "/Explosion_7.wav"])
        assert.equal(matches(url), false, url);
    for (const url of ["/ingestible", "/rooms/hero.png", "/favicon.ico/details",
        "/api/mcp", "/api/room-list-viewer", "/room/offline", "/room/edit"]) {
        assert.equal(matches(url, { "next-router-prefetch": "1" }), true, url);
        assert.equal(matches(url, { "next-action": "id" }), true, url);
    }
});

test("cookie-bearing production routes keep JWT refresh and cookie-free routes skip Supabase", async () => {
    for (const userId of [null, "person"]) {
        const { proxy, request, calls } = proxyFixture({ beta: "false", pathname: "/room/offline", userId });
        assert.equal((await proxy(request)).kind, "next");
        assert.deepEqual(calls, userId ? ["claims"] : []);
    }
});

test("beta verification preserves refreshed cookies on both approval and refusal", async () => {
    for (const allowed of [true, false]) {
        const { proxy, request } = proxyFixture({ userId: "person", refresh: true, allowed });
        const response = await proxy(request);
        assert.equal(response.status, allowed ? 200 : 403);
        assert.deepEqual(response.cookies.getAll().map(cookie => cookie.value), ["fresh", "part"]);
        assert.ok(response.cookies.getAll().every(cookie => cookie.secure));
        assert.equal(request.cookies.getAll()[0].value, "fresh");
        if (allowed) assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
});

test("denied beta Server Actions receive the auth error without reaching the app", async () => {
    for (const userId of [null, "person"]) {
        const { proxy, request } = proxyFixture({ userId, pathname: "/room/offline", action: true });
        const response = await proxy(request);
        assert.equal(response.kind, "text");
        assert.equal(response.status, userId ? 403 : 401);
        assert.equal(response.headers.get("Content-Type"), "text/plain");
        assert.equal(response.body, "Beta tester access required");
    }
});
