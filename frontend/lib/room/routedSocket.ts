"use client";

// The bootstrap URLs establish trust. Further URLs come only from a successful
// HTTPS registry response at one of these URLs and are cached for this page.
type Server = {
    id: string;
    depth: number;
    transport: "socket.io" | "websocket";
};
type Ownership = {
    owner: string;
    epoch: number;
    revision: number;
    instance: string;
    lifecycle: string;
    roomId: string;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (...args: any[]) => void;
type Transport = {
    id?: string;
    connected: boolean;
    on(event: string, listener: Listener): unknown;
    emit(event: string, data?: unknown): unknown;
    disconnect(): unknown;
};
type Meta = { roomInstanceId: string; epoch: number; revision: number };
export class RoutedSocket {
    id?: string;
    connected = false;
    private listeners = new Map<string, Set<Listener>>();
    private transport?: Transport;
    private servers: Server[] = [];
    private stopped = false;
    private attempt = 0;
    private retry?: ReturnType<typeof setTimeout>;
    private recoveryFailures = 0;
    private wasBackgrounded = false;
    private heartbeat?: ReturnType<typeof setInterval>;
    private lastReply = 0;
    private meta?: Meta;
    private token?: string;
    private sessionToken?: string;
    private roomId?: string;
    private currentOwner?: string;
    private routedRevision?: number;
    private failure?: { owner: string; revision: number };
    private deliveredResults = new Set<string>();
    private pending = new Map<
        string,
        {
            originRevision: number;
            id: string;
            event: Record<string, unknown>;
            gameId?: string;
            turn?: number;
            bombId?: string;
        }
    >();
    private gameId?: string;
    private turn?: number;
    private bombId?: string;
    private playerId?: string;
    // Only a participant who actually joined should be restored. Spectators
    // and users who explicitly left must not be auto-enrolled.
    private joinedRoom = false;
    private rejoinOnSnapshot = false;
    constructor(
        private readonly seeds: string[],
        private readonly open: (url: string) => Transport,
        private readonly getToken: () => Promise<string | undefined>,
        private readonly foreground = () =>
            document.visibilityState !== "hidden",
        private readonly getSession?: () => Promise<string | undefined>,
    ) {
        void this.connect();
    }
    on(event: string, listener: Listener) {
        const set = this.listeners.get(event) ?? new Set();
        set.add(listener);
        this.listeners.set(event, set);
        return this;
    }
    off(event: string, listener: Listener) {
        this.listeners.get(event)?.delete(listener);
        return this;
    }
    once(event: string, listener: Listener) {
        const wrapper: Listener = (...args) => {
            this.off(event, wrapper);
            listener(...args);
        };
        return this.on(event, wrapper);
    }
    private dispatch(event: string, data?: unknown) {
        for (const listener of this.listeners.get(event) ?? []) listener(data);
    }
    emit(event: string, data?: unknown) {
        if (event === "room:leave") {
            this.joinedRoom = false;
            this.rejoinOnSnapshot = false;
        }
        if (event === "auth:response") {
            const auth = data as { sessionToken?: string };
            this.sessionToken = auth.sessionToken ?? this.sessionToken;
            this.transport?.emit(event, data);
            return this;
        }
        if (
            ["room:join", "room:leave", "game:start", "word:success"].includes(event)
        ) {
            if (!this.connected || !this.meta || this.pending.size) return this;
            const command = {
                originRevision: this.meta.revision,
                id: crypto.randomUUID(),
                event: { type: event },
                gameId: this.gameId,
                turn: this.turn,
                bombId: this.bombId,
            };
            if (event === "room:join") this.joinedRoom = true;
            this.pending.set(command.id, command);
            this.sendCommand(command);
            return this;
        }
        this.transport?.emit(event, data);
        return this;
    }
    private sendCommand(command: {
        id: string;
        event: Record<string, unknown>;
    }) {
        if (this.meta)
            this.transport?.emit("game:command", {
                ...command,
                instance: this.meta.roomInstanceId,
                epoch: this.meta.epoch,
                revision: this.meta.revision,
            });
    }
    async connect() {
        this.stopped = false;
        const attempt = ++this.attempt;
        try {
            this.token ??= await this.getToken();
            this.sessionToken ??= await this.getSession?.();
            if (!this.token) throw new Error("Room authorization missing");
            const known = [
                ...new Set([
                    ...this.seeds,
                    ...this.servers.map((server) => server.id),
                ]),
            ];
            let route:
                | { ownership: Ownership | null; servers: Server[] }
                | undefined;
            const failure = this.failure;
            if (failure && this.sessionToken && this.roomId) {
                const ownerDepth =
                    this.servers.find((server) => server.id === failure.owner)
                        ?.depth ?? -1;
                for (const server of [...this.servers]
                    .sort((a, b) => a.depth - b.depth)
                    .filter((server) => server.depth > ownerDepth)) {
                    try {
                        const response = await fetch(
                            `${server.id}/cluster/report`,
                            {
                                method: "POST",
                                redirect: "manual",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    roomId: this.roomId,
                                    jwtToken: this.token,
                                    sessionToken: this.sessionToken,
                                    owner: failure.owner,
                                    revision: failure.revision,
                                    failure: true,
                                }),
                                signal: AbortSignal.timeout(6000),
                            },
                        );
                        if (response.ok) {
                            route = await response.json();
                            this.servers = route!.servers;
                            this.failure = undefined;
                            break;
                        }
                    } catch {
                        /* An uncertain confirmation pauses; try another lower voter. */
                    }
                }
            }
            if (!route && known.length) {
                // Routing reads are non-mutating: try the known endpoints in
                // parallel instead of waiting 6s for each offline tier.
                // Election/report RPCs remain sequential to avoid racing two
                // ownership promotions.
                const controllers = known.map(() => new AbortController());
                try {
                    route = await Promise.any(
                        known.map(async (seed, index) => {
                            const endpoint = new URL(seed);
                            endpoint.pathname = "/cluster/route";
                            const timeout = setTimeout(
                                () => controllers[index].abort(), 6000,
                            );
                            try {
                                const response = await fetch(endpoint, {
                                    method: "POST",
                                    redirect: "manual",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ jwtToken: this.token }),
                                    signal: controllers[index].signal,
                                });
                                if (!response.ok)
                                    throw new Error("Routing endpoint unavailable");
                                const value = await response.json();
                                if (!Array.isArray(value.servers) ||
                                    !value.servers.every((server: Server) => {
                                        try {
                                            const url = new URL(server.id);
                                            return url.origin === server.id &&
                                                (url.protocol === "https:" ||
                                                    ["localhost", "127.0.0.1"].includes(url.hostname));
                                        } catch {
                                            return false;
                                        }
                                    }))
                                    throw new Error("Invalid routing response");
                                return value as {
                                    ownership: Ownership | null;
                                    servers: Server[];
                                };
                            } finally {
                                clearTimeout(timeout);
                            }
                        }),
                    );
                    this.servers = route.servers;
                } catch {
                    // All known nodes failed. The regular retry path will run.
                } finally {
                    controllers.forEach((controller) => controller.abort());
                }
            }
            if (attempt !== this.attempt || this.stopped) return this;
            if (!route) throw new Error("Authoritative routing unavailable");
            const own = route.ownership;
            const ordered = [...route.servers].sort(
                (a, b) => a.depth - b.depth,
            );
            if (own) {
                this.roomId = own.roomId;
                this.routedRevision = own.revision;
            }
            // After a certified tombstone only the configured primary may
            // create a new room instance. Trying a standby first produces a
            // misleading room/auth error and cannot succeed safely.
            const candidates =
                !own || own.lifecycle === "DELETED"
                    ? ordered.filter((server) => server.depth === 0)
                    : ordered.filter((server) => server.id === own.owner);
            for (const server of candidates) {
                if (attempt !== this.attempt || this.stopped) return this;
                const url =
                    server.transport === "websocket"
                        ? `${server.id}/ws`
                        : server.id;
                const socket = this.open(url);
                const ready = await new Promise<boolean>((resolve) => {
                    const timer = setTimeout(() => resolve(false), 1200);
                    socket.on("auth:request", () => {
                        clearTimeout(timer);
                        resolve(true);
                    });
                    socket.on("connect_error", () => {
                        clearTimeout(timer);
                        resolve(false);
                    });
                });
                if (!ready || attempt !== this.attempt || this.stopped) {
                    socket.disconnect();
                    if (own && server.id === own.owner)
                        this.failure = {
                            owner: own.owner,
                            revision: own.revision,
                        };
                    continue;
                }
                this.transport?.disconnect();
                this.transport = socket;
                this.currentOwner = server.id;
                let authenticating = true;
                this.id = socket.id;
                this.connected = true;
                this.lastReply = performance.now();
                const active = () =>
                    this.transport === socket &&
                    attempt === this.attempt &&
                    !this.stopped;
                socket.on("disconnect", () => {
                    if (active()) this.recover();
                });
                socket.on("error", (error) => {
                    if (active()) {
                        this.dispatch("error", error);
                        this.recover();
                    }
                });
                socket.on("auth:session", (value) => {
                    if (active()) {
                        this.recoveryFailures = 0;
                        authenticating = false;
                        this.lastReply = performance.now();
                        this.playerId = value.id;
                        this.dispatch("auth:session", value);
                    }
                });
                socket.on("command:ack", ({ id, status }) => {
                    if (!active()) return;
                    if (status === "accepted" || status === "rejected")
                        this.pending.delete(id);
                });
                socket.on("cluster:pong", () => {
                    if (active()) this.lastReply = performance.now();
                });
                socket.on("cluster:paused", () => {
                    if (active()) this.recover();
                });
                socket.on("room:broadcast", (room) => {
                    if (!active()) return;
                    const previous = this.meta;
                    if (
                        previous &&
                        previous.roomInstanceId === room.roomInstanceId &&
                        (room.epoch < previous.epoch ||
                            (room.epoch === previous.epoch &&
                                room.revision < previous.revision))
                    )
                        return;
                    this.lastReply = performance.now();
                    if (
                        this.meta &&
                        this.meta.roomInstanceId !== room.roomInstanceId
                    )
                        this.pending.clear();
                    this.meta = {
                        roomInstanceId: room.roomInstanceId,
                        epoch: room.epoch,
                        revision: room.revision,
                    };
                    this.roomId = room.id;
                    this.currentOwner = room.ownerServerId ?? server.id;
                    this.gameId = room.gameId;
                    const heldBomb = room.bombs?.find(
                        (bomb: { holder: number }) =>
                            room.users[bomb.holder]?.id === this.playerId,
                    );
                    this.turn = heldBomb?.turn;
                    this.bombId = heldBomb?.id;
                    const inRoom = room.users.some(
                        (player: { id: string }) => player.id === this.playerId,
                    );
                    if (inRoom) {
                        this.joinedRoom = true;
                        this.rejoinOnSnapshot = false;
                    }
                    this.dispatch("room:broadcast", room);
                    if (this.rejoinOnSnapshot && !inRoom && !room.isStart) {
                        // The new owner has authenticated us but the old
                        // Socket.IO disconnect already removed our seat.
                        // Drop commands from the previous connection before
                        // sending a fresh idempotent join to the new owner.
                        this.rejoinOnSnapshot = false;
                        this.pending.clear();
                        this.emit("room:join");
                    }
                    if (
                        room.outcome &&
                        !this.deliveredResults.has(room.outcome.gameId)
                    ) {
                        this.deliveredResults.add(room.outcome.gameId);
                        this.dispatch("game:end", room.outcome.data);
                    }
                });
                for (const event of [
                    "typing:input",
                    "hint:updated",
                    "game:quited",
                    "health:pong",
                    "health:database-result",
                ])
                    socket.on(event, (data) => {
                        if (active()) this.dispatch(event, data);
                    });
                socket.on("game:end", (data) => {
                    if (
                        !active() ||
                        !this.gameId ||
                        this.deliveredResults.has(this.gameId)
                    )
                        return;
                    this.deliveredResults.add(this.gameId);
                    this.dispatch("game:end", data);
                });
                clearInterval(this.heartbeat);
                this.heartbeat = setInterval(() => {
                    if (!active()) return;
                    if (!this.foreground()) {
                        this.wasBackgrounded = true;
                        return;
                    }
                    if (this.wasBackgrounded) {
                        // Background tabs can suspend JS timers while Socket.IO
                        // stays connected. Do not treat suspension as a dead owner.
                        this.wasBackgrounded = false;
                        this.lastReply = performance.now();
                        socket.emit("cluster:ping");
                        return;
                    }
                    if (authenticating) {
                        if (performance.now() - this.lastReply > 10000)
                            this.recover();
                        return;
                    }
                    // Background throttling only requests a fresh authority check.
                    // A server-side suffix confirmation is required to change ownership.
                    if (performance.now() - this.lastReply > 1250)
                        this.recover();
                    else {
                        socket.emit("cluster:ping");
                        for (const command of this.pending.values())
                            this.sendCommand(command);
                    }
                }, 500);
                this.dispatch("connect");
                this.dispatch("auth:request");
                return this;
            }
            throw new Error("No reachable room owner");
        } catch {
            if (attempt === this.attempt && !this.stopped) this.recover();
        }
        return this;
    }
    private recover() {
        if (this.stopped || this.retry) return;
        if (
            this.currentOwner &&
            (this.meta || this.routedRevision !== undefined)
        )
            this.failure = {
                owner: this.currentOwner,
                revision: this.meta?.revision ?? this.routedRevision!,
            };
        this.attempt++;
        this.connected = false;
        this.rejoinOnSnapshot = this.joinedRoom;
        clearInterval(this.heartbeat);
        this.transport?.disconnect();
        this.transport = undefined;
        this.dispatch("disconnect");
        // A stale owner can remain advertised until another eligible voter
        // comes online. Avoid hammering every server with repeated auth errors.
        const delay = Math.min(8_000, 500 * 2 ** Math.min(4, this.recoveryFailures++));
        this.retry = setTimeout(() => {
            this.retry = undefined;
            void this.connect();
        }, delay);
    }
    disconnect() {
        this.stopped = true;
        this.joinedRoom = false;
        this.rejoinOnSnapshot = false;
        this.attempt++;
        this.connected = false;
        clearTimeout(this.retry);
        this.retry = undefined;
        clearInterval(this.heartbeat);
        this.transport?.disconnect();
        this.transport = undefined;
        return this;
    }
}
