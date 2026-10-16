/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const stored = new Map();
const localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
};
function evaluate(file, globals = {}) {
    const scope = { exports: {}, localStorage, ...globals };
    const source = fs.readFileSync(path.join(root, file), "utf8");
    vm.runInNewContext(
        ts.transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
            },
        }).outputText,
        scope,
    );
    return scope.exports;
}
const memory = evaluate("lib/playground/memory.ts");
const scheduler = evaluate("lib/playground/scheduler.ts", {
    require: () => memory,
});
const online = evaluate("lib/online/memory-session.ts", {
    require: (id) => (id.includes("scheduler") ? scheduler : memory),
});
const ids = ["one", "two", "three"];
const recall = {
    success: true,
    answerLength: 4,
    firstAttemptCorrect: true,
    attemptCount: 1,
    incorrectInputCount: 0,
    hintCount: 0,
    revealedHintChars: 0,
    maxCorrectPrefixLength: 4,
    recallLatencyMs: 100,
    elapsedMs: 700,
};

test("online recommends through the same Playground scheduler", () => {
    const session = online.createOnlineMemorySession("room", ids, null, {});
    const first = online.nextOnlineRecommendation(session);
    assert.ok(ids.includes(first));
    assert.equal(online.nextOnlineRecommendation(session), first);
    const updated = online.recordOnlineRecall(session, first, recall);
    assert.equal(updated.reviewCount, 1);
    assert.equal(session.scheduler.turn, 1);
    assert.equal(session.scheduler.userAnswered[first], 1);
    const second = online.nextOnlineRecommendation(session);
    assert.notEqual(second, first);
    assert.equal(session.scheduler.turn, 2);
});
test("guest online memory is visible to Playground and survives reload", () => {
    const session = online.createOnlineMemorySession("room", ids, null, {});
    const itemId = online.nextOnlineRecommendation(session);
    online.recordOnlineRecall(session, itemId, recall);
    const saved = online.loadOnlineGuestMemory("room", ids);
    assert.equal(saved[itemId].reviewCount, 1);
    assert.equal(
        JSON.parse(stored.get("playground-memory:guest:room"))[itemId].itemId,
        itemId,
    );
    assert.equal(
        Object.keys(online.loadOnlineGuestMemory("different", ids)).length,
        0,
    );
});
test("server fallback is recorded against the actual word, never the suggestion", () => {
    const session = online.createOnlineMemorySession("room", ids, "user", {});
    const recommendation = online.nextOnlineRecommendation(session);
    const actual = ids.find((id) => id !== recommendation);
    const updated = online.recordOnlineRecall(session, actual, recall);
    assert.equal(updated.itemId, actual);
    assert.equal(session.scheduler.userAnswered[recommendation] ?? 0, 0);
    assert.equal(session.scheduler.userAnswered[actual], 1);
    assert.equal(session.pending.get(actual), updated);
});
