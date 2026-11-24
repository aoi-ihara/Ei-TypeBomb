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
                return {
                    error:
                        name === "signInWithPassword"
                            ? (overrides.signInError ?? null)
                            : name === "updateUser"
                              ? (overrides.updateError ?? null)
                              : (overrides.recoveryError ?? null),
                };
            },
        ]),
    );
    auth.getUser = async () => ({
        data: { user: overrides.user === false ? null : { id: "verified", email: overrides.email ?? "registered@example.com", email_confirmed_at: overrides.unconfirmed ? null : "2026-11-23" } },
        error: null,
    });
    let recoveryCleared = false;
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
            if (id.endsWith("/password-recovery"))
                return {
                    PASSWORD_RESET_PATH: "/sign-in/reset-password",
                    hasPasswordRecovery: async () => overrides.recovery === true,
                    clearPasswordRecovery: async () => { recoveryCleared = true; },
                };
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
        recoveryCleared: () => recoveryCleared,
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

test("settings send the same reset link to the verified account email", async () => {
    const { submit, calls } = load();
    assert.equal(await submit("password-link", "other@example.com", "", "captcha"), null);
    assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[
        "resetPasswordForEmail", "registered@example.com",
        {
            captchaToken: "captcha",
            redirectTo: "https://etb.example/auth/confirm?next=/sign-in/reset-password?update=true",
        },
    ]]);
    for (const [options, token] of [[{ user: false }, "captcha"], [{ unconfirmed: true }, "captcha"], [{}, ""]]) {
        const fixture = load(options);
        assert.ok(await fixture.submit("password-link", "", "", token));
        assert.equal(fixture.calls.length, 0);
    }
});

test("password updates require a verified recovery session and consume it on success", async () => {
    const blocked = load();
    assert.match(await blocked.submit("password", "", "newpassword123", ""), /再設定リンク/);
    assert.equal(blocked.calls.length, 0);

    const verified = load({ recovery: true });
    assert.equal(await verified.submit("password", "", "newpassword123", ""), null);
    assert.deepEqual(JSON.parse(JSON.stringify(verified.calls)), [["updateUser", { password: "newpassword123" }]]);
    assert.equal(verified.recoveryCleared(), true);

    const rejected = load({ recovery: true, updateError: { code: "same_password" } });
    assert.match(await rejected.submit("password", "", "newpassword123", ""), /現在と異なる/);
    assert.equal(rejected.recoveryCleared(), false);
});

test("password reset link requests give a retry message when rate limited", async () => {
    const { submit } = load({ recoveryError: { code: "over_email_send_rate_limit" } });
    assert.match(await submit("password-link", "", "", "captcha"), /送信回数/);
});

test("reset link requests report a rejected CAPTCHA as a verification error", async () => {
    for (const mode of ["recovery", "password-link"]) {
        const { submit } = load({ recoveryError: { code: "captcha_failed" } });
        assert.equal(
            await submit(mode, "a@example.com", "", "captcha"),
            "ロボットではないことを確認できませんでした。再度お試しください。",
        );
    }
});

test("recovery proof is limited to the verified session and expires", async () => {
    const exports = {};
    const source = ts.transpileModule(
        readFileSync(new URL("../lib/auth/password-recovery.ts", `file://${__filename}`), "utf8"),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
    const cookies = new Map();
    let now = 1_000_000;
    vm.runInNewContext(source, {
        exports,
        Buffer,
        Date: { now: () => now },
        process: { env: { SUPABASE_SERVICE_ROLE_KEY: "test-only", NODE_ENV: "production" } },
        require(id) {
            if (id === "node:crypto") return require(id);
            if (id === "next/headers") return { cookies: async () => cookies };
            throw Error(id);
        },
    });
    const auth = (session_id, method) => ({
        getClaims: async () => ({ data: { claims: { session_id, amr: [{ method }] } } }),
    });
    const session = auth("session-one", "recovery");
    assert.equal(await exports.grantPasswordRecovery(auth("session-one", "password"), "token", "recovery"), false);
    assert.equal(await exports.hasPasswordRecovery(session), false);
    assert.equal(await exports.grantPasswordRecovery(session, "token", "recovery"), true);
    for (const [name, value] of cookies) cookies.set(name, { value });
    assert.equal(await exports.hasPasswordRecovery(session), true);
    assert.equal(await exports.hasPasswordRecovery(auth("session-two", "recovery")), false);
    now += 15 * 60 * 1000;
    assert.equal(await exports.hasPasswordRecovery(session), false);
});

const readAccountRoute = (file) => readFileSync(
    new URL("../app/(auth)/account/" + file, `file://${__filename}`),
    "utf8",
);

test("settings link to password recovery and the reset page checks recovery state", () => {
    const password = readAccountRoute("security/password/page.tsx");
    const email = readAccountRoute("security/email/page.tsx");
    assert.match(password, /<AuthForm mode="password-link"/);
    assert.match(email, /<AuthForm mode="email"/);
    for (const page of [password, email])
        assert.match(page, /backLink="\/account\/security"/);
    const resetPage = readFileSync(
        new URL("../app/(auth)/sign-in/reset-password/page.tsx", `file://${__filename}`),
        "utf8",
    );
    assert.match(resetPage, /mode=\{update \? "password" : "recovery"\}/);
    assert.match(resetPage, /await hasPasswordRecovery/);
});

test("account layout preserves apps, security, sign-out and protected nested settings", () => {
    const page = readAccountRoute("page.tsx");
    const layout = readAccountRoute("layout.tsx");
    const security = readAccountRoute("security/page.tsx");
    const accountPage = readAccountRoute("AccountPage.tsx");
    const requireUser = readAccountRoute("require-account-user.ts");
    const apps = readFileSync(
        new URL("../components/account/settings/Apps.tsx", `file://${__filename}`),
        "utf8",
    );
    const icon = readFileSync(
        new URL("../components/ui/Icon.tsx", `file://${__filename}`),
        "utf8",
    );
    assert.match(page, /<Apps \/>/);
    assert.doesNotMatch(page + layout, /mcpEnabled|ETB_MCP_OAUTH_ENABLED/);
    assert.match(layout, /label: "アプリ", iconName: "layoutGrid", href: "\/account"/);
    assert.match(layout, /label: "セキュリティ", iconName: "shield", href: "\/account\/security"/);
    assert.match(layout, /<Sidebar items=\{items\} actions=\{<AccountSignOut user=\{user\}/);
    assert.match(security, /href="\/account\/security\/email"/);
    assert.match(security, /href="\/account\/security\/password"/);
    assert.match(accountPage, /await requireAccountUser\(\)/);
    assert.match(requireUser, /if \(!user\) redirect\("\/sign-in"\)/);
    assert.match(apps, /listAuthorizedApps/);
    assert.match(icon, /shield: Shield/);
});

test("apps show an empty state rather than an error when MCP is disabled", async () => {
    const source = ts.transpileModule(
        readFileSync(
            new URL("../lib/auth/oauth-grants.ts", `file://${__filename}`),
            "utf8",
        ),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText;
    const exports = {};
    vm.runInNewContext(source, {
        exports,
        process: { env: { ETB_MCP_OAUTH_ENABLED: "false" } },
        require(id) {
            if (id.endsWith("/session"))
                return { getUser: () => { throw Error("unexpected user lookup"); } };
            if (id.endsWith("/provider"))
                return { getMcpProvider: () => { throw Error("unexpected provider lookup"); } };
            if (id.endsWith("/store")) return {};
            throw Error(id);
        },
    });
    const result = await exports.listAuthorizedApps();
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { apps: [], error: null });
});

test("only nested security links opt into directional navigation", () => {
    const security = readAccountRoute("security/page.tsx");
    const layout = readAccountRoute("layout.tsx");
    const accountPage = readAccountRoute("AccountPage.tsx");
    const sidebar = readFileSync(
        new URL("../components/layout/Sidebar.tsx", `file://${__filename}`), "utf8",
    );
    const shell = readFileSync(
        new URL("../components/layout/Shell.tsx", `file://${__filename}`), "utf8",
    );
    assert.match(security, /href="\/account\/security\/email" navigation="push"/);
    assert.match(security, /href="\/account\/security\/password" navigation="push"/);
    assert.match(layout, /<Navigation>\{children\}<\/Navigation>/);
    assert.match(accountPage, /back=\{backLink\}/);
    assert.match(shell, /navigation=\{back \? "pop" : undefined\}/);
    assert.doesNotMatch(sidebar, /navigation="(?:push|pop)"/);
});

test("navigation distance follows responsive Shell width without narrowing its viewport", () => {
    const readLayout = (file) => readFileSync(
        new URL("../components/layout/" + file, `file://${__filename}`), "utf8",
    );
    const shell = readLayout("Shell.tsx");
    const navigation = readLayout("Navigation.tsx");
    const css = readLayout("navigation.css");
    assert.match(shell, /data-navigation-shell-width\s+className=/);
    assert.match(navigation, /shell\?\.offsetWidth \|\| viewport\.clientWidth/);
    assert.match(navigation, /min-w-0 w-full overflow-x-clip/);
    assert.match(navigation, /slideFrames\(request\.direction === "push" \? "push-in" : "under-in", width, offset\)/);
    assert.match(css, /translateX\(var\(--etb-navigation-new-width, 100%\)\)/);
    assert.match(css, /translateX\(var\(--etb-navigation-old-width, 100%\)\)/);
    assert.match(css, /calc\(\s*var\(--etb-navigation-old-width, 100%\)\s*\*\s*var\(--etb-slide-offset\)\s*\*\s*-1\s*\)/);
    assert.match(css, /calc\(\s*var\(--etb-navigation-new-width, 100%\)\s*\*\s*var\(--etb-slide-offset\)\s*\*\s*-1\s*\)/);
});

test("native navigation keeps the cursor separate and refreshes on destination commit", () => {
    const readLayout = file => readFileSync(new URL("../components/layout/" + file, `file://${__filename}`), "utf8");
    const navigation = readLayout("Navigation.tsx");
    const css = readLayout("navigation.css");
    assert.match(navigation, /if \(matches && request\.transition\) beginNativeSlideCursor\(\);\s*stop\(request, !matches\)/);
    assert.match(navigation, /endNativeSlideCursor\(\)/);
    assert.match(css, /view-transition-name: etb-navigation-cursor/);
    assert.match(css, /::view-transition-old\(etb-navigation-cursor\) \{\s*display: none/);
});

test("root navigation preserves the full-height game layout and anchors game settings", () => {
    const read = file => readFileSync(new URL("../" + file, "file://" + __filename), "utf8");
    const nav = read("components/layout/Navigation.tsx");
    const root = read("app/layout.tsx");
    const game = read("components/game/GameView.tsx");
    assert.match(root, /<main className="[^"]*\bh-dvh\b[^"]*">\s*<Navigation root>/);
    assert.ok(nav.includes('root ? "h-full min-h-0 shrink-0" : ""'));
    assert.match(nav, /<div ref=\{content\} className=\{root \? "h-full" : undefined\}>/);
    assert.match(game, /w-full h-full\x60\}/);
    for (const mode of ["offline", "online"]) {
        const client = read("app/(game)/[link]/" + mode + "/Client.tsx");
        assert.match(client, /<header className="absolute top-0 right-0 flex justify-end p-4 gap-4">/);
    }
});
