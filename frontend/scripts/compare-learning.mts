import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
import { simulate } from "../lib/playground/simulation";

// Read-only baseline comparison: run the committed production functions, not a
// duplicate policy. Only the legacy modules' relative imports are supported.
const revision = process.argv[2];
const fixture = process.argv[3];
if (!revision || !fixture) throw new Error("Usage: tsx scripts/compare-learning.mts <git-revision> <scenario.json>");
const cache = new Map<string, Record<string, (...args: unknown[]) => unknown>>();
function baseline(name: string): Record<string, (...args: unknown[]) => unknown> {
    const existing = cache.get(name);
    if (existing) return existing;
    if (!/^[a-z-]+$/.test(name)) throw new Error("Unsupported baseline module");
    const source = execFileSync("git", ["show", `${revision}:frontend/lib/playground/${name}.ts`], { encoding: "utf8" });
    const exports = {};
    cache.set(name, exports);
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
        target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    } }).outputText, { exports, structuredClone, require: (path: string) => {
        if (!path.startsWith("./")) throw new Error("Unsupported baseline import");
        return baseline(path.slice(2));
    } });
    return exports;
}
const oldScheduler = baseline("scheduler");
const oldMemory = baseline("memory");
const output = simulate(JSON.parse(readFileSync(fixture, "utf8")));
let selectionDifferences = 0, inputUpdateDifferences = 0, graphDifferences = 0;
const equal = (a: unknown, b: unknown, category: "selection" | "input" | "graph") => {
    try { assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b))); }
    catch { if (category === "selection") selectionDifferences++; else if (category === "input") inputUpdateDifferences++; else graphDifferences++; }
};
for (const turn of output.timeline) {
    if (!turn.replay || !turn.selection) continue;
    const before = structuredClone(turn.replay);
    const draws = [...(turn.decision?.randomDraws ?? [])];
    const selected = oldScheduler.chooseNextUserItem(before.scheduler, before.memories,
        () => { if (!draws.length) throw new Error("Unexpected baseline RNG draw"); return draws.shift(); },
        before.now, "input", before.modes, "adaptive");
    equal(selected, turn.selection, "selection");
    const id = turn.selection.itemId;
    const identity = { memory: before.memories[id], userId: "simulation", roomId: "local", itemId: id, now: new Date(turn.answeredAt!) };
    if (before.modes[id] === "input") {
        equal(oldMemory.applyRecallObservation({ ...identity, observation: turn.observation }), turn.after, "input");
        oldScheduler.recordUserAnswer(before.scheduler, oldMemory.evaluateRecall(turn.observation), turn.answeredAt);
        equal(before.scheduler, turn.schedulerAfter, "input");
    }
    equal(oldMemory.getMasteryProgress(before.scheduler.itemIds,
        { ...before.memories, [id]: turn.after }, turn.answeredAt, .8, "input", before.modes), turn.masteryGraph.totals, "graph");
}
console.log(JSON.stringify({ baseline: revision, fixture, seed: output.seed, turnsCompared: output.timeline.length,
    selectionDifferences, inputUpdateDifferences, graphDifferences }));
