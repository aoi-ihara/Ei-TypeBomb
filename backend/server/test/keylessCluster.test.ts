import assert from "node:assert/strict";
import test from "node:test";
import { parseETBClusterConfig } from "../../shared/clusterConfig";
import { Identity } from "../../shared/distributed/identity";

const raw = JSON.stringify({
    version: 1,
    servers: [
        "https://primary.test",
        "https://worker.test/ws",
        "https://render.test",
    ],
});
const servers = parseETBClusterConfig(raw);

test("public declarations and statements contain no private keys and provide no identity authentication", async () => {
    const declaration = await Identity.generate(servers, servers[0].origin);
    assert.deepEqual(Object.keys(JSON.parse(declaration)).sort(), [
        "depth",
        "id",
        "parent",
        "roster",
        "servers",
        "transport",
    ]);
    const original = await Identity.create(declaration, "original-process");
    const sameClaim = await Identity.create(declaration, "another-process");
    assert.equal(
        (await original.inspectPeer(
            sameClaim.member.declaration!,
            sameClaim.member.boot,
        )).boot,
        "another-process",
    );
    const statement = await original.statement("test", { hash: "public-value" });
    assert.equal(JSON.parse(statement).hash, "public-value");
    await assert.rejects(
        original.inspectPeer(
            await Identity.generate(
                [
                    {
                        origin: "https://outsider.test",
                        endpoint: "https://outsider.test",
                        transport: "socket.io",
                    },
                ],
                "https://outsider.test",
            ),
            "boot",
        ),
        /Unconfigured/,
    );
});
