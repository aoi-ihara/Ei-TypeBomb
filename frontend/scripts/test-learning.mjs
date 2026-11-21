import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

// Keep legacy mixed suites intact until their source-extraction fixtures can be
// migrated independently. New focused suites are discovered automatically.
const learning = readdirSync("test/learning").filter(name => name.endsWith(".test.mts") && name !== "simulation.test.mts").map(name => `test/learning/${name}`);
const groups = {
    learning: ["test/answer-mode.test.mts", "test/scheduler-policy.test.mts", "test/practice-policy.test.mts", ...learning],
    game: ["test/playground.test.cjs", "test/online-memory.test.cjs", "test/retry-gap.test.cjs", "test/automatic-hint-evidence.test.cjs"],
    simulation: ["test/learning/simulation.test.mts"],
    fsrs: ["test/fsrs7-engine.test.mts"],
};
const group = process.argv[2];
const files = group === "all" ? Object.values(groups).flat() : groups[group];
if (!files) throw new Error(`Unknown test group: ${group}`);
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
