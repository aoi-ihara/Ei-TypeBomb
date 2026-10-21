import test from "node:test";
import assert from "node:assert/strict";
import {
    applyGameEvent,
    canStart,
    nextGameDeadline,
    type GameRules,
} from "../../shared/game";
import type { GameState } from "../../shared/types";

const rules: GameRules = {
    allowSpectatorStart: true,
    allowCountdownPass: true,
    clearInputOnStop: false,
};
const blank = (): GameState => ({
    revision: 0,
    room: {
        id: "00000000-0000-4000-8000-000000000001",
        items: [
            { id: "q", type: "typed_recall", prompt: "cat", answer: "ねこ" },
        ],
        maxPlayers: 4,
        gameDuration: 20,
        users: [],
        isStart: false,
        bombStatus: 0,
        bombHolder: 0,
    },
});
const apply = (
    state: GameState,
    event: Parameters<typeof applyGameEvent>[1],
    now = 1000,
) => applyGameEvent(state, event, { now, random: () => 0, rules });

test("shared gameplay is used unmodified by Workers", () => {
    let state = blank();
    state = apply(state, {
        type: "room:join",
        player: { id: "alice", displayName: "Alice" },
    }).state;
    state = apply(state, {
        type: "room:join",
        player: { id: "bob", displayName: "Bob" },
    }).state;
    assert.equal(canStart(state, "alice", rules), true);
    const result = apply(state, {
        type: "game:start",
        playerId: "alice",
        gameId: "g",
        gameDuration: 20,
    });
    assert.equal(result.state.room.isStart, true);
    assert.equal(result.state.room.bombs?.length, 1);
    assert.equal(nextGameDeadline(result.state), 4000);
    assert.ok(result.effects.some((effect) => effect.type === "broadcast"));
    state = apply(result.state, { type: "deadline" }, 4000).state;
    assert.equal(state.wordAt, undefined);
    assert.equal(state.room.bombs?.[0].wordIndex, 0);
});

test("room snapshots do not expose passwords", () => {
    const initial = blank();
    initial.room.password = "do-not-send";
    const result = apply(initial, {
        type: "room:join",
        player: { id: "alice" },
    });
    const snapshot = result.effects.find(
        (effect) =>
            effect.type === "broadcast" &&
            effect.packet.event === "room:broadcast",
    );
    assert.ok(snapshot && snapshot.type === "broadcast");
    assert.equal(JSON.stringify(snapshot).includes("do-not-send"), false);
});
