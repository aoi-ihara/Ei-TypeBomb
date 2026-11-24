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
    localStorage,
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
test("room snapshots do not resend consumed recommendations", () => {
    const session = online.createOnlineMemorySession("dedupe-room", ids, null, {});
    const first = online.nextUnsentOnlineRecommendation(session, null);
    assert.ok(first);
    assert.equal(
        online.nextUnsentOnlineRecommendation(session, first),
        null,
    );
    const again = online.nextUnsentOnlineRecommendation(session, null);
    assert.equal(again.itemId, first.itemId);
    assert.equal(again.turn, first.turn);

    online.recordOnlineRecall(session, first.itemId, recall);
    const second = online.nextUnsentOnlineRecommendation(session, first);
    assert.ok(second);
    assert.notEqual(second.turn, first.turn);
    assert.equal(online.nextUnsentOnlineRecommendation(session, second), null);
});

test("online selection answers persist recognition without recording free recall", () => {
    const session = online.createOnlineMemorySession("choice-room", ids, null, {});
    const itemId = online.nextOnlineRecommendation(session);
    const updated = online.recordOnlineAnswerModeResult(
        session,
        itemId,
        "selection",
        true,
    );
    assert.equal(updated.answerModeStats.recognition.attempts, 1);
    assert.equal(updated.answerModeStats.recognition.correct, 1);
    assert.equal(updated.answerModeStats.recognition.correctStreak, 1);
    assert.equal(updated.reviewCount, 0);
    assert.equal(session.scheduler.current, null);
    assert.equal(session.scheduler.userAnswered[itemId], 1);
    assert.equal(
        online.loadOnlineGuestMemory("choice-room", ids)[itemId]
            .answerModeStats.recognition.correctStreak,
        1,
    );
});

test("online incorrect selection schedules a retry but never credits free recall", () => {
    const session = online.createOnlineMemorySession("mistake-choice-room", ids, null, {});
    const itemId = online.nextOnlineRecommendation(session);
    const updated = online.recordOnlineAnswerModeResult(
        session, itemId, "selection", true, undefined, true,
    );
    assert.equal(updated.answerModeStats.recognition.attempts, 1);
    assert.equal(updated.answerModeStats.recognition.correct, 0);
    assert.equal(updated.reviewCount, 0);
    assert.equal(session.scheduler.current, null);
    assert.equal(session.scheduler.retries[itemId].reason, "failed_recall");
    assert.equal(
        online.loadOnlineGuestMemory("mistake-choice-room", ids)[itemId]
            .answerModeStats.recognition.correct,
        0,
    );
});

test("online choice speed is recorded only for clean recognition", () => {
    const roomId = "choice-speed-room";
    const session = online.createOnlineMemorySession(roomId, ids, null, {});
    const first = online.nextOnlineRecommendation(session);
    const clean = online.recordOnlineAnswerModeResult(
        session, first, "selection", true, undefined, false, 1_200,
    );
    assert.equal(clean.answerModeStats.recognition.averageResponseMs, 1_200);
    const second = online.nextOnlineRecommendation(session);
    const afterMistake = online.recordOnlineAnswerModeResult(
        session, second, "selection", true, undefined, true, 200,
    );
    assert.equal(afterMistake.answerModeStats.recognition.averageResponseMs, undefined);
    assert.equal(afterMistake.answerModeStats.recognition.correct, 0);
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
    const pending = new Map();
    const session = online.createOnlineMemorySession("room", ids, "user", {}, undefined, 4,
        memory => pending.set(memory.itemId, memory));
    const recommendation = online.nextOnlineRecommendation(session);
    const actual = ids.find((id) => id !== recommendation);
    const updated = online.recordOnlineRecall(session, actual, recall);
    assert.equal(updated.itemId, actual);
    assert.equal(session.scheduler.userAnswered[recommendation] ?? 0, 0);
    assert.equal(session.scheduler.userAnswered[actual], 1);
    assert.equal(pending.get(actual), updated);
});

test("online recommendations and retries survive a new session after reload", () => {
    const roomId = "online-reload";
    const session = online.createOnlineMemorySession(roomId, ids, "online-user", {});
    const first = online.nextOnlineRecommendation(session);
    online.recordOnlineRecall(session, first, recall);
    const expected = online.nextOnlineRecommendation(session);
    const resumed = online.createOnlineMemorySession(
        roomId, ids, "online-user", session.memory,
    );
    assert.equal(online.nextOnlineRecommendation(resumed), expected);
    assert.equal(resumed.scheduler.userAnswered[first], 1);
    assert.equal(resumed.scheduler.turn, session.scheduler.turn);
    assert.equal(
        online.createOnlineMemorySession(roomId, ids, "different-user", {}).scheduler.turn,
        0,
    );
});

test("a forced single choice advances online play without recording recognition", () => {
    const pending = [];
    const session = online.createOnlineMemorySession("forced-choice", ["one"], "user", {}, { one: "selection" }, 1,
        memory => pending.push(memory));
    assert.equal(online.nextOnlineRecommendation(session), "one");
    online.recordOnlineAnswerModeResult(session, "one", "selection", true);
    assert.equal(session.scheduler.current, null);
    assert.equal(session.memory.one, undefined);
    assert.equal(pending.length, 0);
    assert.equal(online.nextOnlineRecommendation(session), "one");
});
