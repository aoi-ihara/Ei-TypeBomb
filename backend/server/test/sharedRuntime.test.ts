import assert from "node:assert/strict";
import test from "node:test";
import { createKeyedRateLimit } from "../../shared/keyedRateLimit";
import { createAddressRateLimit } from "../../shared/addressRateLimit";
import { getAuthenticatedRoomId } from "../../shared/roomJwt";
import { ROOM_SELECT_COLUMNS } from "../../shared/room";
import { parseClientEvent } from "../../shared/validation";

test("shared keyed token buckets refill independently and ignore unknown events", () => {
    let time = 0;
    const accept = createKeyedRateLimit(
        (event) => event === "typing" ? { capacity: 2, perSecond: 1 } : undefined,
        () => time,
    );
    assert.equal(accept("typing"), true);
    assert.equal(accept("typing"), true);
    assert.equal(accept("typing"), false);
    assert.equal(accept("__proto__"), true);
    time = 999;
    assert.equal(accept("typing"), false);
    time = 1000;
    assert.equal(accept("typing"), true);
    assert.equal(accept("typing"), false);
    time = 60_000;
    assert.equal(accept("typing"), true);
    assert.equal(accept("typing"), true);
    assert.equal(accept("typing"), false);
    assert.equal(createKeyedRateLimit(() => ({ capacity: 1, perSecond: 0 }), () => 0)("typing"), true);
});

test("shared address limiter keeps a bounded number of address buckets", () => {
    const accept = createAddressRateLimit({ capacity: 1, perSecond: 0 }, () => 0);
    assert.equal(accept("original"), true);
    assert.equal(accept("original"), false);
    for (let i = 0; i < 1001; i++) {
        assert.equal(accept(`peer-${i}`), true);
    }
    // The oldest address has been evicted once the store exceeds its cap.
    assert.equal(accept("original"), true);
});

test("shared JWT claims policy requires the expected key, role and room UUID", () => {
    const roomId = "123e4567-e89b-42d3-a456-426614174000";
    const payload = { id: roomId, role: "authenticated" };
    assert.equal(getAuthenticatedRoomId(payload, "kid-1", "kid-1"), roomId);
    assert.throws(() => getAuthenticatedRoomId(payload, "wrong", "kid-1"));
    assert.throws(() => getAuthenticatedRoomId(payload, undefined, "kid-1"));
    assert.throws(() => getAuthenticatedRoomId({ ...payload, role: "anon" }, "kid-1", "kid-1"));
    assert.throws(() => getAuthenticatedRoomId({ ...payload, id: "not-a-uuid" }, "kid-1", "kid-1"));
    assert.throws(() => getAuthenticatedRoomId({ ...payload, id: 42 }, "kid-1", "kid-1"));
});

test("shared event validation accepts recommendations and bounds hint lengths", () => {
    assert.deepEqual(parseClientEvent("item:recommend", { itemId: "question" }), {
        event: "item:recommend", data: { itemId: "question" },
    });
    for (const data of [undefined, null, {}, { itemId: 42 }])
        assert.equal(parseClientEvent("item:recommend", data), null);
    assert.deepEqual(parseClientEvent("hint:update", { length: 32 }), {
        event: "hint:update", data: { length: 32 },
    });
    for (const length of [-1, 33, 1.5, "2"])
        assert.equal(parseClientEvent("hint:update", { length }), null);
});

test("room projection contains the same columns as the runtime-neutral row", () => {
    for (const column of ["id", "title", "user_id", "explanation", "max_players",
        "bomb_count", "game_duration", "password", "created_at", "updated_at", "items"]) {
        assert.ok(ROOM_SELECT_COLUMNS.split(",").map(x => x.trim()).includes(column));
    }
});
