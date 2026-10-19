import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Identity } from "../../shared/distributed/identity";
test("offline credential provisioning and roster renewal never distribute the authority private key", async (t) => {
    const temp = await mkdtemp(resolve(tmpdir(), "etb-identities-"));
    t.after(() => rm(temp, { recursive: true, force: true }));
    const run = promisify(execFile),
        script = resolve(__dirname, "../scripts/cluster-credentials.mjs");
    const urls = [
        "socket.io=https://primary.test",
        "websocket=https://worker.test",
        "socket.io=https://render.test",
    ];
    await run(process.execPath, [script, resolve(temp, "first"), ...urls]);
    const bundle = JSON.parse(
        await readFile(resolve(temp, "first/server-0.json"), "utf8"),
    );
    const identity = await Identity.create(JSON.stringify(bundle));
    assert.equal(identity.member.roster.length, 3);
    assert.equal(bundle.authorityKey.d, undefined);
    if (process.platform !== "win32")
        assert.equal(
            (await stat(resolve(temp, "first/server-0.json"))).mode & 0o777,
            0o600,
        );
    await run(process.execPath, [
        script,
        "--authority",
        resolve(temp, "first/offline-authority.json"),
        resolve(temp, "next"),
        ...urls,
        "socket.io=https://fourth.test",
    ]);
    const next = JSON.parse(
        await readFile(resolve(temp, "next/server-3.json"), "utf8"),
    );
    assert.deepEqual(next.authorityKey, bundle.authorityKey);
    assert.equal(
        (await Identity.create(JSON.stringify(next))).member.roster.length,
        4,
    );
});
