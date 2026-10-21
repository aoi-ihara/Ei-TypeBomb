import test from "node:test";
import assert from "node:assert/strict";
import { parseWireMessage, encodeWireMessage } from "../src/lib/wire";

test("native websocket frame preserves event and payload", () => {
    const packet = parseWireMessage(
        encodeWireMessage("item:recommend", { itemId: "a" }),
    );
    assert.deepEqual(packet, {
        event: "item:recommend",
        data: { itemId: "a" },
    });
});

test("native websocket accepts hint failures as objects", () => {
    assert.deepEqual(
        parseWireMessage(
            '{"event":"currentInput","data":{"input":"x","failed":true}}',
        ),
        { event: "currentInput", data: { input: "x", failed: true } },
    );
});

test("malformed, binary and oversized frames are discarded", () => {
    assert.equal(parseWireMessage("not json"), null);
    assert.equal(parseWireMessage("[]"), null);
    assert.equal(parseWireMessage('{"data":1}'), null);
    assert.equal(parseWireMessage(new ArrayBuffer(8)), null);
    assert.equal(parseWireMessage("a".repeat(4097)), null);
});

test("heartbeat matches the client's native websocket framing", () => {
    assert.equal(encodeWireMessage("ping"), '{"event":"ping"}');
    assert.equal(encodeWireMessage("pong"), '{"event":"pong"}');
});
