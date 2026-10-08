import assert from "node:assert/strict";
import test from "node:test";
import type { ClientGameEvent, ClientWirePacket, ServerGameEvent, ServerWirePacket } from "../protocol";

test("wire events without payload allow omitted data and preserve legacy framing", () => {
    const application: ServerGameEvent = { event: "auth:request" };
    const request: ClientGameEvent = { event: "room:join" };
    const heartbeat: ClientWirePacket = { event: "ping" };
    const connection: ServerWirePacket = { event: "connect", data: { id: "player" } };
    assert.equal(JSON.stringify(application), '{"event":"auth:request"}');
    assert.equal(JSON.stringify(request), '{"event":"room:join"}');
    assert.equal(JSON.stringify(heartbeat), '{"event":"ping"}');
    assert.equal(JSON.stringify(connection), '{"event":"connect","data":{"id":"player"}}');
});
