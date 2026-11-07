/* eslint-disable @typescript-eslint/no-require-imports */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
function load(file, globals = {}) {
    const scope = { exports: {}, ...globals };
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
            },
        }).outputText,
        scope,
    );
    return scope.exports;
}

const memory = load("lib/playground/memory.ts");
const scheduler = load("lib/playground/scheduler.ts", {
    require: () => memory,
});

test("retry intervals leave more room between repeated words", () => {
    assert.equal(scheduler.SHORT_RETRY_GAP, 5);
    assert.equal(scheduler.CONFIRM_RETRY_GAP, 8);

    const ids = Array.from({ length: 20 }, (_, index) => String(index));
    const state = scheduler.createScheduler(ids, () => 0);
    const first = scheduler.chooseNextUserItem(state);
    scheduler.recordUserAnswer(state, {
        retryNeed: "short",
        reason: "failed_recall",
        independent: false,
    });
    assert.equal(state.retries[first.itemId].earliestTurn, 6);

    let retry;
    while (!retry) {
        const selected = scheduler.chooseNextUserItem(state);
        scheduler.recordUserAnswer(
            state,
            selected.reason === "retry"
                ? { retryNeed: "none", independent: true }
                : { retryNeed: "none", independent: true },
        );
        if (selected.reason === "retry") retry = selected;
    }
    assert.equal(state.retries[first.itemId].earliestTurn, state.turn + 8);
});

test("retry intervals remain feasible in rooms smaller than the configured gap", () => {
    const state = scheduler.createScheduler(["a", "b"], () => 0);
    const first = scheduler.chooseNextUserItem(state);
    scheduler.recordUserAnswer(state, {
        retryNeed: "short",
        reason: "failed_recall",
        independent: false,
    });
    assert.equal(state.retries[first.itemId].earliestTurn, state.turn + 2);
});
