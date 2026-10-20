import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// Only fixture code writes/reads storage. The failing startup uses the real
// production ClusterDO constructor, in a separately restarted workerd process.
const fixture = `import {DurableObject} from 'cloudflare:workers';
export class ClusterDO extends DurableObject {
 async fetch(request) {
  if(request.method==='POST') await this.ctx.storage.put(await request.json());
  return Response.json(Object.fromEntries(await this.ctx.storage.list()));
 }
}
export default {fetch(request,env){return env.CLUSTER.get(env.CLUSTER.idFromName('server')).fetch(request)}};`;
const original = ["https://primary.test", "https://worker.test/ws", "https://render.test"];
const id = "https://worker.test";
const certificate = claims => `legacy.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.unused`;
const changes = {
    roster: [...original,"https://extra.test"],
    order: ["https://render.test","https://worker.test/ws","https://primary.test"],
    depth: ["https://worker.test/ws","https://primary.test","https://render.test"],
    parent: ["https://replacement.test","https://worker.test/ws","https://render.test"],
    transport: original,
};

test("real ClusterDO refuses legacy topology changes without replacing metadata or credentials", {timeout:60000}, async t => {
    const temp = await mkdtemp(resolve(tmpdir(),"etb-legacy-worker-"));
    t.after(()=>rm(temp,{recursive:true,force:true}));
    const bundled = await build({entryPoints:[resolve(root,"backend/cloudflare/src/index.ts")],bundle:true,
        format:"esm",target:"es2022",write:false,external:["cloudflare:workers"]});
    for (const [change,endpoints] of Object.entries(changes)) {
        const path = resolve(temp,change);
        let mf;
        const start = async (script,config,production=false) => {
            mf = new Miniflare(convertV4MiniflareOptions({
                script,modules:true,resourcePersistencePath:path,
                durableObjects: production ? {CLUSTER:{className:"ClusterDO",useSQLite:true},
                    REPLICAS:{className:"ReplicaDO",useSQLite:true},ROOMS:{className:"GameRoom",useSQLite:true}}
                    : {CLUSTER:{className:"ClusterDO",useSQLite:true}},
                bindings:{ETB_CLUSTER_CONFIG:JSON.stringify({version:1,servers:config}),SERVER_PUBLIC_URL:id},
            }));
            await mf.ready;
        };
        const claims = {sub:id,depth:1,parent:"https://primary.test",transport:change==="transport"?"socket.io":"websocket",
            roster:original.map(url=>new URL(url).origin)};
        const before = {certificate:certificate(claims),credential:{sentinel:"old-secret"},"identity-pins":{sentinel:"old-pin"},
            registry:[],sentinel:{promised:29}};
        // Missing boot also checks that rejection does not create one early.
        if (change!=="transport") before.boot="unchanged-boot";
        try {
            await start(fixture,original);
            assert.equal((await mf.dispatchFetch("https://fixture.test/",{method:"POST",body:JSON.stringify(before)})).status,200);
            await mf.dispose();
            await start(bundled.outputFiles[0].text,endpoints,true);
            const failed = await mf.dispatchFetch("https://worker.test/cluster/identity");
            assert.equal(failed.status,500,`${change}: incompatible legacy state must reject startup`);
            await mf.dispose();
            await start(fixture,original);
            const after = await (await mf.dispatchFetch("https://fixture.test/")).json();
            assert.deepEqual(after,before,`${change}: legacy storage values must remain unchanged`);
            // Restore the original configuration; for the old Node transport
            // case use a matching Worker declaration to test the positive path.
            if(change==="transport") {
                claims.transport="websocket";
                await mf.dispatchFetch("https://fixture.test/",{method:"POST",body:JSON.stringify({certificate:certificate(claims)})});
            }
            await mf.dispose();
            await start(bundled.outputFiles[0].text,original,true);
            const recovered = await mf.dispatchFetch("https://worker.test/cluster/identity");
            assert.equal(recovered.status,200,`${change}: original configuration remains bootable`);
            if(before.boot) assert.equal((await recovered.json()).boot,before.boot);
        } finally { await mf?.dispose(); }
    }
});
