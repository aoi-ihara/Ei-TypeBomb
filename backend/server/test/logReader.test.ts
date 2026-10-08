import assert from "node:assert/strict";
import test from "node:test";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LogReader } from "../src/lib/logReader";

const fixture = (t: { after: (fn: () => void) => void }) => {
    const dir = mkdtempSync(join(tmpdir(), "etb-logs-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, "server.log");
    return { path, reader: new LogReader(path) };
};

test("large logs retain access to oldest records and page without storing log contents", async t => {
    const { path, reader } = fixture(t);
    const records = Array.from({ length: 5000 }, (_, i) => `${i}: 界${" text".repeat(20)}`);
    writeFileSync(path, records.join("\n") + "\n");
    const tail = await reader.read(0, 10, true);
    assert.equal(tail.total, 5000);
    assert.deepEqual(tail.lines, records.slice(-10));
    const head = await reader.read(0, 10, false);
    assert.deepEqual(head.lines, records.slice(0, 10));
    for (const offset of [10, 2500, 4990]) {
        assert.deepEqual((await reader.read(offset, 10, false)).lines, records.slice(offset, offset + 10));
    }
});

test("paused snapshots survive appends, follow catches up, truncation and rotation recover", async t => {
    const { path, reader } = fixture(t);
    writeFileSync(path, "first\nsecond");
    assert.deepEqual((await reader.read(0, 2, true)).lines, ["first", "second"]);
    appendFileSync(path, " extended\nthird\n");
    assert.deepEqual((await reader.read(0, 2, false)).lines, ["first", "second"]);
    assert.deepEqual((await reader.read(0, 2, true)).lines, ["second extended", "third"]);
    writeFileSync(path, "new\n");
    assert.deepEqual((await reader.read(100, 2, false)).lines, ["new"]);
    renameSync(path, path + ".old");
    writeFileSync(path, "replacement\n");
    assert.deepEqual((await reader.read(0, 2, true)).lines, ["replacement"]);
});

test("missing/empty files and oversized records remain usable, concurrent reads serialize", async t => {
    const { path, reader } = fixture(t);
    assert.match((await reader.read(0, 5, true)).status, /No log file/);
    writeFileSync(path, "");
    assert.equal((await reader.read(0, 5, true)).total, 0);
    writeFileSync(path, "x".repeat(300 * 1024) + "\nlast\n");
    const [head, tail] = await Promise.all([reader.read(0, 1, false), reader.read(0, 1, true)]);
    assert.match(head.lines[0], /record truncated/);
    assert.ok(head.lines[0].length < 257 * 1024);
    assert.deepEqual(tail.lines, ["last"]);
});
