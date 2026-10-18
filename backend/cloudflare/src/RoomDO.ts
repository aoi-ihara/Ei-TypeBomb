import { DurableObject } from "cloudflare:workers";
import {
    applyGameEvent,
    canStart,
    nextGameDeadline,
    type GameEvent,
    type GameRules,
} from "../../shared/game";
import { roomSnapshot } from "../../shared/protocol";
import { eventRateLimit } from "../../shared/rateLimits";
import { createKeyedRateLimit } from "../../shared/keyedRateLimit";
import { ClientError, isRequestId, parseClientEvent, requireRoomItems, validateAuthPayload } from "../../shared/validation";
import type { GameState, Room } from "../../shared/types";
import type { Env, Session } from "./types";
import { loadRoom } from "./lib/database";
import { verifyRoomToken, verifyClientSessionToken } from "./lib/auth";
import { encodeWireMessage, parseWireMessage } from "./lib/wire";

const RULES: GameRules = {
    allowSpectatorStart: true,
    allowCountdownPass: true,
    clearInputOnStop: false,
};

/**
 * One authoritative game per room. All connected sockets are hibernatable,
 * and durable game deadlines survive a Worker isolate restart.
 */
export class RoomDO extends DurableObject<Env> {
    private game: GameState | null = null;
    private pendingLeaves: Record<string, number> = {};
    private queue: Promise<void> = Promise.resolve();
    private readonly accept = createKeyedRateLimit(
        (key) => eventRateLimit(key.slice(key.indexOf("|") + 1)),
        Date.now,
        { maxBuckets: 5_000, staleAfterMs: 60_000 },
    );

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        ctx.blockConcurrencyWhile(async () => {
            this.game = (await ctx.storage.get<GameState>("state")) ?? null;
            this.pendingLeaves = (await ctx.storage.get<Record<string, number>>("pendingLeaves")) ?? {};
        });
        // WorkerSocket sends this exact JSON packet every 25 seconds.
        // Replying automatically avoids waking idle Durable Objects.
        ctx.setWebSocketAutoResponse(
            new WebSocketRequestResponsePair(
                '{"event":"ping"}',
                '{"event":"pong"}',
            ),
        );
    }

    async fetch(request: Request): Promise<Response> {
        const roomId = new URL(request.url).pathname.split("/")[2];
        if (!roomId || (this.game && this.game.room.id !== roomId)) {
            return new Response("Room mismatch", { status: 400 });
        }
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("Upgrade required", { status: 426 });
        }
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);
        const session: Session = { id: crypto.randomUUID(), roomId: null, targetRoomId: roomId };
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment(session);
        this.send(server, "connect", { id: session.id });
        this.send(server, "auth:request");
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
        const packet = parseWireMessage(message);
        if (!packet) return;
        await this.enqueue(async () => {
            const session = this.session(ws);
            if (!session) return;
            if (!this.accept(`${session.id}|${packet.event}`)) return;
            try {
                await this.handle(ws, session, packet.event, packet.data);
            } catch (error) {
                console.error("Worker room event failed", error instanceof Error ? error.name : "Unknown");
                const text = error instanceof ClientError
                    ? error.message
                    : "認証またはルーム処理に失敗しました。再度お試しください。";
                this.send(ws, "error", { message: text });
            }
        });
    }

    async webSocketClose(ws: WebSocket): Promise<void> {
        await this.enqueue(() => this.disconnect(ws));
    }

    async webSocketError(ws: WebSocket): Promise<void> {
        await this.enqueue(() => this.disconnect(ws));
        try { ws.close(1011, "Connection error"); } catch { /* already closed */ }
    }

    async alarm(): Promise<void> {
        await this.enqueue(async () => {
            const now = Date.now();
            for (const [playerId, deadline] of Object.entries(this.pendingLeaves)) {
                if (deadline > now) continue;
                delete this.pendingLeaves[playerId];
                if (!this.ctx.getWebSockets().some(ws => {
                    const active = this.session(ws);
                    return ws.readyState === WebSocket.OPEN && active?.roomId && active.id === playerId;
                }) && this.game) {
                    await this.apply({ type: "room:leave", playerId, reason: "disconnect" });
                }
            }
            await this.ctx.storage.put("pendingLeaves", this.pendingLeaves);
            if (!this.ctx.getWebSockets().some(ws => ws.readyState === WebSocket.OPEN) &&
                Object.keys(this.pendingLeaves).length === 0) {
                this.game = null;
                await this.ctx.storage.delete("state");
                await this.ctx.storage.deleteAlarm();
                return;
            }
            if (this.game) await this.apply({ type: "deadline" });
            await this.scheduleNextAlarm();
        });
    }

    private enqueue(task: () => Promise<void>): Promise<void> {
        const next = this.queue.then(task);
        this.queue = next.catch(error => {
            console.error("Worker room task failed", error instanceof Error ? error.name : "Unknown");
        });
        return next;
    }

    private session(ws: WebSocket): Session | null {
        const value: unknown = ws.deserializeAttachment();
        if (!value || typeof value !== "object" || !("id" in value) ||
            typeof value.id !== "string" || !("roomId" in value)) return null;
        return value as Session;
    }

    private send(ws: WebSocket, event: string, data?: unknown): void {
        try {
            if (ws.readyState === WebSocket.OPEN) ws.send(encodeWireMessage(event, data));
        } catch {
            // Cloudflare closes broken sockets; websocketClose cleans up the room.
        }
    }

    private broadcast(event: string, data?: unknown): void {
        const packet = encodeWireMessage(event, data);
        for (const ws of this.ctx.getWebSockets()) {
            if (!this.session(ws)?.roomId || ws.readyState !== WebSocket.OPEN) continue;
            try { ws.send(packet); } catch { /* close callback performs cleanup */ }
        }
    }

    private sendRoomInfo(): void {
        if (this.game) this.broadcast("room:broadcast", roomSnapshot(this.game.room, this.game.revision));
    }

    private recommendedIndex(playerId: string, room: Room): number | undefined {
        const session = this.ctx.getWebSockets().map(ws => this.session(ws))
            .find(item => item?.id === playerId);
        if (!session?.recommendedItemId) return undefined;
        const index = room.items.findIndex(item => item.id === session.recommendedItemId);
        return index < 0 ? undefined : index;
    }

    private async handle(ws: WebSocket, session: Session, event: string, data: unknown): Promise<void> {
        if (event === "ping") {
            this.send(ws, "pong");
            return;
        }
        if (event === "health:ping") {
            if (isRequestId(data)) this.send(ws, "health:pong", data);
            return;
        }
        if (event === "auth:response") {
            const response = validateAuthPayload(data);
            const authenticatedRoomId = await verifyRoomToken(response.jwtToken, this.env);
            // A valid token must authorize exactly the URL-selected room.
            const previousRoomId = this.game?.room.id;
            if (session.targetRoomId !== authenticatedRoomId ||
                (previousRoomId && previousRoomId !== authenticatedRoomId)) {
                throw new ClientError("認証されたルームが接続先と一致しません。");
            }
            if (!this.game) {
                const room = await loadRoom(authenticatedRoomId, response.jwtToken, this.env);
                if (!room) throw new ClientError("ルーム情報を取得できませんでした。");
                requireRoomItems(room);
                this.game = { room, revision: 0 };
                await this.ctx.storage.put("state", this.game);
            }
            const stableId = response.sessionToken
                ? await verifyClientSessionToken(response.sessionToken, authenticatedRoomId, this.env)
                : session.id;
            session.id = stableId;
            session.roomId = authenticatedRoomId;
            session.displayName = response.displayName;
            ws.serializeAttachment(session);
            for (const other of this.ctx.getWebSockets()) {
                if (other === ws) continue;
                const previous = this.session(other);
                if (previous?.roomId === authenticatedRoomId && previous.id === stableId &&
                    other.readyState === WebSocket.OPEN) other.close(4000, "Session replaced");
            }
            delete this.pendingLeaves[stableId];
            await this.ctx.storage.put("pendingLeaves", this.pendingLeaves);
            await this.scheduleNextAlarm();
            this.send(ws, "auth:session", { id: stableId });
            this.sendRoomInfo();
            return;
        }
        if (!session.roomId || !this.game) return;
        if (event === "item:recommend") {
            const parsed = parseClientEvent(event, data);
            if (!parsed || parsed.event !== "item:recommend") return;
            if (!this.game.room.users.some(player => player.id === session.id)) return;
            if (!this.game.room.items.some(item => item.id === parsed.data.itemId)) return;
            session.recommendedItemId = parsed.data.itemId;
            ws.serializeAttachment(session);
            return;
        }
        if (event === "currentInput") {
            const valid = typeof data === "string" ||
                (data !== null && typeof data === "object" && "input" in data &&
                    typeof data.input === "string" && data.input.length <= 4096);
            if (valid) await this.apply({ type: "currentInput", playerId: session.id, input: data });
            return;
        }
        const parsed = parseClientEvent(event, data);
        if (!parsed) return;
        switch (parsed.event) {
            case "room:join":
                await this.apply({ type: "room:join", player: { id: session.id, displayName: session.displayName } });
                break;
            case "room:leave":
                await this.apply({ type: "room:leave", playerId: session.id, reason: "room_leave" });
                break;
            case "game:start":
                if (canStart(this.game, session.id, RULES)) {
                    await this.apply({
                        type: "game:start",
                        playerId: session.id,
                        gameId: crypto.randomUUID(),
                        gameDuration: this.game.room.gameDuration,
                    });
                }
                break;
            case "word:success":
                await this.apply({ type: "word:success", playerId: session.id });
                break;
            case "hint:update":
                await this.apply({ type: "hint:update", playerId: session.id, length: parsed.data.length });
                break;
        }
    }

    private async apply(event: GameEvent): Promise<void> {
        if (!this.game) return;
        const previous = this.game;
        const before = nextGameDeadline(previous);
        const result = applyGameEvent(previous, event, {
            now: Date.now(),
            random: Math.random,
            rules: RULES,
            chooseItemIndex: (id, room) => this.recommendedIndex(id, room),
        });
        if (result.state === previous && result.effects.length === 0) return;
        this.game = result.state;
        // Text input is ephemeral, and a write per keystroke would exhaust the
        // free-tier storage budget. It is broadcast immediately instead.
        if (event.type !== "currentInput") await this.ctx.storage.put("state", this.game);
        const after = nextGameDeadline(this.game);
        if (before !== after) await this.scheduleNextAlarm();
        for (const effect of result.effects) {
            if (effect.type === "broadcast") {
                this.broadcast(effect.packet.event, effect.packet.data);
            } else if (effect.activity.event !== "word_passed") {
                console.log("Room activity", effect.activity.event, this.game.room.id);
            }
        }
    }

    private async scheduleNextAlarm(): Promise<void> {
        const deadlines = [
            ...(this.game ? [nextGameDeadline(this.game)] : []),
            ...Object.values(this.pendingLeaves),
        ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        if (!deadlines.length) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...deadlines)));
    }

    private async disconnect(ws: WebSocket): Promise<void> {
        const session = this.session(ws);
        if (!session?.roomId) return;
        // A new socket may already have authenticated as the same tab.
        const replacement = this.ctx.getWebSockets().some(other => {
            if (other === ws || other.readyState !== WebSocket.OPEN) return false;
            const active = this.session(other);
            return active?.roomId === session.roomId && active.id === session.id;
        });
        if (replacement) return;
        this.pendingLeaves[session.id] = Date.now() + 20_000;
        await this.ctx.storage.put("pendingLeaves", this.pendingLeaves);
        await this.scheduleNextAlarm();
    }
}
