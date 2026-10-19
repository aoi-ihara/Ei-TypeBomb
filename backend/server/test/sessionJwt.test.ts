import assert from "node:assert/strict";
import test from "node:test";
import { getVerifiedSessionId } from "../../shared/sessionJwt";

const roomId = "1ffdaf68-6742-4b3a-bca7-f79142001552";
const sessionId = "23d595d9-4985-4b4f-8608-9cf19325c6d9";
const payload = { role: "client_session", roomId, sessionId };

test("session identity is stable and room-scoped after signature verification", () => {
    assert.equal(getVerifiedSessionId(payload, "kid", "kid", roomId), sessionId);
    assert.throws(() => getVerifiedSessionId(payload, "other", "kid", roomId));
    assert.throws(() => getVerifiedSessionId(payload, "kid", "kid", "different"));
    assert.throws(() => getVerifiedSessionId({ ...payload, role: "authenticated" }, "kid", "kid", roomId));
    assert.throws(() => getVerifiedSessionId({ ...payload, sessionId: "socket-id" }, "kid", "kid", roomId));
});
