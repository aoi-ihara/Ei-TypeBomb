import assert from "node:assert/strict";
import test from "node:test";
import { applyGameEvent, bombsForPlayers, nextGameDeadline, type GameContext, type GameEvent } from "../../shared/game";
import { NODE_GAME_RULES } from "../src/lib/gameAdapter";
import type { GameState } from "../../shared/types";

const context: GameContext = { now: 1000, random: () => 0, rules: NODE_GAME_RULES };
function apply(state: GameState, event: GameEvent, now = 1000) {
    return applyGameEvent(state, event, { ...context, now });
}
function started(count: number): GameState {
    let state: GameState = {
        room: {
            id: "room", maxPlayers: 16, gameDuration: 20,
            items: [{ id: "word", type: "typed_recall", prompt: "猫", answer: "cat" }],
            users: Array.from({ length: count }, (_, n) => ({ id: String(n), displayName: "P" + n })),
            isStart: false, bombHolder: 0, bombStatus: 0,
        }, revision: 0,
    };
    state = apply(state, { type: "game:start", playerId: "0", gameId: "game", gameDuration: 20 }).state;
    return apply(state, { type: "deadline" }, 4000).state;
}
const finishBomb = (state: GameState, id: string) => {
    let current = state;
    for (let i = 0; i < 5; i++) {
        const bomb = current.room.bombs?.find(item => item.id === id);
        assert.ok(bomb, "bomb still exists until its fifth deadline");
        current = apply(current, { type: "deadline" }, bomb.at).state;
    }
    return current;
};

test("initial bomb count is fixed for each player bracket", () => {
    for (const [players, expected] of [[2, 1], [4, 1], [5, 2], [8, 2], [9, 3], [16, 4]]) {
        assert.equal(bombsForPlayers(players), expected);
        const state = started(players);
        assert.equal(state.room.bombs?.length, expected);
        assert.equal(state.room.losers?.length, 0);
        assert.equal(nextGameDeadline(state), 21000);
    }
});

test("collision queues consecutive answers and never duplicates a loser", () => {
    let state = started(5);
    const [first, second] = state.room.bombs!;
    assert.equal(first.holder, 0);
    assert.equal(second.holder, 2);
    // Move the first bomb to P2, who already holds the second one.
    // Emulate successive passes: P0 -> P1 -> P2.
    state = apply(state, { type: "word:success", playerId: "0" }).state;
    state = apply(state, { type: "word:success", playerId: "1" }).state;
    assert.deepEqual(state.room.bombs?.map(bomb => bomb.holder), [2, 2]);
    state = apply(state, { type: "word:success", playerId: "2" }).state;
    assert.deepEqual(state.room.bombs?.map(bomb => bomb.holder), [3, 2]);
    state = apply(state, { type: "word:success", playerId: "2" }).state;
    assert.deepEqual(state.room.bombs?.map(bomb => bomb.holder), [3, 3]);
    // Both explosives eventually reach the final phase on the same deadline.
    for (let status = 1; status <= 4; status++)
        state = apply(state, { type: "deadline" }, state.bombAt!).state;
    const ended = apply(state, { type: "deadline" }, state.bombAt!);
    const result = ended.effects.find(effect => effect.type === "broadcast" && effect.packet.event === "game:end");
    assert.ok(result && result.type === "broadcast" && result.packet.event === "game:end");
    assert.deepEqual(result.packet.data.losers?.map(loser => loser.id), ["3", "4"]);
    assert.equal(ended.state.room.isStart, false);
    assert.equal(ended.state.room.bombs, undefined);
});

test("one explosion removes only its bomb, loser becomes ineligible, and other bomb continues", () => {
    let state = started(5);
    // Independent deadline: first bomb explodes while second is still at status 0.
    state.room.bombs![1].at = 200000;
    state.bombAt = 21000;
    state = finishBomb(state, "0");
    assert.equal(state.room.isStart, true);
    assert.equal(state.room.bombs?.length, 1);
    assert.deepEqual(state.room.losers?.map(item => item.id), ["0"]);
    assert.equal(state.room.bombs?.[0].id, "1");
    // The remaining bomb skips eliminated player 0 after passing from player 4.
    state.room.bombs![0].holder = 4;
    state = apply(state, { type: "word:success", playerId: "4" }, 110000).state;
    assert.equal(state.room.bombs?.[0].holder, 1);
    assert.equal(state.room.losers?.length, 1);
    state = finishBomb(state, "1");
    assert.equal(state.room.isStart, false);
});

test("declined joins cannot change the fixed bomb count during a match", () => {
    const state = started(5);
    const ignored = apply(state, { type: "room:join", player: { id: "new" } });
    assert.equal(ignored.state, state);
    assert.equal(state.room.bombs?.length, 2);
});
