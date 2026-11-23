import assert from "node:assert/strict";
import test from "node:test";
import { simulate, type Scenario } from "../../lib/playground/simulation";
import { createScheduler, chooseNextUserItem } from "../../lib/playground/scheduler";
import { createInitialMemory } from "../../lib/playground/memory";
import { snapshot } from "../../lib/playground/replay";
const startAt = "2026-11-21T10:00:00.000Z";
const sizes = [1, 2, 3, 4, 8, 20, 100];
const seeds = process.env.ETB_LONG_SIMULATION ? Array.from({ length: 20 }, (_, i) => i) : [42];
for (const size of sizes) for (const seed of seeds) for (const result of ["correct", "wrong", "hint"] as const) {
    test(`${size} mixed-mode items, seed ${seed}, ${result}: deterministic bounded state and forecast`, () => {
        const scenario: Scenario = { schemaVersion: 1, seed, startAt,
            items: Array.from({ length: size }, (_, i) => ({ id: `w${i}`, mode: i % 2 ? "selection" : "input" })),
            steps: Array.from({ length: process.env.ETB_LONG_SIMULATION ? 500 : 30 }, (_, i) => ({ advanceMs: 15000, result, reload: i % 7 === 0 })) };
        const output = simulate(scenario);
        assert.deepEqual(output, simulate(scenario), `seed=${seed} size=${size}`);
        for (const turn of output.timeline) {
            const { total, masteredNow: n, masteredAfter3Hours: h, masteredAfter24Hours: d } = turn.masteryGraph.totals;
            assert(d >= 0 && d <= h && h <= n && n <= total);
            assert.equal(Object.values(turn.masteryGraph.segments).reduce((a, b) => a + b, 0), total);
            assert(Math.abs(Object.values(turn.masteryGraph.percentages).reduce((a, b) => a + b, 0) - 100) < 1e-9);
            assert(Object.keys(turn.schedulerAfter!.retries).length <= 4);
            if (turn.selection?.reason === "early_practice" && result === "correct" && turn.before) {
                // An early clean answer can earn weak time-weighted stability,
                // but never moves the long-term spaced-review reference.
                assert.equal(turn.after!.lastReviewedAt, turn.before.lastReviewedAt);
                if (turn.before.lastReviewedAt) {
                    const gain = turn.after!.stability - turn.before.stability;
                    assert(gain >= 0, `early practice unexpectedly reduced stability: ${gain}`);
                    const elapsedMs = Math.max(0, turn.presentedAt -
                        Date.parse(turn.before.lastPresentedAt ?? turn.before.lastReviewedAt));
                    assert(gain <= elapsedMs / 86_400_000 * 0.25 + 1e-10,
                        `early practice over-credited retention: ${gain}`);
                }
            }
        }
    });
}
test("failed word leaves its retry queue after independent successful confirmations", () => {
    const output = simulate({ schemaVersion: 1, seed: 42, startAt,
        items: ["a", "b", "c", "d"].map(id => ({ id, mode: "input" })),
        steps: [{ result: "wrong" }, ...Array.from({ length: 30 }, () => ({ advanceMs: 20000, result: "correct" }))] });
    assert.deepEqual(output.finalSnapshot.scheduler.retries, {});
    assert(Object.keys(output.metrics.frequency).length > 1);
    assert(output.metrics.consecutiveRepeats < 4);
});
test("due review outranks unrelated new items and trace agrees with actual choice", () => {
    const now = Date.parse(startAt);
    const state = createScheduler(["new", "due"], () => .5);
    const memories = { due: { ...createInitialMemory("u", "r", "due"), reviewCount: 1, stability: .3,
        lastReviewedAt: new Date(now - 86400000).toISOString() } };
    const output = simulate({ schemaVersion: 1, seed: 42, startAt, items: [],
        snapshot: snapshot(state, memories, { due: "input", new: "input" }, now, 42), steps: [{ result: "correct" }] });
    assert.equal(output.timeline[0].selection?.itemId, "due");
    assert.equal(output.timeline[0].selection?.reason, "long_term_due");
    assert.deepEqual(output.timeline[0].selection, output.timeline[0].decision?.selection);
});
test("snapshot continuation is equivalent at 1 hour, 1 day and 7 days", () => {
    for (const advanceMs of [3600000, 86400000, 604800000]) {
        const base: Scenario = { schemaVersion: 1, seed: 7, startAt,
            items: [{ id: "a", mode: "input" }, { id: "b", mode: "selection" }], steps: [{ result: "wrong" }] };
        const prefix = simulate(base);
        const suffix = [{ result: "correct" as const, advanceMs }, { result: "hint" as const, advanceMs: 15000 }];
        const restored = simulate({ ...base, snapshot: JSON.parse(JSON.stringify(prefix.finalSnapshot)), steps: suffix });
        const all = simulate({ ...base, steps: [...base.steps, ...suffix] });
        assert.deepEqual(restored.finalSnapshot, all.finalSnapshot);
    }
});
test("diagnostic observer neither draws random values nor changes selection or memory", () => {
    const a = createScheduler(["a", "b"], () => .3), b = structuredClone(a);
    let firstDraws = 0, secondDraws = 0;
    const left = chooseNextUserItem(a, {}, () => { firstDraws++; return .7; }, Date.parse(startAt), "input", undefined);
    const right = chooseNextUserItem(b, {}, () => { secondDraws++; return .7; }, Date.parse(startAt), "input", undefined, () => {});
    assert.deepEqual(left, right); assert.deepEqual(a, b); assert.equal(firstDraws, secondDraws);
});
test("invalid schemas and unsafe record identifiers are rejected", () => {
    assert.throws(() => simulate({ schemaVersion: 2 }));
    assert.throws(() => simulate({ schemaVersion: 1, seed: 42, startAt, items: [{ id: "__proto__", mode: "input" }], steps: [] }));
});

for (const size of sizes) test(`${size} items with one permanent failure keep bounded retries and progress`, () => {
    const output = simulate({ schemaVersion: 1, seed: 42, startAt,
        items: Array.from({ length: size }, (_, i) => ({ id: `w${i}`, mode: "input" })),
        steps: Array.from({ length: 60 }, () => ({ advanceMs: 15000, result: "correct", resultsByItem: { w0: "wrong" } })) });
    assert.equal(output.timeline.length, 60);
    for (const turn of output.timeline) {
        assert(Object.keys(turn.schedulerAfter!.retries).length <= 4);
        assert.equal(turn.observation?.success, turn.selection?.itemId !== "w0");
    }
    if (size > 1) assert(Object.keys(output.metrics.frequency).length > 1);
});
