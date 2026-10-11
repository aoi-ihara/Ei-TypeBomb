import assert from "node:assert/strict";
import test from "node:test";
import { createDatabaseProbeRateLimit } from "../src/lib/databaseProbeRateLimit";

test("database probe limits survive reconnects from the same address", () => {
    let time = 0;
    const accept = createDatabaseProbeRateLimit(() => time);

    assert.equal(accept("192.0.2.1"), true);
    assert.equal(accept("192.0.2.1"), true);
    assert.equal(accept("192.0.2.1"), false);

    assert.equal(accept("192.0.2.1"), false);
    assert.equal(accept("192.0.2.2"), true);

    time = 5_000;
    assert.equal(accept("192.0.2.1"), true);
    assert.equal(accept("192.0.2.1"), false);
});
