import assert from "node:assert/strict";
import test from "node:test";
import {
    clusterObjectName,
    replicaObjectName,
    roomObjectName,
} from "../src/lib/namespace";

const servers = [
    "https://primary.test",
    "https://worker.test/ws",
    "https://fallback.test",
];
const config = (list: string[]) => ({
    ETB_CLUSTER_CONFIG: JSON.stringify({ version: 1, servers: list }),
});

test("distributed DO namespaces use only the normalized current server list", async () => {
    const current = config(servers);
    const formatted = {
        ETB_CLUSTER_CONFIG: JSON.stringify(
            {
                version: 1,
                servers,
            },
            null,
            2,
        ),
    };
    assert.equal(
        await clusterObjectName(current),
        await clusterObjectName(formatted),
    );
    assert.equal(
        await replicaObjectName(current, "room-1"),
        await replicaObjectName(formatted, "room-1"),
    );
    assert.equal(
        await roomObjectName(current, "room-1"),
        await roomObjectName(formatted, "room-1"),
    );
    assert.notEqual(
        await replicaObjectName(current, "room-1"),
        await replicaObjectName(current, "room-2"),
    );
    assert.notEqual(
        await roomObjectName(current, "room-1"),
        await roomObjectName(current, "room-2"),
    );
});

test("changing the cluster topology isolates control, votes and game room DOs", async () => {
    const before = config(servers);
    const after = config(["https://different.test", ...servers.slice(1)]);
    assert.notEqual(
        await clusterObjectName(before),
        await clusterObjectName(after),
    );
    assert.notEqual(
        await replicaObjectName(before, "room-1"),
        await replicaObjectName(after, "room-1"),
    );
    assert.notEqual(
        await roomObjectName(before, "room-1"),
        await roomObjectName(after, "room-1"),
    );
    assert.notEqual(
        await clusterObjectName(before),
        "server",
        "former ClusterDO name must remain unused",
    );
});

test("standalone deployments keep existing room Durable Object names", async () => {
    assert.equal(await clusterObjectName({}), "server");
    assert.equal(await roomObjectName({}, "room-1"), "room-1");
    assert.equal(await replicaObjectName({}, "room-1"), "room-1");
});
