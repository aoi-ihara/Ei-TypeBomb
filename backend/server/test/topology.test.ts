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
