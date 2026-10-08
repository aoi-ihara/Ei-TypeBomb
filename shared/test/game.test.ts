import assert from "node:assert/strict";
import test from "node:test";
import { applyGameEvent, type GameContext } from "../game";
import type { GameState } from "../types";
import { roomToWireSnapshot } from "../protocol";
import { ClientError, validateAuthResponse, validateDisplayName, requireRoomItems, isHealthRequestId } from "../validation";
import { EVENT_RATE_LIMITS } from "../rateLimit";

const context: GameContext = { now: 1000, random: () => 0, gameId: "game" };
const initial = (): GameState => ({
    room: { id: "room", maxPlayers: 3, gameDuration: 5, bombStatus: 0, bombHolder: 0,
        users: [{ id: "a", displayName: "A" }, { id: "b" }],
        items: [{ id: "item", type: "typed_recall", prompt: "日本語", answer: "word" }] },
});
const start = () => applyGameEvent(initial(), { event: "game:start", playerId: "a" }, context).state;
function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

test("join normalizes missing users and copies incoming player", () => {
    const state = initial();
    delete state.room.users;
    const player = { id: "a" };
    const result = applyGameEvent(freeze(state), { event: "room:join", player }, context);
    assert.deepEqual(result.state.room.users, [player]);
    assert.notEqual(result.state.room.users![0], player);
});
test("duplicate and full joins preserve identity", () => {
    const state = initial();
    assert.equal(applyGameEvent(state, { event: "room:join", player: { id: "a" } }, context).state, state);
    state.room.maxPlayers = 2;
    assert.equal(applyGameEvent(state, { event: "room:join", player: { id: "c" } }, context).state, state);
});
test("inactive leave removes only member, absent leave is unchanged", () => {
    const state = freeze(initial());
    assert.equal(applyGameEvent(state, { event: "room:leave", playerId: "c" }, context).state, state);
    assert.deepEqual(applyGameEvent(state, { event: "room:leave", playerId: "a" }, context).state.room.users, [{ id: "b" }]);
});
test("start is immutable and sets supplied id and deadlines", () => {
    const state = freeze(initial());
    const result = applyGameEvent(state, { event: "game:start", playerId: "a" }, context);
    assert.equal(result.state.wordAt, 4000);
    assert.equal(result.state.bombAt, 6000);
    assert.equal(result.state.room.gameId, "game");
    assert.equal(result.state.room.wordIndex, undefined);
    assert.equal(state.room.isStart, undefined);
    assert.deepEqual(result.effects, [{ event: "typing:input", data: { input: "" } }]);
});
test("spectator start is strict by default and explicitly compatible", () => {
    const state = initial();
    assert.equal(applyGameEvent(state, { event: "game:start", playerId: "spectator" }, context).state, state);
    assert.equal(applyGameEvent(state, { event: "game:start", playerId: "spectator" }, { ...context, allowSpectatorStart: true }).state.room.isStart, true);
});
test("one player cannot start and an already started game cannot restart", () => {
    const state = initial();
    state.room.users = [{ id: "a" }];
    assert.equal(applyGameEvent(state, { event: "game:start", playerId: "a" }, context).state, state);
    const running = start();
    assert.equal(applyGameEvent(running, { event: "game:start", playerId: "a" }, context).state, running);
});
test("an accepted start requires a game generation", () => {
    assert.throws(() => applyGameEvent(initial(), { event: "game:start", playerId: "a" }, {
        now: context.now, random: context.random,
    }), /requires a gameId/);
});
test("passes ignore non-holder, advance the holder and wrap back to the first player", () => {
    let state = applyGameEvent(start(), { event: "deadlines" }, { ...context, now: 4000 }).state;
    assert.equal(applyGameEvent(state, { event: "word:success", playerId: "b" }, context).state, state);
    state = applyGameEvent(state, { event: "word:success", playerId: "a" }, context).state;
    assert.equal(state.room.bombHolder, 1);
    state = applyGameEvent(state, { event: "word:success", playerId: "b" }, context).state;
    assert.equal(state.room.bombHolder, 0);
    assert.ok(state.room.wordIndex! >= 0 && state.room.wordIndex! < state.room.items!.length);
});
test("countdown pass is strict by default and explicitly compatible", () => {
    const state = freeze(start());
    assert.equal(applyGameEvent(state, { event: "word:success", playerId: "a" }, context).state, state);
    const result = applyGameEvent(state, { event: "word:success", playerId: "a" }, { ...context, allowCountdownPass: true });
    assert.equal(result.state.room.bombHolder, 1);
    assert.equal(result.state.wordAt, 4000);
});
test("input emits without changing identity, validates holder and truncates", () => {
    const state = freeze(start());
    assert.deepEqual(applyGameEvent(state, { event: "currentInput", playerId: "b", input: "x" }, context).effects, []);
    assert.deepEqual(applyGameEvent(state, { event: "currentInput", playerId: "a", input: {} }, context).effects, []);
    const result = applyGameEvent(state, { event: "currentInput", playerId: "a", input: "x".repeat(40) }, context);
    assert.equal(result.state, state);
    assert.deepEqual(result.effects, [{ event: "typing:input", data: { input: "x".repeat(32) } }]);
});
test("early deadlines preserve identity; due word unlocks passes", () => {
    const state = freeze(start());
    assert.equal(applyGameEvent(state, { event: "deadlines" }, context).state, state);
    const ready = applyGameEvent(state, { event: "deadlines" }, { ...context, now: 4000 }).state;
    assert.equal(ready.wordAt, undefined);
    assert.equal(ready.room.wordIndex, 0);
    assert.equal(applyGameEvent(ready, { event: "word:success", playerId: "a" }, context).state.room.bombHolder, 1);
});
test("both overdue deadlines process once and next bomb schedules from now", () => {
    const result = applyGameEvent(freeze(start()), { event: "deadlines" }, { ...context, now: 100000 });
    assert.equal(result.state.wordAt, undefined);
    assert.equal(result.state.room.wordIndex, 0);
    assert.equal(result.state.room.bombStatus, 1);
    assert.equal(result.state.bombAt, 105000);
});
test("bomb statuses advance 0 through 4 then end clears users and deadlines", () => {
    let state = start();
    for (let status = 1; status <= 4; status++) {
        state = applyGameEvent(freeze(state), { event: "deadlines" }, { ...context, now: state.bombAt! }).state;
        assert.equal(state.room.bombStatus, status);
    }
    const result = applyGameEvent(freeze(state), { event: "deadlines" }, { ...context, now: state.bombAt! });
    assert.deepEqual(result.effects, [
        { event: "game:end", data: { holderUserId: "a", holderDisplayName: "A" } },
        { event: "typing:input", data: { input: "" } },
    ]);
    assert.deepEqual(result.state.room.users, []);
    assert.equal(result.state.wordAt, undefined);
    assert.equal(result.state.bombAt, undefined);
    assert.equal(result.state.room.gameId, undefined);
});
test("active leave cancels and clears every player and deadline", () => {
    const result = applyGameEvent(freeze(start()), { event: "room:leave", playerId: "b" }, context);
    assert.deepEqual(result.state.room.users, []);
    assert.equal(result.state.bombAt, undefined);
    assert.equal(result.state.wordAt, undefined);
    assert.equal(result.effects[1].event, "game:quited");
});
test("reset retains users and stale deadlines cannot revive reset game", () => {
    const state = start();
    const reset = applyGameEvent(freeze(state), { event: "game:reset" }, context).state;
    assert.equal(reset.room.users, state.room.users);
    assert.equal(reset.wordAt, undefined);
    assert.equal(reset.bombAt, undefined);
    assert.equal(applyGameEvent(reset, { event: "deadlines" }, { ...context, now: 100000 }).state, reset);
    assert.equal(applyGameEvent(reset, { event: "game:reset" }, context).state, reset);
});
test("stale old deadline wakeup only consults new game's deadlines", () => {
    const reset = applyGameEvent(start(), { event: "game:reset" }, context).state;
    const newer = applyGameEvent(reset, { event: "game:start", playerId: "a" }, { ...context, now: 10000, gameId: "new" }).state;
    assert.equal(applyGameEvent(newer, { event: "deadlines" }, { ...context, now: 6000 }).state, newer);
});
test("duration validation uses fallback and valid upper boundary", () => {
    for (const duration of [0, -1, 1.5, NaN, Infinity, 2147474]) {
        const state = initial();
        state.room.gameDuration = duration;
        assert.equal(applyGameEvent(state, { event: "game:start", playerId: "a" }, context).state.bombAt, 21000);
    }
    const state = initial();
    state.room.gameDuration = 2147473;
    assert.equal(applyGameEvent(state, { event: "game:start", playerId: "a" }, context).state.bombAt, 2147474000);
});
test("random determines holder, word and bomb jitter", () => {
    const state = initial();
    state.room.items!.push({ id: "two", type: "typed_recall", prompt: "p", answer: "a" });
    const result = applyGameEvent(state, { event: "game:start", playerId: "a" }, { ...context, random: () => 0.75 });
    assert.equal(result.state.room.bombHolder, 1);
    assert.equal(result.state.bombAt, 13500);
    assert.equal(applyGameEvent(result.state, { event: "deadlines" }, { ...context, now: 4000, random: () => 0.75 }).state.room.wordIndex, 1);
});
test("validation rejects malformed names/auth/items and accepts UUID v4 only", () => {
    for (const value of [null, "", 1, "x".repeat(51), "a\n", "a\u200b"]) assert.throws(() => validateDisplayName(value), ClientError);
    assert.equal(validateDisplayName("日本語"), "日本語");
    assert.equal(validateDisplayName("x".repeat(50)).length, 50);
    for (const value of [null, {}, { jwtToken: 1 }, { jwtToken: "x" }]) assert.throws(() => validateAuthResponse(value), ClientError);
    assert.deepEqual(validateAuthResponse({ jwtToken: "x", displayName: "A", extra: true }), { jwtToken: "x", displayName: "A" });
    assert.throws(() => requireRoomItems({}), ClientError);
    for (const items of [[], "wrong", [null], [{ id: "x", type: "other", prompt: "p", answer: "a" }], [{ id: "x", type: "typed_recall", prompt: "p", answer: 1 }]]) {
        assert.throws(() => requireRoomItems({ items } as unknown as Pick<GameState["room"], "items">), ClientError);
    }
    requireRoomItems(initial().room);
    assert.equal(isHealthRequestId("12345678-1234-4234-8234-123456789abc"), true);
    for (const value of [null, "12345678-1234-1234-8234-123456789abc", "bad"]) assert.equal(isHealthRequestId(value), false);
});
test("snapshot removes password and adds legacy words without mutation", () => {
    const state = initial();
    state.room.password = "secret";
    const wire = roomToWireSnapshot(freeze(state.room));
    assert.equal(Object.hasOwn(wire, "password"), false);
    assert.deepEqual(wire.words, [{ jp: "日本語", en: "word" }]);
    assert.deepEqual(roomToWireSnapshot({ id: "empty", bombStatus: 0 }).words, []);
    assert.equal(state.room.password, "secret");
});
test("rate limit values match both existing runtimes", () => {
    assert.deepEqual(Object.values(EVENT_RATE_LIMITS).map(({ capacity, perSecond }) => [capacity, perSecond]),
        [[60, 30], [10, 5], [5, 2], [5, 2], [2, 1], [3, 0.5], [2, 0.2], [2, 0.2]]);
});
