const { spawnSync } = require("node:child_process");
const repeats = Number(process.env.ETB_RACE_REPEATS ?? 10);
if (!Number.isInteger(repeats) || repeats < 1 || repeats > 1000)
    throw new Error("ETB_RACE_REPEATS must be an integer between 1 and 1000");
for (let run = 1; run <= repeats; run++) {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--test",
        "test/distributedRuntime.test.ts", "test/peerConsensus.test.ts",
        "test/peerLink.test.ts", "test/routedFailure.test.ts"], { encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        process.stdout.write(result.stdout ?? "");
        process.stderr.write(result.stderr ?? "");
        process.exit(result.status ?? 1);
    }
    console.log(`Lifecycle / ownership / transport race pass ${run}/${repeats}`);
}
