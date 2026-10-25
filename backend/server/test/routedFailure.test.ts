import assert from "node:assert/strict";
import test from "node:test";
import { RoutedSocket, recoveryRetryDelayMs } from "../../../frontend/lib/room/routedSocket";

for (const beaconResult of [true, false, "throw"] as const) {
    test(`page exit uses the connected endpoint with a friendly owner ID (beacon ${beaconResult})`, async () => {
        const originalFetch = globalThis.fetch;
        const originalBeacon = Object.getOwnPropertyDescriptor(navigator, "sendBeacon");
        const endpoint = "https://owner.test";
        const beacons: Array<{ url: string; body: unknown }> = [];
        const requests: Array<{ url: string; options?: RequestInit }> = [];
        Object.defineProperty(navigator, "sendBeacon", {
            configurable: true,
            value: (url: URL, body: unknown) => {
                beacons.push({ url: String(url), body });
                if (beaconResult === "throw") throw new Error("Beacon unavailable");
                return beaconResult;
            },
        });
        globalThis.fetch = (async (url, options) => {
            if (String(url).endsWith("/cluster/leave")) {
                requests.push({ url: String(url), options });
                return new Response(null, { status: 204 });
            }
            return Response.json({ ownership: null, servers: [
                { id: endpoint, depth: 0, transport: "socket.io" },
            ] });
        }) as typeof fetch;
        let publish!: () => void;
        const socket = new RoutedSocket([endpoint], () => {
            const handlers = new Map<string, (value?: unknown) => void>();
            publish = () => {
                handlers.get("auth:session")?.({ id: "player" });
                handlers.get("room:broadcast")?.({
                    id: "room", ownerServerId: "primary", roomInstanceId: "instance",
                    epoch: 1, revision: 1, users: [], bombs: [], isStart: false,
                });
            };
            setTimeout(() => handlers.get("auth:request")?.(), 0);
            return {
                id: "connection", connected: true,
                on(event, listener) { handlers.set(event, listener); return this; },
                emit() {},
                disconnect() {},
            };
        }, async () => "room-jwt", () => true, async () => "session-jwt");
        try {
            // connect() completes after the transport's auth:request handshake.
            await new Promise<void>((resolve) => socket.once("connect", resolve));
            publish();
            assert.doesNotThrow(() => socket.closePage());
            const body = JSON.stringify({
                jwtToken: "room-jwt", sessionToken: "session-jwt",
                expectedInstance: "instance", connectionId: "connection",
            });
            assert.deepEqual(beacons, [{ url: `${endpoint}/cluster/leave`, body }]);
            assert.equal(requests.length, beaconResult === true ? 0 : 1);
            if (requests.length) {
                assert.equal(requests[0].url, `${endpoint}/cluster/leave`);
                assert.equal(requests[0].options?.keepalive, true);
                assert.equal(requests[0].options?.body, body);
            }
            socket.closePage();
            assert.equal(beacons.length, 1, "duplicate page-exit events send once");
        } finally {
            socket.disconnect();
            globalThis.fetch = originalFetch;
            if (originalBeacon) Object.defineProperty(navigator, "sendBeacon", originalBeacon);
            else Reflect.deleteProperty(navigator, "sendBeacon");
        }
    });
}

test("delayed snapshots cannot replace a newer room incarnation or revision", async () => {
    const original = globalThis.fetch;
    const owner = "https://owner.test";
    const backup = "https://backup.test";
    const servers = [{ id: owner, depth: 0, transport: "socket.io" },
        { id: backup, depth: 1, transport: "socket.io" }];
    globalThis.fetch = (async () => Response.json({ ownership: null,
        servers })) as typeof fetch;
    const handlers = new Map<string, ((value?: any) => void)[]>();
    const push = (event: string, value?: any) => handlers.get(event)?.forEach(fn => fn(value));
    const current = { id: "room", roomInstanceId: "new", ownerServerId: owner,
        epoch: 4, revision: 10, users: [], bombs: [], isStart: false };
    const broadcasts: any[] = [];
    const opened: string[] = [];
    const routed = new RoutedSocket([owner, backup], target => {
        opened.push(target);
        const socket = {
            connected: true,
            on(event: string, fn: (value?: any) => void) { handlers.set(event, [...(handlers.get(event) ?? []), fn]); return this; },
            emit(event: string) {
                if (event === "auth:response") {
                    push("auth:session", { id: "a" });
                    push("room:broadcast", target === backup
                        ? { ...current, roomInstanceId: "next", epoch: 5, revision: 2, ownerServerId: backup }
                        : current);
                }
                if (event === "cluster:ping") push("cluster:pong");
            },
            disconnect() { this.connected = false; },
        };
        setTimeout(() => push("auth:request"), 0);
        return socket;
    }, async () => "jwt", () => true);
    routed.on("auth:request", () => routed.emit("auth:response", { jwtToken: "jwt" }));
    routed.on("room:broadcast", value => broadcasts.push(value));
    try {
        for (let attempt = 0; attempt < 100 && !broadcasts.length; attempt++)
            await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(broadcasts.length, 1);
        push("room:broadcast", { ...current, epoch: 3, revision: 100 });
        push("room:broadcast", { ...current, roomInstanceId: "old", epoch: 2, revision: 200 });
        push("room:broadcast", { ...current, roomInstanceId: "conflicting", revision: 999 });
        push("room:broadcast", { ...current, revision: 9 });
        assert.equal(broadcasts.length, 1, "no stale or conflicting snapshot is exposed");
        push("room:broadcast", { ...current, revision: 11 });
        assert.equal(broadcasts.at(-1).revision, 11);
        push("room:broadcast", { ...current, roomInstanceId: "next", epoch: 5, revision: 1 });
        assert.equal(broadcasts.at(-1).roomInstanceId, "next");
        // A fast stale route/tombstone must not clear the client fence and
        // make it authenticate to a retired owner before the other read wins.
        globalThis.fetch = (async (url: string) => Response.json({ servers, ownership:
            String(url).startsWith(owner) ? { owner, epoch: 2, revision: 100,
                instance: "old", lifecycle: "DELETED", roomId: "room" }
                : { owner: backup, epoch: 5, revision: 2,
                    instance: "next", lifecycle: "ACTIVE", roomId: "room" },
        })) as typeof fetch;
        await routed.connect();
        assert.equal(opened.at(-1), backup, "stale routing cannot reset the snapshot version fence");
    } finally { routed.disconnect(); globalThis.fetch = original; }
});

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

test("a DELETED route followed by VOTER_STATE_LOST retries at a lower tier", async () => {
    const originalFetch = globalThis.fetch;
    const ids = [
        "https://primary.test",
        "https://worker.test",
        "https://render.test",
    ];
    const servers = ids.map((id, depth) => ({
        id,
        depth,
        transport: depth === 1 ? "websocket" as const : "socket.io" as const,
    }));
    const tombstone = {
        owner: ids[1],
        epoch: 38,
        revision: 6,
        instance: "retired-instance",
        lifecycle: "DELETED",
        roomId: "room",
    };
    const staleActive = {
        owner: ids[0],
        epoch: 7,
        revision: 4,
        instance: "old-active-instance",
        lifecycle: "ACTIVE",
        roomId: "room",
    };
    const recovered = {
        owner: ids[1],
        epoch: 39,
        revision: 0,
        instance: "recovered-instance",
        lifecycle: "ACTIVE",
        roomId: "room",
    };
    let workerRouteCalls = 0;
    let reportCalls = 0;
    const opened: string[] = [];
    const authenticatedOwners: string[] = [];
    globalThis.fetch = (async (url: string | URL, options?: RequestInit) => {
        const target = String(url);
        if (target.endsWith("/cluster/route")) {
            if (target.startsWith(ids[0]))
                throw new TypeError("Simulated CORS preflight failure");
            if (target.startsWith(ids[1])) {
                workerRouteCalls++;
                return Response.json({
                    ownership: workerRouteCalls === 1 ? tombstone : staleActive,
                    servers,
                });
            }
            return new Promise<Response>((resolve, reject) => {
                const timer = setTimeout(
                    () => resolve(Response.json({ ownership: tombstone, servers })),
                    30,
                );
                options?.signal?.addEventListener(
                    "abort",
                    () => {
                        clearTimeout(timer);
                        reject(new DOMException("Aborted", "AbortError"));
                    },
                    { once: true },
                );
            });
        }
        if (target.endsWith("/cluster/report")) {
            reportCalls++;
            return Response.json({ code: "UNEXPECTED_REPORT", retryable: false }, { status: 409 });
        }
        throw new Error("Unexpected request: " + target);
    }) as typeof fetch;

    const socket = new RoutedSocket(
        ids,
        (url) => {
            opened.push(url);
            const handlers = new Map<string, Array<(value?: any) => void>>();
            const dispatch = (event: string, value?: any) =>
                handlers.get(event)?.forEach((listener) => listener(value));
            const transport = {
                id: "socket-" + opened.length,
                connected: true,
                on(event: string, listener: (value?: any) => void) {
                    handlers.set(event, [...(handlers.get(event) ?? []), listener]);
                    return transport;
                },
                emit(event: string) {
                    if (event === "auth:response") {
                        if (url === ids[0]) {
                            setTimeout(
                                () => dispatch("error", {
                                    code: "VOTER_STATE_LOST",
                                    retryable: false,
                                    message: "lost voter state",
                                }),
                                0,
                            );
                        } else if (url === ids[1] + "/ws") {
                            authenticatedOwners.push(url);
                            dispatch("auth:session", { id: "player" });
                            dispatch("room:broadcast", {
                                id: "room",
                                ownerServerId: ids[1],
                                roomInstanceId: recovered.instance,
                                epoch: recovered.epoch,
                                revision: 0,
                                users: [],
                                bombs: [],
                                isStart: false,
                                migrating: false,
                            });
                        }
                    }
                    if (event === "cluster:ping") dispatch("cluster:pong");
                    return transport;
                },
                disconnect() {
                    transport.connected = false;
                },
            };
            setTimeout(() => dispatch("auth:request"), 0);
            return transport;
        },
        async () => "room-jwt",
        () => true,
        async () => "session-jwt",
    );
    socket.on("auth:request", () =>
        socket.emit("auth:response", {
            jwtToken: "room-jwt",
            sessionToken: "session-jwt",
        }),
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const waitForRecovery = async () => {
        const deadline = Date.now() + 4_000;
        while (
            !authenticatedOwners.includes(ids[1] + "/ws") ||
            !socket.connected
        ) {
            if (Date.now() >= deadline)
                throw new Error("The lower-tier owner was not reached");
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    };
    try {
        await Promise.race([
            waitForRecovery(),
            new Promise((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error("Recovery test timed out")),
                    4_500,
                );
            }),
        ]);
        assert.ok(workerRouteCalls >= 2, "the stale lower-epoch route was retried");
        assert.ok(opened.includes(ids[0]), "the primary should be attempted first");
        assert.ok(opened.includes(ids[1] + "/ws"), "recovery should open the secondary");
        assert.deepEqual(opened.slice(1), [ids[1] + "/ws"]);
        assert.equal(reportCalls, 0, "a DELETED instance should be reopened, not elected via /report");
    } finally {
        clearTimeout(timeout);
        socket.disconnect();
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
                    }
                    dispatch("command:ack", { id: value.id, status: "accepted" });
                    publish();
                }
                if (event === "room:leave") {
                    transport.commands.push("room:leave");
                    users = [];
                    publish();
                    dispatch("room:leave:ack", { requestId: value.requestId });
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
        // A confirmed exit is not retransmitted after reconnecting.
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


test("an explicit leave bypasses a lost game-command ACK and does not rejoin on failover", async () => {
    const originalFetch = globalThis.fetch;
    const url = "https://owner.test";
    const servers = [{ id: url, depth: 0, transport: "socket.io" }];
    const ownership = {
        owner: url, epoch: 1, revision: 4, instance: "instance",
        lifecycle: "ACTIVE", roomId: "room",
    };
    globalThis.fetch = (async () => Response.json({ ownership, servers })) as typeof fetch;
    const sessions: Array<{
        sends: string[];
        close(): void;
        emitSnapshot(): void;
    }> = [];
    const open = () => {
        const listeners = new Map<string, Array<(value?: any) => void>>();
        const dispatch = (event: string, value?: any) =>
            listeners.get(event)?.forEach((fn) => fn(value));
        const snapshot = () => dispatch("room:broadcast", {
            id: "room", roomInstanceId: "instance", ownerServerId: url,
            epoch: 1, revision: 4, isStart: false,
            users: [{ id: "player" }], bombs: [],
        });
        const transport = {
            connected: true,
            sends: [] as string[],
            on(event: string, fn: (value?: any) => void) {
                listeners.set(event, [...(listeners.get(event) ?? []), fn]);
                return transport;
            },
            emit(event: string, value?: any) {
                if (event === "auth:response") {
                    dispatch("auth:session", { id: "player" });
                    snapshot();
                } else if (event === "game:command") {
                    // Deliberately lose the ACK: before the fix a pending
                    // command caused room:leave to be silently ignored.
                    transport.sends.push(value.event.type);
                } else if (event === "room:leave") {
                    transport.sends.push("room:leave");
                } else if (event === "cluster:ping") dispatch("cluster:pong");
            },
            disconnect() { transport.connected = false; },
            close() { transport.connected = false; dispatch("disconnect"); },
            emitSnapshot: snapshot,
        };
        sessions.push(transport);
        setTimeout(() => dispatch("auth:request"), 0);
        return transport;
    };
    const socket = new RoutedSocket([url], open, async () => "jwt", () => true);
    socket.on("auth:request", () => socket.emit("auth:response", { jwtToken: "jwt" }));
    const until = async (predicate: () => boolean) => {
        const deadline = Date.now() + 4_000;
        while (!predicate()) {
            if (Date.now() > deadline) throw new Error("Timed out waiting for reconnect");
            await new Promise((resolve) => setTimeout(resolve, 15));
        }
    };
    try {
        await until(() => sessions.length === 1 && socket.connected);
        sessions[0].emitSnapshot();
        socket.emit("game:start");
        assert.ok(sessions[0].sends.includes("game:start"));
        socket.emit("room:leave");
        assert.ok(sessions[0].sends.includes("room:leave"),
            "The leave must not be blocked by the unacknowledged game:start");
        // Even a stale pre-leave snapshot must not opt us back in.
        sessions[0].emitSnapshot();
        sessions[0].close();
        await until(() => sessions.length >= 2);
        // The newly authenticated owner receives the queued exit exactly once.
        await until(() => sessions[1].sends.includes("room:leave"));
        assert.ok(!sessions[1].sends.includes("room:join"));
        assert.ok(!sessions[1].sends.includes("game:start"),
            "Canceled commands must not replay after leave");
        socket.emit("room:join");
        assert.ok(sessions[1].sends.includes("room:join"),
            "An intentional rejoin must still work after leaving");
    } finally {
        socket.disconnect();
        globalThis.fetch = originalFetch;
    }
});

test("leaving while disconnected defers the exit until the next authenticated socket", async () => {
    const originalFetch = globalThis.fetch;
    const url = "https://owner.test";
    const ownership = {
        owner: url, epoch: 1, revision: 3, instance: "instance",
        lifecycle: "ACTIVE", roomId: "room",
    };
    globalThis.fetch = (async () => Response.json({
        ownership, servers: [{ id: url, depth: 0, transport: "socket.io" }],
    })) as typeof fetch;
    const sessions: Array<{ leaveCount: number; close(): void }> = [];
    const open = () => {
        const handlers = new Map<string, Array<(data?: any) => void>>();
        const dispatch = (event: string, value?: any) =>
            handlers.get(event)?.forEach((cb) => cb(value));
        const transport = {
            connected: true, leaveCount: 0,
            on(event: string, handler: (data?: any) => void) {
                handlers.set(event, [...(handlers.get(event) ?? []), handler]);
                return transport;
            },
            emit(event: string) {
                if (event === "auth:response") {
                    dispatch("auth:session", { id: "player" });
                    dispatch("room:broadcast", {
                        id: "room", roomInstanceId: "instance",
                        ownerServerId: url, epoch: 1, revision: 3,
                        users: [{ id: "player" }], bombs: [], isStart: false,
                    });
                }
                if (event === "room:leave") transport.leaveCount++;
                if (event === "cluster:ping") dispatch("cluster:pong");
            },
            disconnect() { transport.connected = false; },
            close() { transport.connected = false; dispatch("disconnect"); },
        };
        sessions.push(transport);
        setTimeout(() => dispatch("auth:request"), 0);
        return transport;
    };
    const socket = new RoutedSocket([url], open, async () => "jwt", () => true);
    socket.on("auth:request", () => socket.emit("auth:response", { jwtToken: "jwt" }));
    const until = async (predicate: () => boolean) => {
        const deadline = Date.now() + 4_000;
        while (!predicate()) {
            if (Date.now() > deadline) throw new Error("Timed out");
            await new Promise((resolve) => setTimeout(resolve, 15));
        }
    };
    try {
        await until(() => sessions.length === 1 && socket.connected);
        sessions[0].close();
        socket.emit("room:leave");
        assert.equal(sessions[0].leaveCount, 0);
        await until(() => sessions.length >= 2 && sessions[1].leaveCount === 1);
        assert.equal(sessions[1].leaveCount, 1);
    } finally {
        socket.disconnect();
        globalThis.fetch = originalFetch;
    }
});


test("leave confirmation requires the matching authoritative ACK, not a stale absent snapshot", async () => {
    const originalFetch = globalThis.fetch;
    const url = "https://owner.test";
    const owner = {
        owner: url, epoch: 1, revision: 10,
        instance: "instance", lifecycle: "ACTIVE", roomId: "room",
    };
    globalThis.fetch = (async () => Response.json({
        ownership: owner, servers: [{ id: url, depth: 0, transport: "socket.io" }],
    })) as typeof fetch;
    const sessions: Array<{
        leaves: string[];
        push(event: string, value?: any): void;
        close(): void;
    }> = [];
    const open = () => {
        const handlers = new Map<string, Array<(value?: any) => void>>();
        const push = (event: string, value?: any) =>
            handlers.get(event)?.forEach((listener) => listener(value));
        const transport = {
            connected: true,
            leaves: [] as string[],
            push,
            on(event: string, handler: (value?: any) => void) {
                handlers.set(event, [...(handlers.get(event) ?? []), handler]);
                return transport;
            },
            emit(event: string, value?: any) {
                if (event === "auth:response") {
                    push("auth:session", { id: "player" });
                    push("room:broadcast", {
                        id: "room", roomInstanceId: "instance",
                        ownerServerId: url, epoch: 1, revision: 10,
                        users: [{ id: "player" }], bombs: [], isStart: false,
                    });
                }
                if (event === "room:leave")
                    transport.leaves.push(value.requestId);
                if (event === "cluster:ping") push("cluster:pong");
            },
            disconnect() { transport.connected = false; },
            close() { transport.connected = false; push("disconnect"); },
        };
        sessions.push(transport);
        setTimeout(() => push("auth:request"), 0);
        return transport;
    };
    const routed = new RoutedSocket([url], open, async () => "jwt", () => true);
    routed.on("auth:request", () =>
        routed.emit("auth:response", { jwtToken: "jwt" }));
    const until = async (predicate: () => boolean) => {
        const deadline = Date.now() + 4000;
        while (!predicate()) {
            if (Date.now() > deadline) throw new Error("Timed out");
            await new Promise((resolve) => setTimeout(resolve, 15));
        }
    };
    try {
        await until(() => sessions.length === 1 && routed.connected);
        routed.emit("room:leave");
        await until(() => sessions[0].leaves.length === 1);
        const requestId = sessions[0].leaves[0];
        // Not even an absent (but unconfirmed) snapshot should cancel the
        // request: it may have raced an unacknowledged mutation.
        sessions[0].push("room:broadcast", {
            id: "room", roomInstanceId: "instance",
            ownerServerId: url, epoch: 1, revision: 11,
            users: [], bombs: [], isStart: false,
        });
        sessions[0].push("room:leave:ack", { requestId: crypto.randomUUID() });
        sessions[0].close();
        await until(() => sessions.length >= 2 && sessions[1].leaves.length === 1);
        assert.equal(sessions[1].leaves[0], requestId,
            "Unconfirmed intent must use the same ID after failover");
        sessions[1].push("room:leave:ack", { requestId });
        sessions[1].close();
        await until(() => sessions.length >= 3);
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.deepEqual(sessions[2].leaves, [],
            "Confirmed leave must not be sent again");
    } finally {
        routed.disconnect();
        globalThis.fetch = originalFetch;
    }
});

test("classified report failure stops automatic retries and preserves the reason", async () => {
    const original = globalThis.fetch;
    const servers = [
        { id: "https://primary.test", depth: 0, transport: "socket.io" },
        { id: "https://render.test", depth: 2, transport: "socket.io" },
    ];
    const ownership = { owner: servers[0].id, epoch: 1, revision: 3,
        instance: "old", lifecycle: "ACTIVE", roomId: "room" };
    let reports = 0;
    const problem = { code: "VOTER_STATE_LOST", retryable: false,
        message: "以前の投票状態を復旧してください。" };
    globalThis.fetch = (async (url: string) => {
        if (String(url).endsWith("/report")) {
            reports++;
            return Response.json(problem, { status: 409 });
        }
        return Response.json({ ownership, servers });
    }) as typeof fetch;
    const open = () => {
        const listeners = new Map<string, ((data?: any) => void)[]>();
        const socket = {
            connected: true,
            on(event: string, listener: (data?: any) => void) {
                listeners.set(event, [...(listeners.get(event) ?? []), listener]);
                return socket;
            },
            emit(event: string) {
                if (event === "auth:response") setTimeout(() =>
                    listeners.get("error")?.forEach((listener) => listener({ message: "owner offline" })), 0);
            },
            disconnect() { socket.connected = false; },
        };
        setTimeout(() => listeners.get("auth:request")?.forEach((listener) => listener()), 0);
        return socket;
    };
    const socket = new RoutedSocket([servers[0].id], open,
        async () => "room-token", () => true, async () => "session");
    socket.on("auth:request", () => socket.emit("auth:response", { sessionToken: "session" }));
    let failed: unknown;
    socket.on("cluster:recovery-failed", (value) => failed = value);
    try {
        for (let i = 0; i < 100 && !failed; i++)
            await new Promise((resolve) => setTimeout(resolve, 10));
        assert.deepEqual(failed, problem);
        await new Promise((resolve) => setTimeout(resolve, 700));
        assert.equal(reports, 1);
        assert.equal(socket.connected, false);
    } finally {
        socket.disconnect();
        globalThis.fetch = original;
    }
});

test("a certified deleted room does not bind a new page to the retired checkpoint", async () => {
    const originalFetch = globalThis.fetch;
    const primary = "https://primary.test", fallback = "https://render.test";
    const servers = [{ id: primary, depth: 0, transport: "socket.io" },
        { id: fallback, depth: 1, transport: "socket.io" }];
    globalThis.fetch = (async () => Response.json({ servers, ownership: {
        owner: fallback, roomId: "room", instance: "retired-instance", epoch: 5,
        revision: 12, lifecycle: "DELETED",
    } })) as typeof fetch;
    const errors: unknown[] = [];
    let fresh = false;
    const socket = new RoutedSocket([fallback], () => {
        const handlers = new Map<string, ((data?: any) => void)[]>();
        const dispatch = (event: string, data?: any) => handlers.get(event)?.forEach(fn => fn(data));
        const transport = {
            connected: true,
            on(event: string, fn: (data?: any) => void) { handlers.set(event, [...(handlers.get(event) ?? []), fn]); return this; },
            emit(event: string, data?: any) {
                if (event === "auth:response") {
                    if (data.expectedInstance) dispatch("error", { code: "CHECKPOINT_UNAVAILABLE", retryable: false,
                        message: "以前の対戦のチェックポイントを取得できません。" });
                    else {
                        dispatch("auth:session", {id:"new-page"});
                        dispatch("room:broadcast", {id:"room",roomInstanceId:"fresh-instance",epoch:1,revision:1,users:[],bombs:[]});
                    }
                }
                return this;
            },
            disconnect() { this.connected = false; },
        };
        setTimeout(() => dispatch("auth:request"), 0);
        return transport;
    }, async () => "token", () => true, async () => "page-token");
    socket.on("auth:request", () => socket.emit("auth:response", {jwtToken:"token",sessionToken:"page-token"}));
    socket.on("error", error => errors.push(error));
    socket.on("room:broadcast", () => fresh = true);
    try {
        const until = Date.now() + 3000;
        while (!fresh && !errors.length && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
        assert.deepEqual(errors, []);
        assert.equal(fresh, true);
    } finally { socket.disconnect(); globalThis.fetch = originalFetch; }
});
