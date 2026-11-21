import assert from "node:assert/strict";
import test from "node:test";
import { createScheduler, chooseNextUserItem, saveSchedulerState, loadSchedulerState } from "../../lib/playground/scheduler";
import { createInitialMemory } from "../../lib/playground/memory";
const now = Date.parse("2026-11-21T10:00:00Z");
for (const held of [false, true]) test(`reload preserves unfinished early practice (held=${held})`, () => {
    let raw = "";
    const storage = { setItem: (_key: string, value: string) => { raw = value; }, getItem: () => raw };
    const state = createScheduler(["a"], () => .5);
    const memories = { a: { ...createInitialMemory("u", "r", "a"), reviewCount: 1, stability: 8,
        lastReviewedAt: new Date(now).toISOString() } };
    if (held) state.struggles.a = { consecutiveFailures: 0, firstFailureAt: null, suspensionLevel: 1, suspendedUntil: now + 600000 };
    const selected = chooseNextUserItem(state, memories, () => .5, now, "input", undefined, "adaptive");
    assert.equal(selected?.reason, "early_practice");
    saveSchedulerState("playground", "u", "r", state, now, storage);
    const restored = loadSchedulerState("playground", "u", "r", ["a"], memories, now + 1000, "input", storage);
    assert.deepEqual(restored?.current, selected);
    assert.deepEqual(restored?.struggles, state.struggles);
});
test("invalid, stale and unavailable storage never prevents practice", () => {
    for (const raw of ["bad json", "{}", JSON.stringify({ version: 1, updatedAt: 0, state: createScheduler(["a"]) })])
        assert.equal(loadSchedulerState("playground", "u", "r", ["a"], {}, now, "input", { getItem: () => raw }), null);
    assert.doesNotThrow(() => saveSchedulerState("playground", "u", "r", createScheduler(["a"]), now,
        { setItem: () => { throw new Error("quota"); } }));
});
