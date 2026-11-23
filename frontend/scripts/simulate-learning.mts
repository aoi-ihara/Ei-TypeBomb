import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { simulate } from "../lib/playground/simulation";
const path = process.argv[2];
if (!path) throw new Error("Usage: npm run simulate:learning -- scenario.json [--json]");
const input = JSON.parse(readFileSync(path, "utf8"));
// A copied beta diagnostic is replayed with one default clean answer.
const scenario = input.replay ? { schemaVersion: 1, seed: 0, startAt: new Date(input.replay.now).toISOString(),
    items: [], snapshot: input.replay, steps: [{ result: "correct" }] } : input;
try {
    const output = simulate(scenario);
    let codeRevision = "unknown";
    try { codeRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch {}
    if (process.argv.includes("--json")) console.log(JSON.stringify({ codeRevision, ...output }, null, 2));
    else {
        console.log(`seed=${output.seed} code=${codeRevision} algorithm=${output.finalSnapshot.algorithmVersion}`);
        for (const turn of output.timeline) {
            const graph = turn.masteryGraph;
            console.log(`${turn.index + 1}\t${turn.selection?.itemId ?? "-"}\t${turn.selection?.reason ?? "empty"}\t${graph.calculatedAt}\tnow/3h/24h=${graph.totals.masteredNow}/${graph.totals.masteredAfter3Hours}/${graph.totals.masteredAfter24Hours} of ${graph.totals.total}\tsegments%=${JSON.stringify(graph.percentages)}`);
        }
        console.log(JSON.stringify(output.metrics));
    }
} catch (error) { console.error(`fixture=${path} seed=${scenario.seed}`, error); process.exitCode = 1; }
