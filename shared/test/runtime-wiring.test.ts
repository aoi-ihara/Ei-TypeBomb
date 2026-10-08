import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("both runtime adapters import and apply the same shared game core", () => {
    // This guards the adapter boundary in addition to behavioral core/transport tests.
    for (const runtime of ["server", "cloudflare"]) {
        const source = readFileSync(resolve(__dirname, "../../", runtime, "src/index.ts"), "utf8");
        assert.match(source, /import\s*\{[^}]*applyGameEvent[^}]*\}\s*from\s*["']\.\.\/\.\.\/shared\/game["']/);
        assert.match(source, /applyGameEvent\(/);
        assert.doesNotMatch(source, /bombHolder\s*=\s*\([^;]+\+\s*1\)\s*%/);
    }
});
