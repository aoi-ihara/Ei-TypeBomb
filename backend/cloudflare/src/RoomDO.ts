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
import {
    ClientError,
    isRequestId,
    parseClientEvent,
    requireRoomItems,
    validateAuthPayload,
} from "../../shared/validation";
import type { GameState, Room } from "../../shared/types";
import type { Env, Session } from "./types";
import { loadRoom } from "./lib/database";
import { verifyRoomToken, verifyClientSessionToken } from "./lib/auth";
import { encodeWireMessage, parseWireMessage } from "./lib/wire";

import { clusterConfig } from "../../shared/distributed/control";
import { DistributedRoom } from "../../shared/distributed/runtime";
import { WorkerControl } from "./lib/cluster";
import type { Command } from "../../shared/distributed/types";

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
    private distributed?: DistributedRoom;
    private control?: WorkerControl;
    private pendingLeaves: Record<string, number> = {};
    private queue: Promise<void> = Promise.resolve();
    private readonly accept = createKeyedRateLimit(
        (key) => eventRateLimit(key.slice(key.indexOf("|") + 1)),
        Date.now,
        { maxBuckets: 5_000, staleAfterMs: 60_000 },
    );

    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        if (clusterConfig(env, "websocket")) {
            this.control = new WorkerControl(env);
        }
        ctx.blockConcurrencyWhile(async () => {
            this.game = this.control
                ? null
                : ((await ctx.storage.get<GameState>("state")) ?? null);
            this.pendingLeaves =
                (await ctx.storage.get<Record<string, number>>(
                    "pendingLeaves",
                )) ?? {};
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
        const session: Session = {
            id: crypto.randomUUID(),
            roomId: null,
            targetRoomId: roomId,
        };
        this.ctx.acceptWebSocket(server);
        server.serializeAttachment(session);
        this.send(server, "connect", { id: session.id });
        this.send(server, "auth:request");
        return new Response(null, { status: 101, webSocket: client });
    }

    async webSocketMessage(
        ws: WebSocket,
        message: string | ArrayBuffer,
    ): Promise<void> {
        const packet = parseWireMessage(message);
        if (!packet) return;
        await this.enqueue(async () => {
            const session = this.session(ws);
            if (!session) return;
            if (!this.accept(`${session.id}|${packet.event}`)) return;
            try {
                await this.handle(ws, session, packet.event, packet.data);
            } catch (error) {
                console.error(
                    "Worker room event failed",
                    error instanceof Error ? error.name : "Unknown",
                );
                const text =
                    error instanceof ClientError
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
        try {
            ws.close(1011, "Connection error");
        } catch {
            /* already closed */
        }
    }

    async alarm(): Promise<void> {
        await this.enqueue(async () => {
            if (this.control) {
                if (!this.distributed) {
                    // DO isolates can be evicted independently of their persisted
                    // alarms. Restore ownership/game state before advancing deadlines.
                    const roomId = (await this.ctx.storage.get<string>("distributedRoomId")) ??
                        this.ctx.getWebSockets()
                            .map((ws) => this.session(ws))
                            .find((session) => session?.roomId)?.roomId;
                    if (roomId) {
                        try {
                            await this.ensureDistributed(roomId);
                        } catch {
                            // Do not discard a persisted deadline on transient
                            // peer unavailability; retry restoration later.
                            await this.ctx.storage.setAlarm(Date.now() + 1_000);
                            return;
                        }
                    }
                }
                if (this.distributed) {
                    try {
                        await this.distributed.tick();
                    } catch {
                        this.distributed.dispose();
                    }
                    if (this.distributed.halted || this.distributed.deleted) {
                        this.distributed = undefined;
                        this.game = null;
                        for (const ws of this.ctx.getWebSockets())
                            try {
                                ws.close(1012, "Resolve current owner");
                            } catch {
                                /* closed */
                            }
                        await this.ctx.storage.delete("distributedRoomId");
                        await this.ctx.storage.deleteAlarm();
                        return;
                    }
                    this.game = this.distributed.state;
                    await this.scheduleNextAlarm();
                }
                return;
            }
            const now = Date.now();
            for (const [playerId, deadline] of Object.entries(
                this.pendingLeaves,
            )) {
                if (deadline > now) continue;
                delete this.pendingLeaves[playerId];
                if (
                    !this.ctx.getWebSockets().some((ws) => {
                        const active = this.session(ws);
                        return (
                            ws.readyState === WebSocket.OPEN &&
                            active?.roomId &&
                            active.id === playerId
                        );
                    }) &&
                    this.game
                ) {
                    await this.apply({
                        type: "room:leave",
                        playerId,
                        reason: "disconnect",
                    });
                }
            }
            await this.ctx.storage.put("pendingLeaves", this.pendingLeaves);
            if (
                !this.ctx
                    .getWebSockets()
                    .some((ws) => ws.readyState === WebSocket.OPEN) &&
                Object.keys(this.pendingLeaves).length === 0
            ) {
                this.game = null;
                await this.ctx.storage.delete("state");
                await this.ctx.storage.deleteAlarm();
                return;
            }
            if (this.game) await this.apply({ type: "deadline" });
            await this.scheduleNextAlarm();
        });
    }

    private enqueueResponse(task: () => Promise<Response>): Promise<Response> {
        const next = this.queue.then(task);
        this.queue = next.then(
            () => {},
            () => {},
        );
        return next;
    }
    private enqueue(task: () => Promise<void>): Promise<void> {
        const next = this.queue.then(task);
        this.queue = next.catch((error) => {
            console.error(
                "Worker room task failed",
                error instanceof Error ? error.name : "Unknown",
            );
        });
        return next;
    }

    private session(ws: WebSocket): Session | null {
        const value: unknown = ws.deserializeAttachment();
        if (
            !value ||
            typeof value !== "object" ||
            !("id" in value) ||
            typeof value.id !== "string" ||
            !("roomId" in value)
        )
            return null;
        return value as Session;
    }

    private send(ws: WebSocket, event: string, data?: unknown): void {
        try {
            if (ws.readyState === WebSocket.OPEN)
                ws.send(encodeWireMessage(event, data));
        } catch {
            // Cloudflare closes broken sockets; websocketClose cleans up the room.
        }
    }

    private broadcast(event: string, data?: unknown): void {
        const packet = encodeWireMessage(event, data);
        for (const ws of this.ctx.getWebSockets()) {
            if (!this.session(ws)?.roomId || ws.readyState !== WebSocket.OPEN)
                continue;
            try {
                ws.send(packet);
            } catch {
                /* close callback performs cleanup */
            }
        }
    }

    private sendRoomInfo(): void {
        if (this.distributed) {
            if (!this.distributed.halted)
                this.broadcast("room:broadcast", this.distributed.snapshot());
        } else if (this.game)
            this.broadcast(
                "room:broadcast",
                roomSnapshot(this.game.room, this.game.revision),
            );
    }

    private recommendedIndex(playerId: string, room: Room): number | undefined {
        const session = this.ctx
            .getWebSockets()
            .map((ws) => this.session(ws))
            .find((item) => item?.id === playerId);
        if (!session?.recommendedItemId) return undefined;
        const index = room.items.findIndex(
            (item) => item.id === session.recommendedItemId,
        );
        return index < 0 ? undefined : index;
    }

    private async ensureDistributed(
        roomId: string,
        jwtToken?: string,
    ): Promise<void> {
        if (this.distributed) return;
        if (!this.control) throw new Error("Cluster disabled");
        const saved = await this.control.call("read", {
            roomId: roomId,
        });
        // Fresh rooms may start on the first reachable certified tier.
        if (
            (!saved.ownership || saved.ownership.lifecycle === "DELETED") &&
            !jwtToken
        )
            throw new Error("Migration cannot load database settings");
        const initial =
            !saved.ownership || saved.ownership.lifecycle === "DELETED"
                ? await loadRoom(roomId, jwtToken!, this.env)
                : undefined;
        if (initial) requireRoomItems(initial);
        if (
            (!saved.ownership || saved.ownership.lifecycle === "DELETED") &&
            !initial
        )
            throw new ClientError("ルーム情報を取得できませんでした。");
        const game = new DistributedRoom(roomId, this.control, (result) => {
            this.game = result.state;
            for (const effect of result.effects)
                if (
                    effect.type === "broadcast" &&
                    effect.packet.event !== "room:broadcast"
                )
                    this.broadcast(effect.packet.event, effect.packet.data);
            this.broadcast("room:broadcast", game.snapshot());
        });
        await game.open(initial ?? undefined);
        // Persist the room identity before the first alarm fires so that
        // a fresh isolate can rehydrate without any connected clients.
        await this.ctx.storage.put("distributedRoomId", roomId);
        this.distributed = game;
        this.game = game.state;
    }
    /** Internal RPC: start the reconnect deadline even if no client returns. */
    async resumeMigration(roomId: string): Promise<void> {
        await this.enqueue(async () => {
            await this.ensureDistributed(roomId);
            await this.scheduleNextAlarm();
        });
    }

    private async handle(
        ws: WebSocket,
        session: Session,
        event: string,
        data: unknown,
    ): Promise<void> {
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
            const authenticatedRoomId = await verifyRoomToken(
                response.jwtToken,
                this.env,
            );
            // A valid token must authorize exactly the URL-selected room.
            const previousRoomId = this.game?.room.id;
            if (
                session.targetRoomId !== authenticatedRoomId ||
                (previousRoomId && previousRoomId !== authenticatedRoomId)
            ) {
                throw new ClientError(
                    "認証されたルームが接続先と一致しません。",
                );
            }
            if (this.control) {
                if (!response.sessionToken)
                    throw new ClientError("署名付きセッションが必要です。");
                await verifyClientSessionToken(
                    response.sessionToken,
                    authenticatedRoomId,
                    this.env,
                );
                await this.ensureDistributed(
                    authenticatedRoomId,
                    response.jwtToken,
                );
            }
            if (!this.game) {
                const room = await loadRoom(
                    authenticatedRoomId,
                    response.jwtToken,
                    this.env,
                );
                if (!room)
                    throw new ClientError("ルーム情報を取得できませんでした。");
                requireRoomItems(room);
                this.game = { room, revision: 0 };
                await this.ctx.storage.put("state", this.game);
            }
            const stableId = response.sessionToken
                ? await verifyClientSessionToken(
                      response.sessionToken,
                      authenticatedRoomId,
                      this.env,
                  )
                : session.id;
            session.id = stableId;
            session.roomId = authenticatedRoomId;
            session.displayName = response.displayName;
            ws.serializeAttachment(session);
            for (const other of this.ctx.getWebSockets()) {
                if (other === ws) continue;
                const previous = this.session(other);
                if (
                    previous?.roomId === authenticatedRoomId &&
                    previous.id === stableId &&
                    other.readyState === WebSocket.OPEN
                )
                    other.close(4000, "Session replaced");
            }
            delete this.pendingLeaves[stableId];
            await this.ctx.storage.put("pendingLeaves", this.pendingLeaves);
            await this.scheduleNextAlarm();
            if (this.distributed) {
                await this.distributed.connect(stableId);
                this.game = this.distributed.state;
                await this.scheduleNextAlarm();
            }
            this.send(ws, "auth:session", { id: stableId });
            this.sendRoomInfo();
            return;
        }
        if (!session.roomId || !this.game) return;
        if (event === "cluster:ping" && this.distributed) {
            if (
                !this.distributed.halted &&
                this.distributed.checkpoint.ownership.owner ===
                    this.control?.config.id
            )
                this.send(ws, "cluster:pong");
            return;
        }
        if (event === "game:command" && this.distributed) {
            const command = data as Command;
            if (!command || typeof command !== "object" || !command.event)
                return;
            if (command.event.type === "room:join")
                command.event.player = {
                    id: session.id,
                    displayName: session.displayName,
                };
            try {
                const status = await this.distributed.command(
                    command,
                    session.id,
                );
                this.sendRoomInfo();
                this.send(ws, "command:ack", { id: command.id, status });
            } catch {
                if (this.distributed.halted) this.send(ws, "cluster:paused");
                else
                    this.send(ws, "command:ack", {
                        id: command.id,
                        status: "rejected",
                    });
            }
            await this.scheduleNextAlarm();
            return;
        }
        if (
            this.distributed &&
            ["room:join", "room:leave", "game:start", "word:success"].includes(
                event,
            )
        )
            return;
        if (event === "item:recommend") {
            const parsed = parseClientEvent(event, data);
            if (!parsed || parsed.event !== "item:recommend") return;
            if (
                !this.game.room.users.some((player) => player.id === session.id)
            )
                return;
            if (
                !this.game.room.items.some(
                    (item) => item.id === parsed.data.itemId,
                )
            )
                return;
            this.distributed?.recommend(session.id, parsed.data.itemId);
            session.recommendedItemId = parsed.data.itemId;
            ws.serializeAttachment(session);
            return;
        }
        if (event === "currentInput") {
            const valid =
                typeof data === "string" ||
                (data !== null &&
                    typeof data === "object" &&
                    "input" in data &&
                    typeof data.input === "string" &&
                    data.input.length <= 4096);
            if (valid)
                await this.apply({
                    type: "currentInput",
                    playerId: session.id,
                    input: data,
                });
            return;
        }
        const parsed = parseClientEvent(event, data);
        if (!parsed) return;
        switch (parsed.event) {
            case "room:join":
                await this.apply({
                    type: "room:join",
                    player: {
                        id: session.id,
                        displayName: session.displayName,
                    },
                });
                break;
            case "room:leave":
                await this.apply({
                    type: "room:leave",
                    playerId: session.id,
                    reason: "room_leave",
                });
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
                await this.apply({
                    type: "word:success",
                    playerId: session.id,
                });
                break;
            case "hint:update":
                await this.apply({
                    type: "hint:update",
                    playerId: session.id,
                    length: parsed.data.length,
                });
                break;
        }
    }

    private async apply(event: GameEvent): Promise<void> {
        if (this.distributed) {
            await this.distributed.apply(event);
            this.game = this.distributed.state;
            await this.scheduleNextAlarm();
            return;
        }
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
        if (event.type !== "currentInput")
            await this.ctx.storage.put("state", this.game);
        const after = nextGameDeadline(this.game);
        if (before !== after) await this.scheduleNextAlarm();
        for (const effect of result.effects) {
            if (effect.type === "broadcast") {
                this.broadcast(effect.packet.event, effect.packet.data);
            } else if (effect.activity.event !== "word_passed") {
                console.log(
                    "Room activity",
                    effect.activity.event,
                    this.game.room.id,
                );
            }
        }
    }

    private async scheduleNextAlarm(): Promise<void> {
        if (this.control) {
            if (
                this.distributed &&
                !this.distributed.halted &&
                !this.distributed.deleted
            )
                await this.ctx.storage.setAlarm(
                    Math.max(
                        Date.now() + 1,
                        Math.min(
                            this.distributed.inputFlushAt ?? Date.now() + 1_000,
                            ...(this.distributed.checkpoint.value?.resumeUntil
                                ? []
                                : [
                                      nextGameDeadline(
                                          this.distributed.state,
                                      ) ?? Infinity,
                                  ]),
                        ),
                    ),
                );
            return;
        }
        const deadlines = [
            ...(this.game ? [nextGameDeadline(this.game)] : []),
            ...Object.values(this.pendingLeaves),
        ].filter(
            (value): value is number =>
                typeof value === "number" && Number.isFinite(value),
        );
        if (!deadlines.length) await this.ctx.storage.deleteAlarm();
        else
            await this.ctx.storage.setAlarm(
                Math.max(Date.now() + 1, Math.min(...deadlines)),
            );
    }

    private async disconnect(ws: WebSocket): Promise<void> {
        const session = this.session(ws);
        if (!session?.roomId) return;
        // A new socket may already have authenticated as the same tab.
        const replacement = this.ctx.getWebSockets().some((other) => {
            if (other === ws || other.readyState !== WebSocket.OPEN)
                return false;
            const active = this.session(other);
            return (
                active?.roomId === session.roomId && active.id === session.id
            );
        });
        if (replacement) return;
        if (this.distributed) {
            await this.distributed.disconnect(session.id);
            await this.scheduleNextAlarm();
            return;
        }
        this.pendingLeaves[session.id] = Date.now() + 20_000;
        await this.ctx.storage.put("pendingLeaves", this.pendingLeaves);
        await this.scheduleNextAlarm();
    }
}
