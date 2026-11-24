const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function load() {
    let previousId = null;
    const calls = [];
    const client = {
        get_property: (key) => (key === "$user_id" ? previousId : null),
        reset: () => {
            calls.push(["reset"]);
            previousId = null;
        },
        identify: (id, properties) => {
            calls.push(["identify", id, properties]);
            previousId = id;
        },
    };
    const exports = {};
    const source = ts.transpileModule(
        readFileSync(
            new URL("../lib/analytics/posthog-identity.ts", `file://${__filename}`),
            "utf8",
        ),
        { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } },
    ).outputText;
    vm.runInNewContext(source, {
        exports,
        require(id) {
            if (id === "posthog-js") return { __esModule: true, default: client };
            throw Error(id);
        },
    });
    return { identify: exports.identifyPostHogUser, calls };
}

test("identification uses UUID and sends both email person properties", () => {
    const { identify, calls } = load();
    identify({ id: "uuid-1", email: "new@example.com", displayName: "New name" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "identify");
    assert.equal(calls[0][1], "uuid-1");
    assert.equal(calls[0][2].email, "new@example.com");
    assert.equal(calls[0][2].$email, "new@example.com");
    assert.equal(calls[0][2].name, "New name");
});

test("verified email changes update the same identified person", () => {
    const { identify, calls } = load();
    identify({ id: "uuid-1", email: "before@example.com", displayName: null });
    identify({ id: "uuid-1", email: "after@example.com", displayName: null });
    assert.equal(calls.length, 2);
    assert.equal(calls[1][0], "identify");
    assert.equal(calls[1][1], "uuid-1");
    assert.equal(calls[1][2].email, "after@example.com");
});

test("switching signed-in accounts resets the previous identity", () => {
    const { identify, calls } = load();
    identify({ id: "uuid-1", email: "first@example.com", displayName: null });
    identify({ id: "uuid-2", email: "second@example.com", displayName: null });
    assert.deepEqual(calls.map((call) => call[0]), ["identify", "reset", "identify"]);
    assert.equal(calls[2][1], "uuid-2");
});

test("missing email does not create a fabricated person email", () => {
    const { identify, calls } = load();
    identify({ id: "uuid-1", email: null, displayName: null });
    assert.equal(calls[0][2].email, undefined);
    assert.equal(calls[0][2].$email, undefined);
});

test("room feed and confirmed account page both synchronize person details", () => {
    const roomList = readFileSync(
        new URL("../app/(game)/(browse)/RoomBrowser.tsx", `file://${__filename}`), "utf8",
    );
    const account = readFileSync(
        new URL("../components/account/settings/AccountSignOut.tsx", `file://${__filename}`), "utf8",
    );
    const accountPage = readFileSync(
        new URL("../app/(auth)/account/layout.tsx", `file://${__filename}`), "utf8",
    );
    const form = readFileSync(
        new URL("../components/account/AuthForm.tsx", `file://${__filename}`), "utf8",
    );
    assert.match(roomList, /identifyPostHogUser\(currentUser\)/);
    assert.match(account, /identifyPostHogUser\(user\)/);
    assert.match(accountPage, /user=\{user\}/);
    assert.match(form, /mode === "email"\) router\.refresh\(\)/);
});
