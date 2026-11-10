const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(overrides = {}) {
    const calls = [];
    const auth = Object.fromEntries(
        [
            "signUp",
            "signInWithPassword",
            "resetPasswordForEmail",
            "updateUser",
        ].map((name) => [
            name,
            async (...args) => {
                calls.push([name, ...args]);
                return { error: null };
            },
        ]),
    );
    auth.getUser = async () => ({
        data: { user: overrides.user === false ? null : { id: "verified" } },
        error: null,
    });
    const exports = {};
    const source = ts.transpileModule(
        readFileSync(
            new URL("../lib/auth/account.ts", `file://${__filename}`),
            "utf8",
        ),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
    vm.runInNewContext(source, {
        exports,
        require(id) {
            if (id.endsWith("/db/server"))
                return { createClient: async () => ({ auth }) };
            if (id.endsWith("/validator"))
                return {
                    validateEmail: (e) =>
                        e.includes("@") ? null : "invalid email",
                    validatePassword: (p) =>
                        p.length >= 8 ? null : "invalid password",
                };
            if (id.endsWith("/base-url"))
                return { getEtbUrl: (path) => "https://etb.example" + path };
            throw Error(id);
        },
    });
    return { submit: exports.submitAccountForm, calls };
}

test("ETB password sign-in uses Supabase Auth even without legacy OAuth", async () => {
    const { submit, calls } = load();
    assert.equal(await submit("sign-in", "a@example.com", "password123", "captcha"), null);
    assert.equal(calls[0][0], "signInWithPassword");
    assert.equal(calls[0][1].options.captchaToken, "captcha");
});
test("public operations require CAPTCHA before calling Auth", async () => {
    for (const mode of ["sign-in", "sign-up", "recovery"]) {
        const { submit, calls } = load();
        assert.ok(await submit(mode, "a@example.com", "password123", ""));
        assert.equal(calls.length, 0);
    }
});
test("credential changes require a verified user", async () => {
    for (const mode of ["email", "password"]) {
        const { submit, calls } = load({ user: false });
        assert.ok(await submit(mode, "a@example.com", "password123", ""));
        assert.equal(calls.length, 0);
    }
});
test("invalid mode, email and password never call Auth mutations", async () => {
    for (const args of [
        ["admin", "a@example.com", "password123"],
        ["sign-up", "bad", "password123"],
        ["password", "", "short"],
    ]) {
        const { submit, calls } = load();
        assert.ok(await submit(...args, "captcha"));
        assert.equal(calls.length, 0);
    }
});
test("signup and recovery use trusted ETB callbacks and pass CAPTCHA to Auth", async () => {
    const { submit, calls } = load();
    assert.equal(
        await submit("sign-up", "a@example.com", "password123", "captcha"),
        null,
    );
    assert.equal(
        calls[0][1].options.emailRedirectTo,
        "https://etb.example/auth/confirm",
    );
    assert.equal(calls[0][1].options.captchaToken, "captcha");
    assert.equal(
        await submit("recovery", "a@example.com", "", "captcha2"),
        null,
    );
    assert.equal(
        calls[1][2].redirectTo,
        "https://etb.example/auth/confirm?next=/sign-in/reset-password?update=true",
    );
    assert.equal(calls[1][2].captchaToken, "captcha2");
});
