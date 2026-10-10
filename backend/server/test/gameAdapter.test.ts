import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeGameAdapter } from '../src/lib/gameAdapter';
import type { GameEffect, GameResult } from '../../shared/game';
import type { GameState } from '../../shared/types';

const fresh = (): GameState => ({ room: {
    id: 'room', users: [{ id: 'a' }, { id: 'b' }], items: [{ id: 'item', type: 'typed_recall', prompt: '猫', answer: 'cat' }],
    maxPlayers: 2, gameDuration: 1, isStart: false, bombStatus: 0, bombHolder: 0,
}, revision: 0 });
test('typing and ignored events retain room identity while forwarding input effects', t => {
    const state = fresh();
    state.room.isStart = true;
    state.room.gameId = 'game';
    const callbacks: { result: GameResult; previous: GameState }[] = [];
    const adapter = new NodeGameAdapter(state, (result, previous) => callbacks.push({ result, previous }));
    t.after(() => adapter.dispose());

    for (let i = 0; i < 30; i++) {
        adapter.apply({ type: 'currentInput', playerId: 'a', input: String(i) });
    }
    assert.equal(callbacks.length, 30);
    for (const [i, { result, previous }] of callbacks.entries()) {
        assert.equal(result.state.room, previous.room);
        assert.deepEqual(result.effects, [{ type: 'broadcast', packet: {
            event: 'typing:input', data: { input: String(i) },
        } }]);
    }

    adapter.apply({ type: 'currentInput', playerId: 'b', input: 'ignored' });
    adapter.apply({ type: 'word:success', playerId: 'b' });
    for (const { result, previous } of callbacks.slice(30)) {
        assert.equal(result.state.room, previous.room);
        assert.deepEqual(result.effects, []);
    }

    adapter.apply({ type: 'word:success', playerId: 'a' });
    const transition = callbacks.at(-1)!;
    assert.notEqual(transition.result.state.room, transition.previous.room);
    assert.equal(transition.result.state.room.bombHolder, 1);
});
test('Node adapter uses absolute deadlines for countdown and every bomb phase', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const effects: GameEffect[] = [];
    const traces: { message: string; metadata: Record<string, unknown> }[] = [];
    const adapter = new NodeGameAdapter(
        fresh(),
        result => effects.push(...result.effects),
        Date.now,
        () => 0,
        (message, metadata) => traces.push({ message, metadata }),
    );
    t.after(() => adapter.dispose());
    adapter.apply({ type: 'game:start', playerId: 'a', gameId: 'game', gameDuration: 1 });
    assert.equal(adapter.state.wordAt, 4000);
    assert.equal(adapter.state.bombAt, 2000);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.bombStatus, 1);
    assert.equal(adapter.state.room.wordIndex, undefined);
    assert.ok(traces.some(({ message, metadata }) =>
        message === 'deadline_fired' && metadata.bombStatus === 0));
    assert.ok(traces.some(({ message, metadata }) =>
        message === 'deadline_applied' &&
        metadata.previousStatus === 0 &&
        metadata.nextStatus === 1));
    assert.ok(traces.some(({ message, metadata }) =>
        message === 'deadline_scheduled' &&
        metadata.bombStatus === 1 &&
        metadata.nextDeadline === 3000));
    t.mock.timers.tick(1000);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.wordIndex, 0);
    assert.equal(adapter.state.room.bombStatus, 3);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.bombStatus, 4);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.isStart, false);
    assert.deepEqual(adapter.state.room.users, []);
    assert.equal(adapter.state.bombAt, undefined);
    assert.ok(effects.some(effect => effect.type === 'broadcast' && effect.packet.event === 'game:end'));
});
test('Node adapter cancels stale timers on leave and schedules a new game independently', t => {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
    const adapter = new NodeGameAdapter(fresh(), () => {}, Date.now, () => 0);
    t.after(() => adapter.dispose());
    adapter.apply({ type: 'game:start', playerId: 'a', gameId: 'old', gameDuration: 20 });
    t.mock.timers.tick(1000);
    adapter.apply({ type: 'room:leave', playerId: 'a', reason: 'room_leave' });
    adapter.apply({ type: 'room:join', player: { id: 'a' } });
    adapter.apply({ type: 'room:join', player: { id: 'b' } });
    adapter.apply({ type: 'game:start', playerId: 'a', gameId: 'new', gameDuration: 20 });
    t.mock.timers.tick(2000);
    assert.equal(adapter.state.room.wordIndex, undefined);
    t.mock.timers.tick(1000);
    assert.equal(adapter.state.room.wordIndex, 0);
    assert.equal(adapter.state.room.gameId, 'new');
    adapter.apply({ type: 'room:leave', playerId: 'a', reason: 'disconnect' });
    const stopped = structuredClone(adapter.state);
    t.mock.timers.tick(100000);
    assert.deepEqual(adapter.state, stopped);
});
