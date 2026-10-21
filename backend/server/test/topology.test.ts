import assert from "node:assert/strict";
import test from "node:test";
import { parseServerTopology } from "../../shared/topology";
import { assertClusterIdentity } from "../../shared/distributed/control";

const primary = "https://primary.example.test";
const worker = "https://worker.example.test/ws";

const current = JSON.stringify({version:1, servers:[
    primary, worker, "https://render.example.test",
]});

test("without ETB_CLUSTER_CONFIG even former topology variables are ignored", () => {
    assert.deepEqual(parseServerTopology({}), {
        role: "standalone", primaryUrl: null, parentUrl: null, publicUrl: null,
    });
    const legacy = {
        ETB_CLUSTER_CONFIG: undefined,
        PRIMARY_SERVER_URL: primary,
        PARENT_SERVER_URL: worker,
    };
    assert.equal(parseServerTopology(legacy).role, "standalone");
});

test("current JSON selects primary and replica parent by order", () => {
    assert.deepEqual(parseServerTopology({ ETB_CLUSTER_CONFIG: current }, "socket.io"), {
        role: "primary", primaryUrl: primary, parentUrl: null, publicUrl: primary,
    });
    assert.deepEqual(parseServerTopology({
        ETB_CLUSTER_CONFIG: current,
        SERVER_PUBLIC_URL: "https://render.example.test",
    }, "socket.io"), {
        role: "replica", primaryUrl: primary,
        parentUrl: new URL(worker).origin,
        publicUrl: "https://render.example.test",
    });
});

test("obsolete variables cannot override the current JSON", () => {
    const env = { ETB_CLUSTER_CONFIG: current, SERVER_PUBLIC_URL: primary,
        PRIMARY_SERVER_URL: "https://obsolete.example.test",
        PARENT_SERVER_URL: "https://other.example.test" };
    assert.equal(parseServerTopology(env, "socket.io").role, "primary");
});

import { parseETBClusterConfig } from "../../shared/clusterConfig";
test("a single JSON value defines ordered hosts and Worker /ws transport", () => {
    const config = JSON.stringify({ version: 1, servers: [
        "https://primary.example.com", "https://worker.example.com/ws", "https://render.example.com"
    ] });
    const servers = parseETBClusterConfig(config);
    assert.deepEqual(servers.map(s => s.transport), ["socket.io","websocket","socket.io"]);
    assert.deepEqual(servers.map(s => s.origin), [
        "https://primary.example.com", "https://worker.example.com", "https://render.example.com"
    ]);
});
test("invalid shared topology is rejected", () => {
    for (const config of [
        '{"version":2,"servers":["https://a.test"]}',
        '{"version":1,"servers":[]}',
        '{"version":1,"servers":["https://a.test","https://a.test/ws"]}',
        '{"version":1,"servers":["http://example.com"]}',
        '{"version":1,"servers":["https://a.test/path"]}',
        '{"version":1,"servers":["https://a.test/?token=1"]}',
    ]) assert.throws(() => parseETBClusterConfig(config));
});
test("keyless topology selects local Primary, Render URL and Worker without a token", () => {
    const ETB_CLUSTER_CONFIG = JSON.stringify({ version: 1, servers: [primary, worker, "https://render.test"] });
    assert.equal(parseServerTopology({ETB_CLUSTER_CONFIG}, "socket.io").publicUrl, primary);
    assert.equal(parseServerTopology({ETB_CLUSTER_CONFIG}, "websocket").publicUrl, new URL(worker).origin);
    assert.equal(parseServerTopology({ETB_CLUSTER_CONFIG, RENDER_EXTERNAL_URL:"https://render.test"}, "socket.io").role, "replica");
});

test("public server roster cannot silently disagree with public config", async () => {
    const raw = JSON.stringify({ version: 1, servers: [
        "https://primary.test", "https://worker.test/ws"
    ] });
    assert.doesNotThrow(() => assertClusterIdentity({ETB_CLUSTER_CONFIG:raw}, {
        member: {id:"https://worker.test",parent:"https://primary.test",depth:1,
            transport:"websocket",roster:["https://primary.test","https://worker.test"]}
    }));
    assert.throws(() => assertClusterIdentity({ETB_CLUSTER_CONFIG:raw}, {
        member: {id:"https://worker.test",parent:"https://primary.test",depth:1,
            transport:"websocket",roster:["https://primary.test","https://different.test"]}
    }), /does not match/);
});
