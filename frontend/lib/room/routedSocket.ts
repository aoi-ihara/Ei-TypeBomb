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
type RecoveryFailure = { code: string; retryable: false; message: string };
class RecoveryStopped extends Error {
    constructor(readonly failure: RecoveryFailure) { super(failure.message); }
}

type Meta = { roomInstanceId: string; epoch: number; revision: number };

export const recoveryRetryDelayMs = (failures: number): number =>
    failures === 0 ? 0 : Math.min(2_000, 250 * 2 ** Math.min(3, failures));

// One diagnostic record per interrupted session. Each duration uses the same
// browser monotonic clock; backend phase durations come from Server-Timing.
type RecoveryDiagnostics = {
    recoveryId: string;
    snapshotBeforeAuth: boolean;
    detectionHeartbeatAgeMs: number;
    fromDepth: number;
    retryWaitMs: number;
    routeMs: number;
    routeCalls: number;
    reportMs: number;
    reportCalls: number;
    serverReadMs: number;
    serverProbeMs: number;
    serverPromoteMs: number;
    serverResumeMs: number;
    serverAuthMs: number;
    serverTotalMs: number;
    serverResumeReadMs: number;
    serverResumeOpenMs: number;
    socketHandshakeMs: number;
    socketCalls: number;
    authenticationMs: number;
    snapshotAfterAuthMs: number;
    migrationWaitMs: number;
    toDepth: number;
};
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
    private recoveryStartedAt?: number;
    private recoveryDiagnostics?: RecoveryDiagnostics;
    private firstMigrationSnapshotAt?: number;
    private wasBackgrounded = false;
    private heartbeat?: ReturnType<typeof setInterval>;
    private lastReply = 0;
    private meta?: Meta;
    private token?: string;
    private sessionToken?: string;
    private roomId?: string;
    private currentOwner?: string;
    private routedRevision?: number;
    private routedInstance?: string;
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
    // Explicit leave is a user intent, not a fenced gameplay command. Hold it
    // across failover so stale snapshots and unacknowledged commands cannot
    // silently undo it.
    private leaveRequested = false;
    private leaveRequestId?: string;
    private authenticatedTransport?: Transport;
    private leaveSentTo?: Transport;
    private pageExitSent = false;
    private readonly pageHidden = () => this.closePage();
    constructor(
        private readonly seeds: string[],
        private readonly open: (url: string) => Transport,
        private readonly getToken: () => Promise<string | undefined>,
        private readonly foreground = () =>
            document.visibilityState !== "hidden",
        private readonly getSession?: () => Promise<string | undefined>,
    ) {
        if (typeof window !== "undefined") {
            window.addEventListener("pagehide", this.pageHidden);
            window.addEventListener("beforeunload", this.pageHidden);
        }
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
    private recordServerTiming(header: string | null) {
        if (!this.recoveryDiagnostics || !header) return;
        const keys: Record<string, Exclude<keyof RecoveryDiagnostics,
            "recoveryId" | "snapshotBeforeAuth">> = {
            read: "serverReadMs",
            ownerProbe: "serverProbeMs",
            promote: "serverPromoteMs",
            resume: "serverResumeMs",
            auth: "serverAuthMs",
            total: "serverTotalMs",
            resumeRead: "serverResumeReadMs",
            resumeOpen: "serverResumeOpenMs",
        };
        for (const part of header.split(",")) {
            const match = /^\s*([a-zA-Z]+);dur=([0-9.]+)\s*$/.exec(part);
            if (!match || !keys[match[1]]) continue;
            const duration = Number(match[2]);
            if (Number.isFinite(duration))
                // All report calls are accumulated, including unsuccessful
                // attempts that return a valid Server-Timing header.
                this.recoveryDiagnostics[keys[match[1]]] += duration;
        }
    }
    emit(event: string, data?: unknown) {
        if (event === "room:leave") {
            // Never discard an intentional exit because another game command
            // is waiting for its ACK or the socket is between owners. Both
            // runtimes accept this authenticated, session-bound event directly.
            this.leaveRequested = true;
            this.leaveRequestId ??= crypto.randomUUID();
            this.joinedRoom = false;
            this.rejoinOnSnapshot = false;
            // No old join/start/answer should be replayed after opting out.
            this.pending.clear();
            this.sendLeaveIfAuthenticated();
            return this;
        }
        if (event === "room:join") {
            this.pageExitSent = false;
            this.leaveRequested = false;
            this.leaveRequestId = undefined;
            this.leaveSentTo = undefined;
        }
        if (event === "auth:response") {
            const auth = data as { sessionToken?: string };
            this.sessionToken = auth.sessionToken ?? this.sessionToken;
            this.transport?.emit(event, {
                ...(data as Record<string, unknown>),
                ...((this.meta?.roomInstanceId ?? this.routedInstance)
                    ? { expectedInstance: this.meta?.roomInstanceId ?? this.routedInstance } : {}),
            });
            return this;
        }
        if (
            ["room:join", "room:leave", "game:start", "word:success"].includes(event)
        ) {
            // A correct answer can be completed exactly as the transport
            // closes. Retain its stable ID, game, turn and bomb until the
            // next authenticated snapshot; the authority will validate it.
            if (!this.meta || this.pending.size ||
                (!this.connected && event !== "word:success")) return this;
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
            if (this.connected) this.sendCommand(command);
            return this;
        }
        this.transport?.emit(event, data);
        return this;
    }
    private sendLeaveIfAuthenticated() {
        const socket = this.transport;
        if (!this.leaveRequested || !this.leaveRequestId || !socket ||
            this.authenticatedTransport !== socket ||
            this.leaveSentTo === socket) return;
        this.leaveSentTo = socket;
        socket.emit("room:leave", { requestId: this.leaveRequestId });
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
            let terminalReport: RecoveryFailure | undefined;
            if (failure && this.sessionToken && this.roomId) {
                const ownerDepth =
                    this.servers.find((server) => server.id === failure.owner)
                        ?.depth ?? -1;
                for (const server of [...this.servers]
                    .sort((a, b) => a.depth - b.depth)
                    .filter((server) => server.depth > ownerDepth)) {
                    const reportStartedAt = performance.now();
                    if (this.recoveryDiagnostics) this.recoveryDiagnostics.reportCalls++;
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
                        this.recordServerTiming(response.headers.get("Server-Timing"));
                        if (response.status === 409) {
                            const problem = await response.json();
                            if (problem.retryable === false && typeof problem.code === "string")
                                terminalReport = problem;
                        }
                        if (response.ok) {
                            route = await response.json();
                            this.servers = route!.servers;
                            this.failure = undefined;
                            break;
                        }
                    } catch {
                        /* An uncertain confirmation pauses; try another lower voter. */
                    } finally {
                        if (this.recoveryDiagnostics)
                            this.recoveryDiagnostics.reportMs +=
                                performance.now() - reportStartedAt;
                    }
                }
                if (!route && terminalReport) throw new RecoveryStopped(terminalReport);
            }
            if (!route && known.length) {
                // Routing reads are non-mutating: try the known endpoints in
                // parallel instead of waiting 6s for each offline tier.
                // Election/report RPCs remain sequential to avoid racing two
                // ownership promotions.
                const controllers = known.map(() => new AbortController());
                const routeStartedAt = performance.now();
                try {
                    route = await Promise.any(
                        known.map(async (seed, index) => {
                            const endpoint = new URL(seed);
                            endpoint.pathname = "/cluster/route";
                            const timeout = setTimeout(
                                () => controllers[index].abort(), 6000,
                            );
                            try {
                                // Each seed initiates its own parallel HTTP request.
                                // The batch's elapsed time is measured separately.
                                if (this.recoveryDiagnostics)
                                    this.recoveryDiagnostics.routeCalls++;
                                const response = await fetch(endpoint, {
                                    method: "POST",
                                    redirect: "manual",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ jwtToken: this.token,
                                        expectedInstance: this.meta?.roomInstanceId ?? this.routedInstance }),
                                    signal: controllers[index].signal,
                                });
                                if (response.status === 409) {
                                    const problem = await response.json();
                                    if (problem.retryable === false && typeof problem.code === "string")
                                        terminalReport = problem;
                                }
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
                    if (this.recoveryDiagnostics)
                        this.recoveryDiagnostics.routeMs +=
                            performance.now() - routeStartedAt;
                    controllers.forEach((controller) => controller.abort());
                }
            }
            if (attempt !== this.attempt || this.stopped) return this;
            if (!route && terminalReport) throw new RecoveryStopped(terminalReport);
            if (!route) throw new Error("Authoritative routing unavailable");
            const own = route.ownership;
            const ordered = [...route.servers].sort(
                (a, b) => a.depth - b.depth,
            );
            if (own?.lifecycle === "DELETED") {
                // The certified tombstone ends the old incarnation. A new
                // page must not demand its retired checkpoint from a fresh tier.
                this.meta = undefined;
                this.routedInstance = undefined;
                this.routedRevision = undefined;
                this.failure = undefined;
                this.pending.clear();
                this.joinedRoom = false;
                this.rejoinOnSnapshot = false;
            } else if (own) {
                this.roomId = own.roomId;
                this.routedRevision = own.revision;
                this.routedInstance = own.instance;
            }
            // Try certified tiers in priority order for fresh/deleted rooms.
            // A reachable backup can initialize its own signed cohort when
            // higher tiers are unavailable.
            const candidates =
                !own || own.lifecycle === "DELETED"
                    ? ordered
                    : ordered.filter((server) => server.id === own.owner);
            for (const server of candidates) {
                if (attempt !== this.attempt || this.stopped) return this;
                const url =
                    server.transport === "websocket"
                        ? `${server.id}/ws`
                        : server.id;
                const handshakeStartedAt = performance.now();
                if (this.recoveryDiagnostics) this.recoveryDiagnostics.socketCalls++;
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
                if (this.recoveryDiagnostics)
                    this.recoveryDiagnostics.socketHandshakeMs +=
                        performance.now() - handshakeStartedAt;
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
                this.authenticatedTransport = undefined;
                this.currentOwner = server.id;
                let authenticating = true;
                const authStartedAt = performance.now();
                let authenticatedAt: number | undefined;
                let readySnapshotBeforeAuthAt: number | undefined;
                this.id = socket.id;
                this.connected = true;
                this.lastReply = performance.now();
                const active = () =>
                    this.transport === socket &&
                    attempt === this.attempt &&
                    !this.stopped;
                const finishRecovery = (
                    finishedAt: number,
                    snapshotBeforeAuth: boolean,
                ) => {
                    // In distributed Node, game.connect() can broadcast a room
                    // snapshot before the server emits auth:session. Both are
                    // needed for a valid, measured recovery.
                    if (this.recoveryStartedAt === undefined ||
                        authenticatedAt === undefined) return;
                    const metrics = this.recoveryDiagnostics;
                    if (metrics) {
                        metrics.toDepth = server.depth;
                        metrics.snapshotBeforeAuth = snapshotBeforeAuth;
                        metrics.snapshotAfterAuthMs += snapshotBeforeAuth
                            ? 0
                            : Math.max(0, finishedAt - authenticatedAt);
                        if (this.firstMigrationSnapshotAt !== undefined)
                            // Stop the migration phase at the playable
                            // snapshot, not at a later auth:session event.
                            // Both signals still gate overall recovery.
                            metrics.migrationWaitMs += Math.max(0,
                                (snapshotBeforeAuth
                                    ? readySnapshotBeforeAuthAt ?? finishedAt
                                    : finishedAt) -
                                this.firstMigrationSnapshotAt);
                    }
                    this.dispatch("cluster:recovered", {
                        snapshotRecoveryMs: Math.round(
                            finishedAt - this.recoveryStartedAt,
                        ),
                        ...(metrics ?? {}),
                    });
                    this.recoveryStartedAt = undefined;
                    this.recoveryDiagnostics = undefined;
                    this.firstMigrationSnapshotAt = undefined;
                };
                socket.on("disconnect", () => {
                    if (active()) this.recover();
                });
                socket.on("error", (error) => {
                    if (active()) {
                        const hasLowerTier = this.servers.some((peer) => peer.depth > server.depth);
                        if (error?.retryable === false && !hasLowerTier)
                            this.stopRecovery(error);
                        else {
                            this.dispatch("error", error);
                            this.recover();
                        }
                    }
                });
                socket.on("auth:session", (value) => {
                    if (active()) {
                        authenticating = false;
                        this.lastReply = performance.now();
                        authenticatedAt = this.lastReply;
                        if (this.recoveryDiagnostics)
                            this.recoveryDiagnostics.authenticationMs +=
                                this.lastReply - authStartedAt;
                        this.playerId = value.id;
                        this.authenticatedTransport = socket;
                        this.dispatch("auth:session", value);
                        this.sendLeaveIfAuthenticated();
                        if (readySnapshotBeforeAuthAt !== undefined)
                            finishRecovery(this.lastReply, true);
                    }
                });
                socket.on("room:leave:ack", (message: unknown) => {
                    if (!active() || !this.leaveRequested ||
                        this.leaveSentTo !== socket ||
                        !message || typeof message !== "object" ||
                        !("requestId" in message) ||
                        message.requestId !== this.leaveRequestId)
                        return;
                    // The owner has committed the explicit leave. Never
                    // retransmit it after the next successful authentication.
                    // Snapshot absence alone is not proof: old or reordered
                    // broadcasts may precede the commit.
                    this.leaveRequested = false;
                    this.leaveRequestId = undefined;
                    this.leaveSentTo = undefined;
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
                    if (!room.migrating) this.recoveryFailures = 0;
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
                    if (inRoom && !this.leaveRequested) {
                        this.joinedRoom = true;
                        this.rejoinOnSnapshot = false;
                    }
                    this.dispatch("room:broadcast", room);
                    if (this.recoveryStartedAt !== undefined && room.migrating &&
                        this.firstMigrationSnapshotAt === undefined)
                        this.firstMigrationSnapshotAt = performance.now();
                    if (this.recoveryStartedAt !== undefined &&
                        !room.migrating &&
                        (!this.joinedRoom || inRoom)) {
                        if (authenticatedAt === undefined)
                            readySnapshotBeforeAuthAt = performance.now();
                        else finishRecovery(performance.now(), false);
                    }
                    if (this.rejoinOnSnapshot && !this.leaveRequested &&
                        !inRoom && !room.isStart) {
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
        } catch (error) {
            if (attempt === this.attempt && !this.stopped) {
                if (error instanceof RecoveryStopped) this.stopRecovery(error.failure);
                else this.recover();
            }
        }
        return this;
    }
    private stopRecovery(problem: RecoveryFailure) {
        this.stopped = true;
        this.attempt++;
        this.connected = false;
        clearTimeout(this.retry);
        this.retry = undefined;
        clearInterval(this.heartbeat);
        this.transport?.disconnect();
        this.transport = undefined;
        this.dispatch("disconnect");
        this.dispatch("cluster:recovery-failed", problem);
        this.dispatch("error", problem);
    }
    private recover() {
        if (this.stopped || this.retry) return;
        if (this.recoveryFailures >= 60) {
            this.stopRecovery({ code: "RECOVERY_TIMEOUT", retryable: false,
                message: "接続先の復旧を確認できないため自動再試行を停止しました。サーバーの状態を確認してから再接続してください。" });
            return;
        }
        if ((this.meta || this.joinedRoom) &&
            this.recoveryStartedAt === undefined) {
            this.recoveryStartedAt = performance.now();
            this.recoveryDiagnostics = {
                recoveryId: crypto.randomUUID(),
                snapshotBeforeAuth: false,
                detectionHeartbeatAgeMs: Math.round(
                    Math.max(0, performance.now() - this.lastReply),
                ),
                fromDepth: this.servers.find(
                    (item) => item.id === this.currentOwner,
                )?.depth ?? -1,
                retryWaitMs: 0,
                routeMs: 0,
                routeCalls: 0,
                reportMs: 0,
                reportCalls: 0,
                serverReadMs: 0,
                serverProbeMs: 0,
                serverPromoteMs: 0,
                serverResumeMs: 0,
                serverAuthMs: 0,
                serverTotalMs: 0,
                serverResumeReadMs: 0,
                serverResumeOpenMs: 0,
                socketHandshakeMs: 0,
                socketCalls: 0,
                authenticationMs: 0,
                snapshotAfterAuthMs: 0,
                migrationWaitMs: 0,
                toDepth: -1,
            };
            this.dispatch("cluster:recovery-started", {
                recoveryId: this.recoveryDiagnostics.recoveryId,
                fromDepth: this.recoveryDiagnostics.fromDepth,
                detectionHeartbeatAgeMs:
                    this.recoveryDiagnostics.detectionHeartbeatAgeMs,
            });
        }
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
        this.rejoinOnSnapshot = this.joinedRoom && !this.leaveRequested;
        clearInterval(this.heartbeat);
        this.authenticatedTransport = undefined;
        this.transport?.disconnect();
        this.transport = undefined;
        this.dispatch("disconnect");
        // A stale owner can remain advertised until another eligible voter
        // comes online. Avoid hammering every server with repeated auth errors.
        // A recovered server must not remain invisible behind an 8s backoff.
        // Bound retries without spinning when every endpoint is unavailable.
        // The first confirmation begins immediately: an unconditional 250ms
        // sleep adds latency after every detected failure. Repeated failures
        // still use exponential backoff to avoid hammering offline hosts.
        const delay = recoveryRetryDelayMs(this.recoveryFailures++);
        const waitingSince = performance.now();
        this.retry = setTimeout(() => {
            if (this.recoveryDiagnostics)
                this.recoveryDiagnostics.retryWaitMs +=
                    performance.now() - waitingSince;
            this.retry = undefined;
            void this.connect();
        }, delay);
    }
    /** A page exit is intentional; a lost transport still keeps its recovery grace. */
    closePage() {
        if (this.pageExitSent) return this;
        this.pageExitSent = true;
        this.emit("room:leave");
        const instance = this.meta?.roomInstanceId;
        const connectionId = this.transport?.id ?? this.id;
        if (this.currentOwner && this.token && this.sessionToken && instance && connectionId) {
            const endpoint = new URL("/cluster/leave", this.currentOwner);
            const body = JSON.stringify({ jwtToken: this.token, sessionToken: this.sessionToken,
                expectedInstance: instance, connectionId });
            // A normal WebSocket emit can be lost as the browser destroys the
            // page. Beacon survives teardown; text/plain avoids a CORS preflight.
            let queued = false;
            try { queued = typeof navigator !== "undefined" &&
                typeof navigator.sendBeacon === "function" && navigator.sendBeacon(endpoint, body); }
            catch { /* Keepalive is the fallback when beacon cannot be queued. */ }
            if (!queued) void fetch(endpoint, { method: "POST", body, keepalive: true,
                headers: { "Content-Type": "text/plain;charset=UTF-8" }, redirect: "error" }).catch(() => {});
        }
        return this;
    }
    disconnect() {
        if (typeof window !== "undefined") {
            window.removeEventListener("pagehide", this.pageHidden);
            window.removeEventListener("beforeunload", this.pageHidden);
        }
        this.stopped = true;
        this.joinedRoom = false;
        this.rejoinOnSnapshot = false;
        this.leaveRequested = false;
        this.leaveRequestId = undefined;
        this.leaveSentTo = undefined;
        this.authenticatedTransport = undefined;
        this.recoveryStartedAt = undefined;
        this.recoveryDiagnostics = undefined;
        this.firstMigrationSnapshotAt = undefined;
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
