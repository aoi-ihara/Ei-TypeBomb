/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, SELF, runInDurableObject, runDurableObjectAlarm, evictDurableObject, reset } from 'cloudflare:test';
import { afterEach, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { acceptEvent } from '../src/lib/rateLimit';
import { validateDisplayName, verifyToken } from '../src/lib/services';
import type { GameState, Room, Session } from '../src/types';

const { responses } = vi.hoisted(() => ({ responses: [] as unknown[] }));
vi.mock('pg', () => ({
	Client: class {
		async connect() {}
		async end() {}
		async query() {
			const rows = responses.shift();
			if (!rows) throw new Error('Unexpected database query');
			return { rows };
		}
	},
}));

const roomId = '12345678-1234-4123-8123-123456789abc';
const sockets: WebSocket[] = [];
const secret = new TextEncoder().encode('test-only-secret');
const token = (id = roomId, expiry = '1h') =>
	new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(expiry).sign(secret);
function mockRoom(items: unknown = [{ id: 'item-1', type: 'typed_recall', prompt: '猫', answer: 'cat' }]) {
	responses.push([{ id: roomId, title: 'Test', max_players: 2, game_duration: 1000, items, password: 'must-not-leak' }]);
}
async function connect(id = roomId) {
	const response = await SELF.fetch(`https://worker.test/ws/${id}`, { headers: { Upgrade: 'websocket', Origin: 'http://localhost:3000' } });
	expect(response.status).toBe(101);
	const ws = response.webSocket!;
	sockets.push(ws);
	const queue: { event: string; data: unknown }[] = [];
	let wake: (() => void) | undefined;
	ws.addEventListener('message', (event) => {
		queue.push(JSON.parse(event.data as string));
		wake?.();
	});
	ws.accept();
	async function next<T = unknown>(event: string, predicate: (data: T) => boolean = () => true): Promise<T> {
		const timeout = setTimeout(() => wake?.(), 2000);
		const deadline = Date.now() + 2000;
		try {
			while (true) {
				const index = queue.findIndex((packet) => packet.event === event && predicate(packet.data as T));
				if (index >= 0) return queue.splice(index, 1)[0].data as T;
				if (Date.now() >= deadline) throw new Error(`Timed out: ${event}`);
				await new Promise<void>((resolve) => {
					wake = resolve;
				});
			}
		} finally {
			clearTimeout(timeout);
			wake = undefined;
		}
	}
	const connection = await next<{ id: string }>('connect');
	await next('auth:request');
	return {
		ws,
		id: connection.id,
		next,
		clear: () => {
			queue.length = 0;
		},
		send: (event: string, data?: unknown) => ws.send(JSON.stringify({ event, data })),
	};
}
async function authenticate(client: Awaited<ReturnType<typeof connect>>, displayName = 'Player') {
	client.send('auth:response', { jwtToken: await token(), displayName });
	return client.next<Room>('room:broadcast');
}
afterEach(async () => {
	await Promise.all(
		sockets.splice(0).map(
			(ws) =>
				new Promise<void>((resolve) => {
					if (ws.readyState === WebSocket.CLOSED) return resolve();
					ws.addEventListener('close', () => resolve(), { once: true });
					ws.close();
				}),
		),
	);
	await reset();
	expect(responses).toHaveLength(0);
	vi.restoreAllMocks();
});
it('health, origin restrictions, and upgrade requirements', async () => {
	expect((await SELF.fetch('https://worker.test/health')).status).toBe(200);
	expect((await SELF.fetch('https://worker.test/health', { headers: { Origin: 'https://evil.test' } })).status).toBe(403);
	expect((await SELF.fetch(`https://worker.test/ws/${roomId}`)).status).toBe(426);
});
it('checks database health over the health socket', async () => {
	responses.push([{ id: roomId }]);
	const client = await connect('health');
	const requestId = crypto.randomUUID();
	client.send('health:database', requestId);
	const result = await client.next<{ requestId: string; ok: boolean; latencyMs: number }>('health:database-result');
	expect(result.requestId).toBe(requestId);
	expect(result.ok).toBe(true);
	expect(result.latencyMs).toBeGreaterThanOrEqual(0);
});
it('shares the database health budget across reconnects and rejects room sockets', async () => {
	responses.push([{ id: roomId }], [{ id: roomId }]);
	const first = await connect('health');
	first.send('health:database', crypto.randomUUID());
	await first.next('health:database-result');

	const second = await connect('health');
	second.send('health:database', crypto.randomUUID());
	await second.next('health:database-result');

	// The persisted health-object bucket is exhausted across reconnects.
	second.send('health:database', crypto.randomUUID());
	second.send('ping');
	await second.next('pong');

	// Game-room Durable Objects must never execute database probes.
	const room = await connect();
	room.send('health:database', crypto.randomUUID());
	room.send('ping');
	await room.next('pong');
});

it('continues processing health messages while a database health check is pending', async () => {
	vi.mocked(fetch).mockImplementationOnce(
		() =>
			new Promise<Response>((resolve) => {
				setTimeout(() => resolve(Response.json([{ id: roomId }])), 100);
			}),
	);
	const client = await connect('health');
	const requestId = crypto.randomUUID();
	const pingId = crypto.randomUUID();
	client.send('health:database', requestId);
	client.send('health:ping', pingId);
	await client.next<string>('health:pong', (id) => id === pingId);
	expect(await client.next<{ requestId: string; ok: boolean }>('health:database-result')).toMatchObject({ requestId, ok: true });
});

it('rejects invalid/expired JWTs and invalid names', async () => {
	expect(await verifyToken('invalid', 'test-only-secret')).toBeNull();
	expect(await verifyToken(await token(roomId, '0s'), 'test-only-secret')).toBeNull();
	expect(() => validateDisplayName('x\n')).toThrow();
	const client = await connect();
	client.send('auth:response', { jwtToken: await token('different-room'), displayName: 'Player' });
	expect(await client.next('error')).toHaveProperty('message');
});
it('preserves independent event budgets and refill', () => {
	const session: Session = { id: 'a', roomId, authenticated: true, lastSeen: 0, buckets: {} };
	for (let i = 0; i < 60; i++) expect(acceptEvent(session, 'currentInput', 0)).toBe(true);
	expect(acceptEvent(session, 'currentInput', 0)).toBe(false);
	expect(acceptEvent(session, 'word:success', 0)).toBe(true);
	expect(acceptEvent(session, 'currentInput', 1000)).toBe(true);
	expect(acceptEvent(session, '__proto__', 1000)).toBe(false);
});
it('joins, enforces capacity, leaves and rejoins on the same connection', async () => {
	mockRoom();
	const a = await connect();
	const b = await connect();
	const c = await connect();
	const room = await authenticate(a);
	expect(room).not.toHaveProperty('password');
	await authenticate(b);
	await authenticate(c);
	a.clear();
	b.clear();
	c.clear();
	a.send('room:join');
	expect((await a.next<Room>('room:broadcast', (room) => room.users.length === 1)).users).toHaveLength(1);
	b.clear();
	b.send('room:join');
	expect((await b.next<Room>('room:broadcast', (room) => room.users.length === 2)).users).toHaveLength(2);
	c.send('room:join');
	c.send('ping');
	await c.next('pong');
	const stub = env.GAME_ROOMS.getByName(roomId);
	const state = await runInDurableObject(stub, async (_, ctx) => ctx.storage.get<GameState>('game'));
	expect(state?.room.users).toHaveLength(2);
	a.clear();
	a.send('room:leave');
	expect((await a.next<Room>('room:broadcast', (room) => room.users.length === 1)).users).toHaveLength(1);
	a.send('room:join');
	expect((await a.next<Room>('room:broadcast', (room) => room.users.length === 2)).users).toHaveLength(2);
});
it('runs countdown, holder-only typing/pass, persists through hibernation and finishes', async () => {
	mockRoom();
	mockRoom();
	const a = await connect();
	const b = await connect();
	await authenticate(a);
	await authenticate(b);
	a.clear();
	a.send('room:join');
	await a.next<Room>('room:broadcast', (room) => room.users.length === 1);
	b.clear();
	b.send('room:join');
	await b.next<Room>('room:broadcast', (room) => room.users.length === 2);
	a.clear();
	a.send('game:start');
	const started = await a.next<Room>('room:broadcast', (room) => room.isStart);
	expect(started.isStart).toBe(true);
	expect(started.wordIndex).toBeUndefined();
	const stub = env.GAME_ROOMS.getByName(roomId);
	await evictDurableObject(stub);
	await runInDurableObject(stub, async (instance, ctx) => {
		const game = (instance as unknown as { game: GameState }).game;
		game.wordAt = Date.now() - 1;
		await ctx.storage.put('game', game);
	});
	a.clear();
	b.clear();
	await runDurableObjectAlarm(stub);
	const active = await a.next<Room>('room:broadcast', (room) => room.wordIndex !== undefined);
	expect(active.wordIndex).toBe(0);
	const holder = active.users[active.bombHolder].id === a.id ? a : b;
	const spectator = holder === a ? b : a;
	a.clear();
	b.clear();
	spectator.send('currentInput', 'bad');
	spectator.send('ping');
	await spectator.next('pong');
	holder.send('currentInput', 'x'.repeat(40));
	expect(await spectator.next('typing:input')).toEqual({ input: 'x'.repeat(32) });
	holder.send('word:success');
	const passed = await holder.next<Room>('room:broadcast', (room) => room.users[room.bombHolder]?.id === spectator.id);
	expect(passed.users[passed.bombHolder].id).toBe(spectator.id);
	for (let i = 0; i < 5; i++) {
		await runInDurableObject(stub, async (instance, ctx) => {
			const game = (instance as unknown as { game: GameState }).game;
			game.bombAt = Date.now() - 1;
			await ctx.storage.put('game', game);
		});
		a.clear();
		await runDurableObjectAlarm(stub);
		const room = await a.next<Room>('room:broadcast', (room) => room.bombStatus === (i === 4 ? 0 : i + 1));
		expect(room.bombStatus).toBe(i === 4 ? 0 : i + 1);
	}
	expect(await a.next('game:end')).toEqual({ holderUserId: spectator.id, holderDisplayName: 'Player' });
	const finished = await runInDurableObject(stub, (_, ctx) => ctx.storage.get<GameState>('game'));
	expect(finished?.room.isStart).toBe(false);
	expect(finished?.room.users).toHaveLength(0);
});
it('disconnecting a player cancels the game', async () => {
	mockRoom();
	mockRoom();
	const a = await connect();
	const b = await connect();
	await authenticate(a);
	await authenticate(b);
	a.clear();
	a.send('room:join');
	await a.next<Room>('room:broadcast', (room) => room.users.length === 1);
	b.clear();
	b.send('room:join');
	await b.next<Room>('room:broadcast', (room) => room.users.length === 2);
	a.clear();
	a.send('game:start');
	await a.next<Room>('room:broadcast', (room) => room.isStart);
	a.clear();
	b.ws.close();
	await a.next('game:quited');
	const room = await a.next<Room>('room:broadcast', (room) => !room.isStart && room.users.length === 0);
	expect(room.isStart).toBe(false);
	expect(room.users).toHaveLength(0);
});

it('removes idle players and expires unauthenticated sockets', async () => {
	mockRoom();
	const a = await connect();
	const observer = await connect();
	await authenticate(a);
	a.clear();
	a.send('room:join');
	await a.next<Room>('room:broadcast', (room) => room.users.length === 1);
	const stub = env.GAME_ROOMS.getByName(roomId);
	await runInDurableObject(stub, (_, ctx) => {
		for (const ws of ctx.getWebSockets()) {
			const session = ws.deserializeAttachment() as Session;
			session.lastSeen = Date.now() - 80_000;
			ws.serializeAttachment(session);
		}
	});
	const closed = [a, observer].map(
		(client) => new Promise<void>((resolve) => client.ws.addEventListener('close', () => resolve(), { once: true })),
	);
	await runDurableObjectAlarm(stub);
	await Promise.all(closed);
	expect(await runInDurableObject(stub, (_, ctx) => ctx.storage.get('game'))).toBeUndefined();
});

it('rejects empty item lists without authenticating the socket', async () => {
	mockRoom([]);
	const a = await connect();
	a.send('auth:response', { jwtToken: await token(), displayName: 'Player' });
	expect(await a.next<{ message: string }>('error')).toHaveProperty(
		'message',
		'ルームに問題が設定されていません。問題を設定してから再度お試しください。',
	);
	const stub = env.GAME_ROOMS.getByName(roomId);
	expect(
		await runInDurableObject(stub, (_, ctx) => ctx.getWebSockets().some((ws) => (ws.deserializeAttachment() as Session).authenticated)),
	).toBe(false);
});

it('Node and Durable Object adapters produce identical states for the same game scenario', async () => {
	const { NodeGameAdapter } = await import('../../server/src/lib/gameAdapter');
	const initial: GameState = { room: {
		id: roomId, maxPlayers: 2, gameDuration: 20,
		items: [0, 1, 2].map(id => ({ id: String(id), type: 'typed_recall', prompt: '猫', answer: 'cat' })),
		users: [], isStart: false, bombHolder: 0, bombStatus: 0,
	}, revision: 0 };
	// Keep real runtime alarms/timers in the future; advance the core's injected clock.
	let now = Date.now() + 3_600_000;
	vi.spyOn(Math, 'random').mockReturnValue(0);
	const node = new NodeGameAdapter(structuredClone(initial), () => {}, () => now, () => 0);
	const stub = env.GAME_ROOMS.getByName(roomId);
	type AdapterView = {
		game: GameState;
		apply(event: import('../../shared/game').GameEvent, now: number): void;
		save(): Promise<void>;
	};
	await runInDurableObject(stub, instance => {
		(instance as unknown as AdapterView).game = structuredClone(initial);
	});
	async function both(event: import('../../shared/game').GameEvent) {
		node.apply(event);
		const stored = await runInDurableObject(stub, async (instance, ctx) => {
			const worker = instance as unknown as AdapterView;
			worker.apply(event, now);
			await worker.save();
			return ctx.storage.get<GameState>('game');
		});
		expect(node.state).toEqual(stored);
	}
	try {
		for (const id of ['a', 'b', 'c']) await both({ type: 'room:join', player: { id, displayName: id } });
		await both({ type: 'game:start', playerId: 'a', gameId: 'same-game', gameDuration: 20 });
		now += 3000;
		await both({ type: 'deadline' });
		await both({ type: 'word:success', playerId: 'b' }); // non-holder
		await both({ type: 'currentInput', playerId: 'a', input: 'x'.repeat(40) });
		await both({ type: 'word:success', playerId: 'a' });
		await both({ type: 'word:success', playerId: 'b' }); // wrap around
		for (let phase = 0; phase < 5; phase++) {
			now = node.state.bombAt!;
			await both({ type: 'deadline' });
		}
		expect(node.state.room.users).toHaveLength(0);
		expect(node.state.room.isStart).toBe(false);
		for (const id of ['a', 'b']) await both({ type: 'room:join', player: { id, displayName: id } });
		await both({ type: 'game:start', playerId: 'a', gameId: 'cancelled-game', gameDuration: 20 });
		await both({ type: 'room:leave', playerId: 'b', reason: 'disconnect' });
		expect(node.state.wordAt).toBeUndefined();
		expect(node.state.bombAt).toBeUndefined();
	} finally {
		node.dispose();
	}
});

it('restores stored revisions and defaults legacy snapshots to revision zero', async () => {
	const stub = env.GAME_ROOMS.getByName(roomId);
	const oldState = {
		room: {
			id: roomId, maxPlayers: 2, gameDuration: 20, items: [],
			users: [], isStart: false, bombHolder: 0, bombStatus: 0,
		},
		wordAt: undefined,
		bombAt: undefined,
	};
	await runInDurableObject(stub, async (_, ctx) => {
		await ctx.storage.put('game', oldState);
	});
	await evictDurableObject(stub);
	const legacyLoaded = await runInDurableObject(stub, instance =>
		(instance as unknown as { game: GameState }).game,
	);
	expect(legacyLoaded.revision).toBe(0);
	await runInDurableObject(stub, async (instance) => {
		(instance as unknown as { game: GameState }).game.revision = 12;
		await (instance as unknown as { save(): Promise<void> }).save();
	});
	await evictDurableObject(stub);
	const restored = await runInDurableObject(stub, instance =>
		(instance as unknown as { game: GameState }).game,
	);
	expect(restored.revision).toBe(12);
});
