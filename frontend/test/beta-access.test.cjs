const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const compile = (source) =>
    ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

function policy({ beta = "true", enabled = true, throws = false, token = "project" } = {}) {
    const calls = [];
    const exports = {};
    const source = readFileSync(path.join(root, "lib/beta-access.ts"), "utf8");
    vm.runInNewContext(compile(source), {
        exports,
        process: { env: { BETA_ENVIRONMENT: beta, NEXT_PUBLIC_POSTHOG_KEY: token } },
        console: { error: () => {} },
        require(name) {
            if (name !== "@/lib/posthog-server") throw Error(name);
            return {
                getPostHogClient() {
                    calls.push("client");
                    return {
                        async isFeatureEnabled(flag, userId) {
                            calls.push([flag, userId]);
                            if (throws) throw new Error("PostHog unavailable");
                            return enabled;
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

test("only sign-in, signup, recovery and OAuth bootstrap endpoints bypass the beta gate", () => {
    const { isPublicBetaPath } = policy();
    for (const allowed of [
        "/beta-access-denied", "/sign-in", "/sign-in/reset-password",
        "/sign-up", "/auth/confirm", "/oauth/consent",
        "/api/oauth/authorize", "/api/oauth/token", "/api/oauth/interaction/x",
        "/.well-known/oauth-authorization-server",
        "/.well-known/oauth-protected-resource/api/mcp",
        "/ingest/array/", "/favicon.ico",
    ]) assert.equal(isPublicBetaPath(allowed), true, allowed);
    for (const protectedPath of [
        "/", "/mine", "/saved", "/account", "/api/room-list-viewer",
        "/api/mcp", "/some-room/edit", "/server-health",
        "/api/oauth-not-real",
    ]) assert.equal(isPublicBetaPath(protectedPath), false, protectedPath);
});

function proxyFixture({ beta = "true", userId = null, allowed = false, pathname = "/" } = {}) {
    const exports = {};
    const calls = [];
    const cookies = [];
    const response = (kind, destination, status = 200) => ({
        kind, destination, status, cookies: {
            getAll: () => cookies,
            set: (cookie) => cookies.push(cookie),
        },
    });
    const source = readFileSync(path.join(root, "proxy.ts"), "utf8");
    vm.runInNewContext(compile(source), {
        exports,
        URL,
        process: { env: { BETA_ENVIRONMENT: beta, NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" } },
        require(name) {
            if (name === "next/server") return {
                NextResponse: {
                    next: () => response("next"),
                    rewrite: (url, options) => response("rewrite", url.pathname, options?.status),
                    json: (body, options) => ({ ...response("json", undefined, options?.status), body }),
                },
            };
            if (name === "@supabase/ssr") return {
                createServerClient: () => ({
                    auth: {
                        getClaims: async () => { calls.push("claims"); return {}; },
                        getUser: async () => {
                            calls.push("getUser");
                            return { data: { user: userId ? { id: userId } : null }, error: null };
                        },
                    },
                }),
            };
            if (name === "@/lib/db/cookie-options") return { cookieOptions: {} };
            if (name === "@/lib/beta-access") return {
                isBetaEnvironment: () => beta === "true",
                isPublicBetaPath: policy().isPublicBetaPath,
                canAccessBeta: async (id) => { calls.push("flag:" + id); return allowed; },
            };
            throw Error(name);
        },
    });
    const request = {
        nextUrl: { pathname, clone: () => ({ pathname }) },
        url: "https://beta.example" + pathname,
        cookies: { getAll: () => userId ? [{ name: "sb-example-auth-token", value: "x" }] : [] },
    };
    return { proxy: exports.proxy, request, calls };
}

test("beta pages are rewritten to the access error, never redirected", async () => {
    const { proxy, request, calls } = proxyFixture({ pathname: "/mine", userId: "person" });
    const result = await proxy(request);
    assert.equal(result.kind, "rewrite");
    assert.equal(result.destination, "/beta-access-denied");
    assert.equal(result.status, 403);
    assert.deepEqual(calls, ["claims", "getUser", "flag:person"]);
});

test("beta API denies guest with 401 and unapproved user with 403", async () => {
    for (const userId of [null, "person"]) {
        const { proxy, request } = proxyFixture({ pathname: "/api/room-list-viewer", userId });
        const result = await proxy(request);
        assert.equal(result.kind, "json");
        assert.equal(result.status, userId ? 403 : 401);
    }
});

test("authorized beta user proceeds to the existing personalized feed rewrite", async () => {
    const { proxy, request } = proxyFixture({ userId: "person", allowed: true });
    const result = await proxy(request);
    assert.equal(result.kind, "rewrite");
    assert.equal(result.destination, "/viewer-feed-internal");
});

test("auth and MCP protocol requests bypass browser-cookie restrictions", async () => {
    for (const pathname of ["/sign-in", "/auth/confirm", "/api/oauth/token", "/api/mcp"]) {
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
        "app/(auth)/sign-in/page.tsx", "app/(auth)/sign-up/page.tsx",
        "app/(auth)/auth/confirm/route.ts", "app/(auth)/oauth/consent/page.tsx",
        "app/(api)/api/mcp/route.ts", "app/(api)/api/room-list-viewer/route.ts",
        "app/(api)/.well-known/oauth-authorization-server/route.ts",
        "app/(api)/.well-known/oauth-protected-resource/api/mcp/route.ts",
        "app/(auth)/beta-access-denied/page.tsx",
    ]) assert.equal(existsSync(path.join(root, file)), true, file);
    assert.equal(existsSync(path.join(root, "app/api/mcp/route.ts")), false);
    const mcp = readFileSync(path.join(root, "app/(api)/api/mcp/route.ts"), "utf8");
    const tokenAuth = mcp.indexOf("const principal = await authenticateMcpRequest(request);");
    const betaCheck = mcp.indexOf("if (!(await canAccessBeta(principal.userId)))");
    assert.ok(tokenAuth >= 0 && betaCheck > tokenAuth);
    assert.equal(mcp.split("if (!(await canAccessBeta(principal.userId)))").length - 1, 3);
});
