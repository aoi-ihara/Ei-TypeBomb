import assert from "node:assert/strict";
import test from "node:test";
import { parseServerTopology } from "../../shared/topology";

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
test("host position is derived from signed certificate subject instead of per-host URL variables", () => {
    const servers = ["https://primary.test","https://worker.test/ws","https://render.test"];
    const config = JSON.stringify({ version: 1, servers });
    const subject = (sub: string) => {
        const data = Buffer.from(JSON.stringify({sub})).toString("base64url");
        return JSON.stringify({ certificate: "header."+data+".signature" });
    };
    assert.deepEqual(parseServerTopology({ETB_CLUSTER_CONFIG: config,
        CLUSTER_SERVER_TOKEN: subject("https://worker.test")}), {
        role: "replica", primaryUrl: "https://primary.test",
        parentUrl: "https://primary.test", publicUrl: "https://worker.test",
    });
    assert.equal(parseServerTopology({ETB_CLUSTER_CONFIG: config,
        CLUSTER_SERVER_TOKEN: subject("https://render.test")}).parentUrl,
        "https://worker.test");
    assert.throws(() => parseServerTopology({ETB_CLUSTER_CONFIG: config,
        CLUSTER_SERVER_TOKEN: subject("https://not-in-roster.test")}));
});

test("signed credential roster cannot silently disagree with public config", async () => {
    const { assertClusterIdentity } = await import("../../shared/distributed/control");
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
