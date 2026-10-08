import { DurableObject } from 'cloudflare:workers';
import type { GameState, Session, WorkerEnv } from './types';
import { capture, checkDatabase, ClientError, getRoom, verifyToken } from './lib/services';
import { acceptEvent } from './lib/rateLimit';
import { applyGameEvent, hasPlayerCapacity } from '../../shared/game';
import { isHealthRequestId, validateAuthResponse } from '../../shared/validation';
import { roomToWireSnapshot, type ServerWirePayloads, type ClientWirePacket } from '../../shared/protocol';
import { EVENT_RATE_LIMITS } from '../../shared/rateLimit';

const IDLE_TIMEOUT = 75_000;
const AUTH_TIMEOUT = 20_000;
const DATABASE_PROBE_BUCKET_KEY = 'database-probe-bucket';

export class GameRoom extends DurableObject<WorkerEnv> {
	private game?: GameState;
	constructor(ctx: DurableObjectState, env: WorkerEnv) {
		super(ctx, env);
		ctx.blockConcurrencyWhile(async () => {
			this.game = await ctx.storage.get<GameState>('game');
		});
	}
	private send<E extends keyof ServerWirePayloads>(ws: WebSocket, event: E, data?: ServerWirePayloads[E]) {
		try {
			ws.send(JSON.stringify({ event, data }));
		} catch {
			/* Close/error handler cleans up membership. */
		}
	}
	private broadcast<E extends keyof ServerWirePayloads>(event: E, data?: ServerWirePayloads[E]) {
		for (const ws of this.ctx.getWebSockets()) {
			if ((ws.deserializeAttachment() as Session).authenticated) this.send(ws, event, data);
		}
	}
	private snapshot() {
		if (!this.game) return;
		this.broadcast('room:broadcast', roomToWireSnapshot(this.game.room));
	}
	private track(event: string, properties: Record<string, unknown> = {}) {
		console.log(JSON.stringify({ event, roomId: this.game?.room.id, ...properties }));
		this.ctx.waitUntil(capture(this.env, event, properties));
	}
	private async save() {
		if (this.game) await this.ctx.storage.put('game', this.game);
		else await this.ctx.storage.delete('game');
		const deadlines: number[] = [];
		if (this.game?.wordAt) deadlines.push(this.game.wordAt);
		if (this.game?.bombAt) deadlines.push(this.game.bombAt);
		for (const ws of this.ctx.getWebSockets()) {
			if (ws.readyState !== WebSocket.OPEN) continue;
			const session = ws.deserializeAttachment() as Session;
			deadlines.push(session.lastSeen + (session.authenticated ? IDLE_TIMEOUT : AUTH_TIMEOUT));
		}
		if (deadlines.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
		else await this.ctx.storage.deleteAlarm();
	}
	private async acceptDatabaseProbe(now = Date.now()) {
		const { capacity, perSecond } = EVENT_RATE_LIMITS['health:database'];
		const bucket = (await this.ctx.storage.get<{ tokens: number; updatedAt: number }>(DATABASE_PROBE_BUCKET_KEY)) ?? {
			tokens: capacity,
			updatedAt: now,
		};
		bucket.tokens = Math.min(capacity, bucket.tokens + (Math.max(0, now - bucket.updatedAt) * perSecond) / 1000);
		bucket.updatedAt = now;
		if (bucket.tokens < 1) {
			await this.ctx.storage.put(DATABASE_PROBE_BUCKET_KEY, bucket);
			return false;
		}
		bucket.tokens -= 1;
		await this.ctx.storage.put(DATABASE_PROBE_BUCKET_KEY, bucket);
		return true;
	}
	async fetch(request: Request): Promise<Response> {
		// A fresh connection cannot inherit stale players after all old sockets disappeared.
		if (!this.ctx.getWebSockets().length) this.game = undefined;
		const pair = new WebSocketPair();
		const session: Session = {
			id: crypto.randomUUID(),
			roomId: new URL(request.url).pathname.split('/')[2],
			authenticated: false,
			lastSeen: Date.now(),
			buckets: {},
		};
		this.ctx.acceptWebSocket(pair[1]);
		pair[1].serializeAttachment(session);
		this.send(pair[1], 'connect', { id: session.id });
		this.send(pair[1], 'auth:request');
		await this.save();
		return new Response(null, { status: 101, webSocket: pair[0] });
	}
	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
		// Database probes do not read or mutate game state. Keep the slow network
		// request outside the room-wide input gate so gameplay can continue while
		// Supabase is responding.
		if (typeof message === 'string' && message.length <= 16_384) {
			let packet: { event?: unknown; data?: unknown } | undefined;
			try {
				packet = JSON.parse(message);
			} catch {
				// The serialized handler below reports malformed packets consistently.
			}
			if (packet?.event === 'health:database') {
				const session = ws.deserializeAttachment() as Session;
				if (!acceptEvent(session, packet.event)) {
					ws.serializeAttachment(session);
					return;
				}
				ws.serializeAttachment(session);
				const requestId = packet.data;
				if (!isHealthRequestId(requestId)) return;
				// Keep probes on the dedicated health Durable Object and use its
				// persisted bucket across reconnects. Only this tiny storage update
				// is serialized; the Supabase request itself stays outside the
				// room-wide gameplay gate.
				if (session.roomId !== 'health' || !(await this.acceptDatabaseProbe())) return;
				try {
					const latencyMs = await checkDatabase(this.env);
					this.send(ws, 'health:database-result', { requestId, ok: true, latencyMs });
				} catch {
					this.send(ws, 'health:database-result', { requestId, ok: false, latencyMs: null });
				}
				return;
			}
		}
		// Serialize asynchronous auth/DB reads with joins, disconnects, and alarms.
		await this.ctx.blockConcurrencyWhile(async () => {
			const session = ws.deserializeAttachment() as Session;
			try {
				if (typeof message !== 'string' || message.length > 16_384) {
					ws.close(1009, 'Message too large');
					return;
				}
				const packet = JSON.parse(message) as ClientWirePacket;
				if (!packet || typeof packet.event !== 'string') return;
				if (packet.event === 'ping') {
					if (session.authenticated) session.lastSeen = Date.now();
					ws.serializeAttachment(session);
					this.send(ws, 'pong');
					return;
				}
				if (!acceptEvent(session, packet.event)) {
					ws.serializeAttachment(session);
					return;
				}
				ws.serializeAttachment(session);
				if (packet.event === 'health:ping') {
					if (isHealthRequestId(packet.data))
						this.send(ws, 'health:pong', packet.data);
					return;
				}
				if (packet.event === 'auth:response') {
					const { jwtToken, displayName } = validateAuthResponse(packet.data);
					const id = await verifyToken(jwtToken, this.env.JWT_SECRET);
					if (!id || id !== session.roomId) throw new ClientError('認証トークンが無効または有効期限切れです。ルームに入り直してください。');
					if (!this.game) this.game = { room: await getRoom(this.env, id) };
					session.displayName = displayName;
					session.authenticated = true;
					session.lastSeen = Date.now();
					ws.serializeAttachment(session);
					this.game = {
						...this.game,
						room: {
							...this.game.room,
							users: (this.game.room.users ?? []).map((user) => user.id === session.id ? { ...user, displayName } : user),
						},
					};
					this.track('room_authenticated');
					await this.save();
					this.snapshot();
					return;
				}
				if (!session.authenticated || !this.game) return;
				session.lastSeen = Date.now();
				ws.serializeAttachment(session);
				const room = this.game.room;
				switch (packet.event) {
					case 'room:join':
						if (!hasPlayerCapacity(room)) return;
						if (this.apply({ event: 'room:join', player: { id: session.id, displayName: session.displayName! } }))
							this.track('player_joined', { player_count: this.game.room.users?.length ?? 0 });
						break;
					case 'room:leave':
						this.leave(session, 'room_leave');
						break;
					case 'currentInput':
						this.apply({ event: 'currentInput', playerId: session.id, input: packet.data });
						return;
					case 'word:success':
						if (!this.apply({ event: 'word:success', playerId: session.id })) return;
						break;
					case 'game:start': {
						if (room.isStart || (room.users?.length ?? 0) < 2 || !room.users?.some((user) => user.id === session.id)) return;
						const saved = await getRoom(this.env, room.id);
						this.game = { ...this.game, room: { ...room, gameDuration: saved.gameDuration } };
						if (this.apply({ event: 'game:start', playerId: session.id }))
							this.track('game_started', { player_count: this.game.room.users?.length ?? 0 });
						break;
					}
				}
				await this.save();
				this.snapshot();
			} catch (error) {
				const message = error instanceof ClientError ? error.message : '処理に失敗しました。しばらくしてから再度お試しください。';
				this.send(ws, 'error', { message });
				this.track('server_error', { message });
			}
		});
	}
	private apply(event: Parameters<typeof applyGameEvent>[1], now = Date.now()) {
		if (!this.game) return false;
		const previous = this.game;
		const result = applyGameEvent(previous, event, {
			now,
			random: Math.random,
			gameId: event.event === 'game:start' ? crypto.randomUUID() : undefined,
		});
		this.game = result.state;
		for (const effect of result.effects) this.broadcast(effect.event, effect.data);
		return result.state !== previous;
	}
	private leave(session: Session, reason: string) {
		const room = this.game?.room;
		if (!room || !room.users?.some((user) => user.id === session.id)) return;
		if (room.isStart) {
			this.track('game_cancelled', { reason, player_count: room.users.length });
		}
		this.apply({ event: 'room:leave', playerId: session.id });
		this.track('player_left', { reason, player_count: this.game?.room.users?.length ?? 0 });
	}
	async webSocketClose(ws: WebSocket) {
		await this.remove(ws);
	}
	async webSocketError(ws: WebSocket) {
		await this.remove(ws);
	}
	private async remove(ws: WebSocket) {
		await this.ctx.blockConcurrencyWhile(async () => {
			this.leave(ws.deserializeAttachment() as Session, 'disconnect');
			try {
				ws.close(1000, 'Disconnected');
			} catch {
				/* Already closed. */
			}
			if (!this.ctx.getWebSockets().some((other) => other !== ws && (other.deserializeAttachment() as Session).authenticated))
				this.game = undefined;
			await this.save();
			this.snapshot();
		});
	}
	async alarm() {
		await this.ctx.blockConcurrencyWhile(async () => {
			const now = Date.now();
			for (const ws of this.ctx.getWebSockets()) {
				const session = ws.deserializeAttachment() as Session;
				if (session.lastSeen + (session.authenticated ? IDLE_TIMEOUT : AUTH_TIMEOUT) <= now) {
					this.leave(session, 'disconnect');
					session.authenticated = false;
					ws.serializeAttachment(session);
					ws.close(1000, 'Connection timed out');
				}
			}
			if (!this.ctx.getWebSockets().some((ws) => (ws.deserializeAttachment() as Session).authenticated)) this.game = undefined;
			const previous = this.game;
			this.apply({ event: 'deadlines' }, Date.now());
			if (previous?.room.isStart && !this.game?.room.isStart)
				this.track('game_finished', { player_count: previous.room.users?.length ?? 0 });
			await this.save();
			this.snapshot();
		});
	}
}

export default {
	async fetch(request: Request, env: WorkerEnv): Promise<Response> {
		const url = new URL(request.url);
		const origin = request.headers.get('Origin');
		const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
		const permitted = !origin || allowed.includes('*') || allowed.includes(origin);
		const headers = {
			'Access-Control-Allow-Origin': allowed.includes('*') ? '*' : permitted && origin ? origin : '',
			'Access-Control-Allow-Methods': 'GET, OPTIONS',
			Vary: 'Origin',
		};
		if (!permitted) return new Response('Origin not allowed', { status: 403 });
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
		if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
		if (url.pathname === '/' || url.pathname === '/health') return Response.json({ status: 'ok', service: 'ei-typebomb' }, { headers });
		if (!/^\/ws\/(?:[\da-f-]{36}|health)$/.test(url.pathname)) return new Response('Not found', { status: 404, headers });
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426, headers });
		return env.GAME_ROOMS.getByName(url.pathname.split('/')[2]).fetch(request);
	},
} satisfies ExportedHandler<WorkerEnv>;
