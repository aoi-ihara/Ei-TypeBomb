/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env, SELF, runInDurableObject, runDurableObjectAlarm, evictDurableObject, reset } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { acceptEvent } from '../src/lib/rateLimit';
import { validateDisplayName, verifyToken } from '../src/lib/services';
import type { GameState, Room, Session } from '../src/types';

const roomId = '12345678-1234-4123-8123-123456789abc';
const sockets: WebSocket[] = [];
const secret = new TextEncoder().encode('test-only-secret');
const token = (id = roomId, expiry = '1h') =>
	new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(expiry).sign(secret);
const responses: unknown[] = [];
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
		hasQueued: (event: string) => queue.some((packet) => packet.event === event),
		send: (event: string, data?: unknown) => ws.send(JSON.stringify({ event, data })),
	};
}
async function authenticate(client: Awaited<ReturnType<typeof connect>>, displayName = 'Player') {
	client.send('auth:response', { jwtToken: await token(), displayName });
	return client.next<Room>('room:broadcast');
}
beforeEach(() => {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
		expect(String(input)).toContain('https://db.example.test/rest/v1/ei_typebomb_rooms?');
		const response = responses.shift();
		if (!response) throw new Error('Unexpected outbound request');
		return Response.json(response);
	});
});
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
it('rejects malformed auth payloads through shared validation without authenticating', async () => {
	const client = await connect();
	client.send('auth:response', null);
	expect(await client.next<{ message: string }>('error')).toHaveProperty('message');
	const stub = env.GAME_ROOMS.getByName(roomId);
	expect(
		await runInDurableObject(stub, (_, ctx) => ctx.getWebSockets().some((ws) => (ws.deserializeAttachment() as Session).authenticated)),
	).toBe(false);
});
it('rejects malformed room items through shared validation', async () => {
	mockRoom([{ id: 'item', type: 'typed_recall', prompt: '猫', answer: 123 }]);
	const client = await connect();
	client.send('auth:response', { jwtToken: await token(), displayName: 'Player' });
	expect(await client.next<{ message: string }>('error')).toHaveProperty(
		'message',
		'ルームに問題が設定されていません。問題を設定してから再度お試しください。',
	);
	const stub = env.GAME_ROOMS.getByName(roomId);
	expect(await runInDurableObject(stub, (_, ctx) => ctx.storage.get('game'))).toBeUndefined();
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
	c.clear();
	c.send('room:join');
	c.send('ping');
	await c.next('pong');
	expect(c.hasQueued('room:broadcast')).toBe(false);
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
	// The real adapter uses the core's strict default: countdown passes are ignored.
	const countdownHolder = started.users[started.bombHolder].id === a.id ? a : b;
	countdownHolder.send('word:success');
	countdownHolder.send('ping');
	await countdownHolder.next('pong');
	const countdown = await runInDurableObject(stub, (_, ctx) => ctx.storage.get<GameState>('game'));
	expect(countdown?.room.bombHolder).toBe(started.bombHolder);
	expect(countdown?.room.wordIndex).toBeUndefined();
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
