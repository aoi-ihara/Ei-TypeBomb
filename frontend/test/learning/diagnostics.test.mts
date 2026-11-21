import assert from "node:assert/strict";
import test from "node:test";
import { getMasteryGraph } from "../../lib/playground/mastery-graph";
import { createInitialMemory, getMasteryProgress } from "../../lib/playground/memory";
import { createScheduler, chooseNextUserItem } from "../../lib/playground/scheduler";
import { captureDecision, diagnosticJSON, type CapturedDecision } from "../../lib/playground/diagnostics";
import { simulate } from "../../lib/playground/simulation";
const now = Date.parse("2026-11-21T10:00:00Z");
test("copied JSON anonymizes identifiers, uses current graph, and replays the actual choice", () => {
    const ids = ["private-word-a", "private-word-b"];
    const state = createScheduler(ids, () => .7);
    const memories = { [ids[0]]: { ...createInitialMemory("secret-user", "secret-room", ids[0]),
        reviewCount: 1, lastReviewedAt: new Date(now - 86400000).toISOString() } };
    const modes = Object.fromEntries(ids.map(id => [id, "input" as const]));
    let captured: CapturedDecision | null = null;
    chooseNextUserItem(state, memories, () => .5, now, "input", modes, trace => { captured = captureDecision(trace, memories, modes); });
    const graph = getMasteryGraph(ids, memories, now + 3600000, "input", modes, true);
    const json = diagnosticJSON(captured, graph, ids)!;
    for (const secret of [...ids, "secret-user", "secret-room"]) assert(!json.includes(secret));
    const copied = JSON.parse(json);
    assert.deepEqual(copied.masteryGraph.totals, getMasteryProgress(ids, memories, now + 3600000));
    assert.equal(copied.masteryGraph.calculatedAt, new Date(now + 3600000).toISOString());
    const replay = simulate({ schemaVersion: 1, seed: 0, startAt: new Date(now).toISOString(), items: [], snapshot: copied.replay, steps: [{ result: "correct" }] });
    assert.deepEqual(replay.timeline[0].decision, copied.decision);
});
test("empty, duplicate, missing and invalid-date memories produce finite graph values", () => {
    const empty = getMasteryGraph([], {}, now, "input", undefined, true);
    assert.deepEqual(Object.values(empty.percentages), [0, 0, 0, 0]);
    const memories = { bad: { ...createInitialMemory("u", "r", "bad"), reviewCount: 2, lastReviewedAt: "bad", stability: NaN } };
    const graph = getMasteryGraph(["bad", "bad", "missing"], memories, now, "input", undefined, true);
    assert.equal(graph.totals.total, 2);
    assert.equal(graph.items!.length, 2);
    assert(graph.items!.every(item => item.probabilities.every(Number.isFinite)));
    assert.equal(graph.totals.masteredNow, 0);
});

test("non-finite stored stability cannot report perfect mastery", () => {
    const memories = { bad: { ...createInitialMemory("u", "r", "bad"), reviewCount: 2,
        lastReviewedAt: new Date(now - 86400000).toISOString(), stability: Infinity } };
    const graph = getMasteryGraph(["bad"], memories, now, "input", undefined, true);
    assert.equal(graph.totals.masteredNow, 0);
    assert.equal(graph.items![0].reason, "invalid_memory");
});

test("inclusive 0.8 boundary and mixed mode use the same production prediction", () => {
    const elapsed = 86400000;
    const base = { ...createInitialMemory("u", "r", "a"), reviewCount: 1,
        stability: -(elapsed / 86400000) / Math.log(.8), lastReviewedAt: new Date(now - elapsed).toISOString() };
    const graph = getMasteryGraph(["a", "b"], { a: base, b: { ...base, itemId: "b" } }, now,
        "input", { a: "input", b: "selection" }, true);
    assert.equal(graph.items![0].probabilities[0], .8);
    assert.equal(graph.items![0].aboveThreshold[0], true);
    assert.equal(graph.items![1].probabilities[0], 0);
    assert.equal(graph.totals.masteredNow, 1);
    const later = getMasteryGraph(["a"], { a: base }, now + 1, "input");
    assert.equal(later.totals.masteredNow, 0);
});

test("Supabase timezone-offset memory timestamps are valid in snapshots and copied diagnostics", () => {
    const offset = "2026-11-21T10:00:00+00:00";
    const offsetWithMinutes = "2026-11-21T19:00:00+09:00";
    const id = "private-word-offset";
    const memory = {
        ...createInitialMemory("secret-user", "secret-room", id),
        reviewCount: 1, lastReviewedAt: offset, lastPresentedAt: offsetWithMinutes,
        createdAt: offset, updatedAt: offsetWithMinutes,
        answerModeStats: {
            recall: { attempts: 1, correct: 1, correctStreak: 1, lastAttemptAt: offset },
            recognition: { attempts: 1, correct: 1, correctStreak: 1,
                lastAttemptAt: offsetWithMinutes, lastReviewedAt: offset },
        },
    };
    const state = createScheduler([id], () => .5);
    const memories = { [id]: memory };
    const modes = { [id]: "input" as const };
    let captured: CapturedDecision | null = null;
    const selected = chooseNextUserItem(state, memories, () => .5, now, "input", modes,
        trace => { captured = captureDecision(trace, memories, modes); });
    assert.equal(selected?.itemId, id);
    assert(captured, "diagnostics must be available for authenticated learners");
    const json = diagnosticJSON(captured, getMasteryGraph([id], memories, now, "input", modes, true), [id]);
    assert(json, "diagnostics must serialize");
    assert(!json.includes(id));
    assert(!json.includes("secret-user"));
    assert(!json.includes("secret-room"));
    const parsed = JSON.parse(json);
    assert.equal(parsed.replay.memories["item-1"].lastReviewedAt, offset);
    assert.equal(parsed.replay.memories["item-1"].lastPresentedAt, offsetWithMinutes);
    assert.equal(parsed.replay.memories["item-1"].updatedAt, offsetWithMinutes);
    assert.equal(parsed.replay.memories["item-1"].answerModeStats.recognition.lastAttemptAt, offsetWithMinutes);
});
