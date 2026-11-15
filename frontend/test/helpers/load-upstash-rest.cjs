/* eslint-disable @typescript-eslint/no-require-imports */
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Cache-module tests already run their TypeScript in isolated VM contexts.
// Load the real shared REST implementation with the SAME fake env/fetch, so
// failure handling, namespaces and outbound command shapes are exercised.
const compiled = ts.transpileModule(
    readFileSync(path.join(__dirname, "../../lib/room/upstash-rest.ts"), "utf8"),
    {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.CommonJS,
            esModuleInterop: true,
        },
    },
).outputText;

module.exports = function loadUpstashRest(context) {
    const exports = {};
    vm.runInNewContext(compiled, {
        exports,
        require(id) {
            if (id === "server-only") return {};
            throw Error("Unexpected shared Redis dependency: " + id);
        },
        process: context.process,
        fetch: context.fetch,
        AbortSignal: context.AbortSignal,
    });
    return exports;
};
