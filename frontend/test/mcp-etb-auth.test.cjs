const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(path, requireMock, env) {
    const exports = {};
    const source = ts.transpileModule(
        readFileSync(new URL(path, `file://${__filename}`), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
    vm.runInNewContext(source, {
        exports,
        process: { env },
        require: requireMock,
    });
    return exports;
}

test("return destination stays within ETB", () => {
    const { safeReturnPath } = load("../lib/auth/return-path.ts", () => {
        throw Error("no imports expected");
    }, {});
    assert.equal(safeReturnPath("/api/oauth/interaction/123"), "/api/oauth/interaction/123");
    for (const unsafe of ["https://external.example", "//external.example", "/\\\\external.example", ""]) {
        assert.equal(safeReturnPath(unsafe), "/");
    }
});

test("MCP identity is verified from ETB's Supabase session cookies", async () => {
    let sessionCookies;
    let sessionConfig;
    let userResult = { data: { user: { id: "verified", is_anonymous: false } }, error: null };
    const { getMcpAuthenticatedUser } = load(
        "../lib/mcp/authorization-server/identity.ts",
        (id) => {
            if (id === "@supabase/ssr") return {
                createServerClient(_url, _key, config) {
                    sessionConfig = config;
                    sessionCookies = config.cookies.getAll();
                    return { auth: { getUser: async () => userResult } };
                },
            };
            if (id.endsWith("/cookie-options")) return { cookieOptions: { path: "/" } };
            throw new Error(id);
        },
        { NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" },
    );
    const req = { cookies: { "sb-project-auth-token": "session" } };
    assert.equal(await getMcpAuthenticatedUser(req), "verified");
    assert.equal(sessionCookies.length, 1);
    assert.equal(sessionCookies[0].name, "sb-project-auth-token");
    assert.equal(sessionCookies[0].value, "session");
    await getMcpAuthenticatedUser({ cookies: { valid: "session", missing: undefined } });
    assert.equal(sessionCookies.length, 1);
    assert.throws(() => sessionConfig.cookies.setAll([]), /proxy/);

    userResult = { data: { user: { id: "anonymous", is_anonymous: true } }, error: null };
    assert.equal(await getMcpAuthenticatedUser(req), null);
    userResult = { data: { user: { id: "unverified" } }, error: { message: "invalid" } };
    assert.equal(await getMcpAuthenticatedUser(req), null);
    userResult = { data: { user: null }, error: null };
    assert.equal(await getMcpAuthenticatedUser(req), null);
});
