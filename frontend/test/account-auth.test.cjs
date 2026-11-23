const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load(overrides = {}) {
    const calls = [];
    const updateErrors = [...(overrides.updateErrors ?? [])];
    const auth = Object.fromEntries(
        [
            "signUp",
            "signInWithPassword",
            "resetPasswordForEmail",
            "updateUser",
            "reauthenticate",
        ].map((name) => [
            name,
            async (...args) => {
                calls.push([name, ...args]);
                return {
                    error:
                        name === "signInWithPassword"
                            ? (overrides.signInError ?? null)
                            : name === "updateUser"
                              ? (updateErrors.length
                                    ? updateErrors.shift()
                                    : (overrides.updateError ?? null))
                              : name === "reauthenticate"
                                ? (overrides.reauthError ?? null)
                                : null,
                };
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
    return {
        submit: exports.submitAccountForm,
        requestReauth: exports.requestPasswordReauthentication,
        calls,
    };
}

test("ETB password sign-in uses Supabase Auth even without legacy OAuth", async () => {
    const { submit, calls } = load();
    assert.equal(
        await submit("sign-in", "a@example.com", "password123", "captcha"),
        null,
    );
    assert.equal(calls[0][0], "signInWithPassword");
    assert.equal(calls[0][1].options.captchaToken, "captcha");
});
test("invalid sign-in credentials use the same neutral message", async () => {
    for (const signInError of [
        { code: "invalid_credentials" },
        { message: "Invalid login credentials" },
    ]) {
        const { submit } = load({ signInError });
        assert.equal(
            await submit("sign-in", "a@example.com", "wrongpass123", "captcha"),
            "入力内容が不正確です。",
        );
    }
    const { submit } = load({ signInError: { code: "email_not_confirmed" } });
    assert.notEqual(
        await submit("sign-in", "a@example.com", "password123", "captcha"),
        "入力内容が不正確です。",
    );
});

test("signup success has a dedicated screen with no remaining form", () => {
    const form = readFileSync(
        new URL("../components/account/AuthForm.tsx", `file://${__filename}`),
        "utf8",
    );
    const page = readFileSync(
        new URL("../app/(auth)/sign-up/check-email/page.tsx", `file://${__filename}`),
        "utf8",
    );
    assert.match(form, /else if \(mode === "sign-up"\)\s+router\.replace\("\/sign-up\/check-email"\)/);
    assert.match(form, /setError\("入力内容が不正確です。"\)/);
    assert.match(page, /<Shell title="メールをご確認ください">/);
    assert.doesNotMatch(page, /AuthForm|<Button/);
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

test("recently signed-in users can change passwords without OTP", async () => {
    const { submit, calls } = load();
    assert.equal(await submit("password", "", "newpassword123", ""), null);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "updateUser");
    assert.equal(calls[0][1].password, "newpassword123");
    assert.equal(calls[0][1].nonce, undefined);
});

test("reauthentication_needed sends a confirmation code", async () => {
    const { submit, calls } = load({
        updateError: { code: "reauthentication_needed" },
    });
    assert.equal(
        (await submit("password", "", "newpassword123", "")).reauthenticationRequired,
        true,
    );
    assert.deepEqual(
        calls.map((call) => call[0]),
        ["updateUser", "reauthenticate"],
    );
});

test("verified nonce is passed only with password updates", async () => {
    const { submit, calls } = load();
    assert.equal(
        await submit("password", "", "newpassword123", "", " 123456 "),
        null,
    );
    assert.equal(calls[0][1].password, "newpassword123");
    assert.equal(calls[0][1].nonce, "123456");
    assert.equal(await submit("email", "a@example.com", "", ""), null);
    assert.equal(calls[1][1].nonce, undefined);
});

test("invalid confirmation codes never reach Supabase Auth", async () => {
    for (const code of ["", "12ab56", "12345", "1234567"]) {
        const { submit, calls } = load();
        assert.equal(
            await submit("password", "", "newpassword123", "", code),
            "確認コードは6桁の数字で入力してください。",
        );
        assert.equal(calls.length, 0);
    }
});

test("invalid and expired confirmation codes are recoverable", async () => {
    for (const code of [
        "reauthentication_not_valid",
        "otp_expired",
        "reauthentication_needed",
        "reauth_nonce_missing",
    ]) {
        const { submit, calls } = load({ updateError: { code } });
        assert.match(
            await submit("password", "", "newpassword123", "", "123456"),
            /確認コード/,
        );
        assert.equal(
            calls.filter((call) => call[0] === "reauthenticate").length,
            0,
        );
    }
});

test("sending a confirmation code handles rate limiting", async () => {
    const { submit, calls } = load({
        updateError: { code: "reauthentication_needed" },
        reauthError: { code: "over_email_send_rate_limit" },
    });
    assert.match(
        await submit("password", "", "newpassword123", ""),
        /送信回数/,
    );
    assert.deepEqual(
        calls.map((call) => call[0]),
        ["updateUser", "reauthenticate"],
    );
});

test("resending confirmation codes requires a signed-in user", async () => {
    const { requestReauth, calls } = load();
    assert.equal(await requestReauth(), null);
    assert.deepEqual(
        calls.map((call) => call[0]),
        ["reauthenticate"],
    );
    const unauthorized = load({ user: false });
    assert.equal(
        await unauthorized.requestReauth(),
        "サインインし直してください。",
    );
    assert.equal(unauthorized.calls.length, 0);
});

test("password form shows a code input only during reauthentication", () => {
    const form = readFileSync(
        new URL("../components/account/AuthForm.tsx", `file://${__filename}`),
        "utf8",
    );
    assert.match(form, /mode === "password" && reauthenticationRequired/);
    assert.match(form, /autoComplete="one-time-code"/);
    assert.match(form, /requestPasswordReauthentication\(\)/);
    assert.match(form, /setReauthenticationRequired\(false\)/);
});
