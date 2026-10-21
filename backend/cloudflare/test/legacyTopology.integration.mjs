import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const fixture = `import {DurableObject} from 'cloudflare:workers';
export class ClusterDO extends DurableObject {
 async fetch(request) {
  if(request.method==='POST') await this.ctx.storage.put(await request.json());
  return Response.json(Object.fromEntries(await this.ctx.storage.list()));
 }
}
export default {fetch(request,env){return env.CLUSTER.get(env.CLUSTER.idFromName('server')).fetch(request)}};`;
const original = ["https://primary.test", "https://worker.test/ws", "https://render.test"];
const changed = ["https://replacement.test", ...original.slice(1)];

test("ClusterDO uses only the current topology namespace; old metadata remains unread", { timeout: 60000 }, async (t) => {
    const temp = await mkdtemp(resolve(tmpdir(), "etb-scoped-worker-"));
    t.after(() => rm(temp, { recursive: true, force: true }));
    const bundled = await build({ entryPoints: [resolve(root, "backend/cloudflare/src/index.ts")],
        bundle: true, format: "esm", target: "es2022", write: false,
        external: ["cloudflare:workers"] });
    let mf;
    const start = async (script, servers, legacy = false) => {
        mf = new Miniflare(convertV4MiniflareOptions({
            script, modules: true, resourcePersistencePath: temp,
            durableObjects: legacy ? { CLUSTER: { className: "ClusterDO", useSQLite: true } }
                : {
                    CLUSTER: { className: "ClusterDO", useSQLite: true },
                    REPLICAS: { className: "ReplicaDO", useSQLite: true },
                    ROOMS: { className: "GameRoom", useSQLite: true },
                },
            bindings: { ETB_CLUSTER_CONFIG: JSON.stringify({ version: 1, servers }) },
        }));
        await mf.ready;
    };
    const old = {
        boot: "previous-process", declaration: "previous-roster",
        credential: { sentinel: "old-secret" }, registry: [],
    };
    try {
        // Earlier releases stored everything in CLUSTER.idFromName("server").
        await start(fixture, original, true);
        assert.equal((await mf.dispatchFetch("https://worker.test/", {
            method: "POST", body: JSON.stringify(old),
        })).status, 200);
        await mf.dispose();

        await start(bundled.outputFiles[0].text, original);
        const first = await mf.dispatchFetch("https://worker.test/cluster/identity");
        assert.equal(first.status, 200, "new code must ignore the old DO entirely");
        const identity = await first.json();
        assert.notEqual(identity.boot, old.boot);
        await mf.dispose();

        await start(bundled.outputFiles[0].text, changed);
        const second = await mf.dispatchFetch("https://worker.test/cluster/identity");
        assert.equal(second.status, 200, "topology edits must no longer raise error 1101");
        assert.notEqual((await second.json()).boot, identity.boot,
            "different configuration must not reuse the same voter incarnation");
        await mf.dispose();

        await start(bundled.outputFiles[0].text, original);
        const third = await mf.dispatchFetch("https://worker.test/cluster/identity");
        assert.equal(third.status, 200);
        assert.equal((await third.json()).boot, identity.boot,
            "same configuration must continue to use its existing durable votes");
        await mf.dispose();

        // The old namespace has not been modified or imported.
        await start(fixture, original, true);
        assert.deepEqual(await (await mf.dispatchFetch("https://worker.test/")).json(), old);
    } finally { await mf?.dispose(); }
});
