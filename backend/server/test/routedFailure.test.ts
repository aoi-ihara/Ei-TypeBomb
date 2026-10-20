import assert from "node:assert/strict";
import test from "node:test";
import { RoutedSocket, recoveryRetryDelayMs } from "../../../frontend/lib/room/routedSocket";

test("a first interrupted session starts recovery without a fixed 250ms delay", () => {
    assert.deepEqual([0, 1, 2, 3, 4].map(recoveryRetryDelayMs),
        [0, 500, 1000, 2000, 2000]);
});

test("a reloaded tab reports a failed owner before receiving its first game snapshot", async () => {
    const originalFetch = globalThis.fetch;
    const servers = [
        { id: "https://primary.test", depth: 0, transport: "socket.io" },
        { id: "https://worker.test", depth: 1, transport: "websocket" },
    ];
    const ownership = {
        owner: servers[0].id,
        epoch: 1,
        revision: 17,
        instance: "instance",
        lifecycle: "ACTIVE",
        roomId: "room",
    };
    let reported!: (value: any) => void;
    const report = new Promise<any>((resolve) => {
        reported = resolve;
    });
    globalThis.fetch = (async (url: string, options: RequestInit) => {
        if (String(url).endsWith("/report")) {
            reported(JSON.parse(options.body as string));
            return Response.json({
                ownership: { ...ownership, owner: servers[1].id, epoch: 2 },
                servers,
            });
        }
        return Response.json({ ownership, servers });
    }) as typeof fetch;
    const transports: { connected: boolean; disconnect(): void }[] = [];
    function open(url: string) {
        const listeners = new Map<string, ((data?: any) => void)[]>();
        const transport = {
            connected: true,
            on(event: string, listener: (data?: any) => void) {
                listeners.set(event, [
                    ...(listeners.get(event) ?? []),
                    listener,
                ]);
                return transport;
            },
            emit(event: string) {
                if (event === "auth:response" && url === servers[0].id)
                    setTimeout(
                        () =>
                            listeners
                                .get("error")
                                ?.forEach((fn) =>
                                    fn({ message: "Lost voter memory" }),
                                ),
                        0,
                    );
            },
            disconnect() {
                transport.connected = false;
            },
        };
        transports.push(transport);
        setTimeout(
            () => listeners.get("auth:request")?.forEach((fn) => fn()),
            0,
        );
        return transport;
    }
    const socket = new RoutedSocket(
        [servers[0].id],
        open,
        async () => "room-jwt",
        () => true,
        async () => "same-tab-session-jwt",
    );
    socket.on("auth:request", () =>
        socket.emit("auth:response", {
            jwtToken: "room-jwt",
            sessionToken: "same-tab-session-jwt",
        }),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        const value = await Promise.race([
            report,
            new Promise((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("No failure report after reload")),
                    3000,
                );
            }),
        ]);
        assert.deepEqual(value, {
            roomId: "room",
            jwtToken: "room-jwt",
            sessionToken: "same-tab-session-jwt",
            owner: servers[0].id,
            revision: 17,
            failure: true,
        });
    } finally {
        clearTimeout(timeout);
        socket.disconnect();
        transports.forEach((transport) => transport.disconnect());
        globalThis.fetch = originalFetch;
    }
});

test("routed participant rejoins after a disconnected Socket.IO owner, but a spectator stays out", async () => {
    const originalFetch = globalThis.fetch;
    const url = "https://owner.test";
    const servers = [{ id: url, depth: 0, transport: "socket.io" }];
    const ownership = {
        owner: url, epoch: 1, revision: 0, instance: "instance",
        lifecycle: "ACTIVE", roomId: "room",
    };
    globalThis.fetch = (async () => Response.json({ ownership, servers })) as typeof fetch;
    const sessions: Array<{
        close(): void;
        commands: string[];
    }> = [];
    let socket!: RoutedSocket;
    let connectedPlayers = 0;
    let receivedSnapshots = 0;
    let revision = 0;
    let users: Array<{ id: string }> = [];
    const open = () => {
        const listeners = new Map<string, Array<(value?: any) => void>>();
        const dispatch = (event: string, value?: any) =>
            listeners.get(event)?.forEach((fn) => fn(value));
        const publish = () => {
            receivedSnapshots++;
            dispatch("room:broadcast", {
                id: "room", ownerServerId: url, roomInstanceId: "instance",
                epoch: 1, revision: ++revision, users, bombs: [], isStart: false,
            });
        };
        const transport = {
            connected: true,
            commands: [] as string[],
            on(event: string, fn: (value?: any) => void) {
                listeners.set(event, [...(listeners.get(event) ?? []), fn]);
                return transport;
            },
            emit(event: string, value?: any) {
                if (event === "auth:response") {
                    dispatch("auth:session", { id: "player" });
                    publish();
                }
                if (event === "game:command") {
                    transport.commands.push(value.event.type);
                    if (value.event.type === "room:join") {
                        users = [{ id: "player" }];
                        connectedPlayers++;
                    } else if (value.event.type === "room:leave") {
                        users = [];
                    }
                    dispatch("command:ack", { id: value.id, status: "accepted" });
                    publish();
                }
                if (event === "cluster:ping") dispatch("cluster:pong");
                return transport;
            },
            disconnect() {
                transport.connected = false;
            },
            close() {
                users = [];
                transport.connected = false;
                dispatch("disconnect");
            },
        };
        sessions.push(transport);
        setTimeout(() => dispatch("auth:request"), 0);
        return transport;
    };
    socket = new RoutedSocket([url], open, async () => "token", () => true);
    socket.on("auth:request", () =>
        socket.emit("auth:response", { jwtToken: "token" }));
    const waitFor = async (predicate: () => boolean) => {
        const until = Date.now() + 4000;
        while (!predicate()) {
            if (Date.now() > until) throw new Error("Timed out waiting for routed reconnect");
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    };
    try {
        await waitFor(() => receivedSnapshots > 0);
        // Initial observer snapshot must never trigger a join.
        assert.deepEqual(sessions[0].commands, []);
        socket.emit("room:join");
        assert.deepEqual(sessions[0].commands, ["room:join"]);
        sessions[0].close();
        await waitFor(() => sessions.length >= 2 && sessions[1].commands.includes("room:join"));
        assert.equal(connectedPlayers, 2);
        socket.emit("room:leave");
        assert.ok(sessions[1].commands.includes("room:leave"));
        sessions[1].close();
        await waitFor(() => sessions.length >= 3);
        await new Promise((resolve) => setTimeout(resolve, 50));
        assert.deepEqual(sessions[2].commands, []);
    } finally {
        socket.disconnect();
        globalThis.fetch = originalFetch;
    }
});

test("routing reaches the surviving Render node without waiting for offline predecessors", async () => {
    const originalFetch = globalThis.fetch;
    const ids = [
        "https://primary.test",
        "https://secondary.test",
        "https://render.test",
    ];
    const servers = ids.map((id, depth) => ({ id, depth, transport: "socket.io" }));
    let pending = 0;
    globalThis.fetch = ((url: string, options: RequestInit) => {
        if (String(url).startsWith(ids[2]))
            return Promise.resolve(Response.json({
                ownership: {
                    owner: ids[2], epoch: 3, revision: 2,
                    instance: "instance", lifecycle: "ACTIVE", roomId: "room",
                },
                servers,
            }));
        pending++;
        return new Promise<Response>((_, reject) => {
            options.signal?.addEventListener("abort", () => {
                pending--;
                reject(new Error("Offline node request aborted"));
            }, { once: true });
        });
    }) as typeof fetch;
    let opened = "";
    const open = (url: string) => {
        opened = url;
        const handlers = new Map<string, Array<(value?: any) => void>>();
        const socket = {
            connected: true,
            on(event: string, fn: (value?: any) => void) {
                handlers.set(event, [...(handlers.get(event) ?? []), fn]);
                return socket;
            },
            emit() { return socket; },
            disconnect() { socket.connected = false; },
        };
        setTimeout(() => handlers.get("auth:request")?.forEach((fn) => fn()), 0);
        return socket;
    };
    const start = Date.now();
    const socket = new RoutedSocket(ids, open, async () => "room-jwt", () => true);
    const until = start + 2500;
    try {
        while (opened !== ids[2] && Date.now() < until)
            await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(opened, ids[2]);
        assert.ok(Date.now() - start < 2500, "Routing should not wait for two 6s timeouts");
        assert.equal(pending, 0, "Loser probes should be canceled");
    } finally {
        socket.disconnect();
        globalThis.fetch = originalFetch;
    }
});


test("a successful answer during an outage is replayed with its original turn", async () => {
    const originalFetch = globalThis.fetch;
    const url = "https://owner.test";
    const servers = [{ id: url, depth: 0, transport: "socket.io" }];
    const ownership = {
        owner: url, epoch: 1, revision: 12, instance: "instance",
        lifecycle: "ACTIVE", roomId: "room",
    };
    globalThis.fetch = (async () =>
        Response.json({ ownership, servers })) as typeof fetch;
    const sessions: Array<{ close(): void; commands: any[] }> = [];
    let recoveryMs: number | undefined;
    const open = () => {
        const listeners = new Map<string, Array<(value?: any) => void>>();
        const dispatch = (event: string, value?: any) =>
            listeners.get(event)?.forEach((fn) => fn(value));
        const session = {
            commands: [] as any[],
            on(event: string, fn: (value?: any) => void) {
                listeners.set(event, [...(listeners.get(event) ?? []), fn]);
                return session;
            },
            emit(event: string, value?: any) {
                if (event === "auth:response") {
                    dispatch("auth:session", { id: "player" });
                    dispatch("room:broadcast", {
                        id: "room", ownerServerId: url, roomInstanceId: "instance",
                        epoch: 1, revision: 12, gameId: "game", isStart: true,
                        migrating: false, users: [{ id: "player" }],
                        bombs: [{ id: "bomb", holder: 0, turn: 4 }],
                    });
                }
                if (event === "cluster:ping") dispatch("cluster:pong");
                if (event === "game:command") {
                    session.commands.push(value);
                    dispatch("command:ack", { id: value.id, status: "accepted" });
                }
                return session;
            },
            connected: true,
            disconnect() { session.connected = false; },
            close() { session.connected = false; dispatch("disconnect"); },
        };
        sessions.push(session);
        setTimeout(() => dispatch("auth:request"), 0);
        return session;
    };
    const socket = new RoutedSocket([url], open, async () => "token", () => true);
    socket.on("auth:request", () =>
        socket.emit("auth:response", { jwtToken: "token" }));
    socket.on("cluster:recovered", (value) => {
        recoveryMs = value.snapshotRecoveryMs;
    });
    const waitFor = async (fn: () => boolean) => {
        const deadline = Date.now() + 4_000;
        while (!fn()) {
            if (Date.now() >= deadline) throw new Error("Recovery timed out");
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
    };
    try {
        await waitFor(() => sessions.length === 1 && socket.connected);
        sessions[0].close();
        socket.emit("word:success");
        await waitFor(() => sessions.length >= 2 && sessions[1].commands.length === 1);
        assert.equal(sessions[1].commands[0].event.type, "word:success");
        assert.equal(sessions[1].commands[0].gameId, "game");
        assert.equal(sessions[1].commands[0].bombId, "bomb");
        assert.equal(sessions[1].commands[0].turn, 4);
        assert.equal(typeof recoveryMs, "number");
    } finally {
        socket.disconnect();
        globalThis.fetch = originalFetch;
    }
});


test("recovery records a start and waits for auth when the playable snapshot arrives first", async () => {
    const originalFetch = globalThis.fetch;
    const servers = [
        { id: "https://primary.test", depth: 0, transport: "socket.io" },
        { id: "https://secondary.test", depth: 1, transport: "socket.io" },
    ];
    const makeOwner = (depth: number) => ({
        owner: servers[depth].id,
        epoch: depth + 1,
        revision: 12 + depth,
        instance: "instance",
        lifecycle: "ACTIVE",
        roomId: "room",
    });
    globalThis.fetch = (async (url: string) => {
        if (String(url).endsWith("/cluster/report"))
            return Response.json({ ownership: makeOwner(1), servers });
        return Response.json({ ownership: makeOwner(0), servers });
    }) as typeof fetch;

    type FakeSession = {
        connected: boolean;
        close(): void;
        disconnect(): void;
    };
    const sessions: FakeSession[] = [];
    const open = (url: string) => {
        const handlers = new Map<string, Array<(data?: any) => void>>();
        const dispatch = (event: string, data?: any) =>
            handlers.get(event)?.forEach((handler) => handler(data));
        const snapshot = {
            id: "room",
            roomInstanceId: "instance",
            epoch: url === servers[1].id ? 2 : 1,
            revision: url === servers[1].id ? 13 : 12,
            ownerServerId: url,
            gameId: "game",
            isStart: true,
            migrating: false,
            users: [{ id: "player" }],
            bombs: [],
        };
        const transport = {
            connected: true,
            on(event: string, handler: (data?: any) => void) {
                handlers.set(event, [...(handlers.get(event) ?? []), handler]);
                return transport;
            },
            emit(event: string) {
                if (event === "auth:response") {
                    if (url === servers[1].id) {
                        // Node may publish game.connect's snapshot before
                        // emitting auth:session for the newly joined socket.
                        dispatch("room:broadcast", { ...snapshot, migrating: true });
                        setTimeout(
                            () => dispatch("room:broadcast", snapshot),
                            20,
                        );
                        setTimeout(
                            () => dispatch("auth:session", { id: "player" }),
                            120,
                        );
                    } else {
                        dispatch("auth:session", { id: "player" });
                        dispatch("room:broadcast", snapshot);
                    }
                }
                if (event === "cluster:ping") dispatch("cluster:pong");
                return transport;
            },
            disconnect() { transport.connected = false; },
            close() {
                transport.connected = false;
                dispatch("disconnect");
            },
        };
        sessions.push(transport);
        setTimeout(() => dispatch("auth:request"), 0);
        return transport;
    };

    const socket = new RoutedSocket(
        servers.map((s) => s.id),
        open,
        async () => "room-jwt",
        () => true,
        async () => "session-jwt",
    );
    socket.on("auth:request", () => socket.emit("auth:response", {
        jwtToken: "room-jwt",
        sessionToken: "session-jwt",
    }));
    let started: { recoveryId: string; fromDepth: number } | undefined;
    let completed: {
        recoveryId: string;
        snapshotBeforeAuth: boolean;
        authenticationMs: number;
        migrationWaitMs: number;
        fromDepth: number;
        toDepth: number;
    } | undefined;
    let secondarySnapshotSeen = false;
    socket.on("cluster:recovery-started", (event) => { started = event; });
    socket.on("cluster:recovered", (event) => { completed = event; });
    socket.on("room:broadcast", (room) => {
        if (room.ownerServerId === servers[1].id && !room.migrating)
            secondarySnapshotSeen = true;
    });
    const waitFor = async (check: () => boolean) => {
        const until = Date.now() + 4000;
        while (!check()) {
            if (Date.now() >= until) throw new Error("Recovery timed out");
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    };
    try {
        await waitFor(() => sessions.length === 1 && socket.connected);
        // Initial auth/room snapshot must be processed before testing failover.
        await new Promise((resolve) => setTimeout(resolve, 10));
        sessions[0].close();
        await waitFor(() => secondarySnapshotSeen);
        assert.ok(started, "Recovery start is captured independently of its completion");
        assert.equal(started.fromDepth, 0);
        assert.equal(completed, undefined,
            "A room snapshot cannot end recovery before authentication");
        await waitFor(() => completed !== undefined);
        assert.equal(completed!.recoveryId, started.recoveryId);
        assert.equal(completed!.snapshotBeforeAuth, true);
        assert.equal(completed!.fromDepth, 0);
        assert.equal(completed!.toDepth, 1);
        assert.ok(completed!.authenticationMs >= 100,
            "Authentication time includes the delayed auth:session event");
        assert.ok(completed!.migrationWaitMs >= 0 &&
            completed!.migrationWaitMs < completed!.authenticationMs,
            "Migration wait must end at the ready snapshot before authentication");
    } finally {
        socket.disconnect();
        globalThis.fetch = originalFetch;
    }
});
