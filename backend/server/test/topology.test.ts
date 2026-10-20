import assert from "node:assert/strict";
import test from "node:test";
import { parseServerTopology } from "../../shared/topology";
import { assertClusterIdentity } from "../../shared/distributed/control";

const primary = "https://primary.example.test";
const worker = "https://worker.example.test/ws";

test("topology supports standalone and primary server deployments", () => {
    assert.equal(parseServerTopology({}).role, "standalone");
    assert.deepEqual(parseServerTopology({
        PRIMARY_SERVER_URL: primary,
        SERVER_PUBLIC_URL: primary,
    }), {
        role: "primary", primaryUrl: primary, parentUrl: null, publicUrl: primary,
    });
});

test("replicas can discover their parent without a fixed tier number", () => {
    assert.deepEqual(parseServerTopology({
        PRIMARY_SERVER_URL: primary, PARENT_SERVER_URL: primary,
        SERVER_PUBLIC_URL: worker,
    }), { role: "replica", primaryUrl: primary, parentUrl: primary, publicUrl: worker });
    assert.equal(parseServerTopology({
        PRIMARY_SERVER_URL: primary, PARENT_SERVER_URL: worker,
        SERVER_PUBLIC_URL: "https://render.example.test",
    }).role, "replica");
});

test("invalid or cyclic server configurations are rejected", () => {
    for (const config of [
        { PARENT_SERVER_URL: primary },
        { PRIMARY_SERVER_URL: primary, PARENT_SERVER_URL: primary, SERVER_PUBLIC_URL: primary },
        { PRIMARY_SERVER_URL: primary, SERVER_PUBLIC_URL: worker },
        { PRIMARY_SERVER_URL: "javascript:evil" },
        { PRIMARY_SERVER_URL: "https://user:pass@example.test" },
        { PRIMARY_SERVER_URL: "https://example.test?token=123" },
    ]) assert.throws(() => parseServerTopology(config));
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
