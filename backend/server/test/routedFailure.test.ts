import assert from "node:assert/strict";
import test from "node:test";
import { RoutedSocket } from "../../../frontend/lib/room/routedSocket";

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
    const open = () => {
        const listeners = new Map<string, Array<(value?: any) => void>>();
        const dispatch = (event: string, value?: any) =>
            listeners.get(event)?.forEach((fn) => fn(value));
        let revision = 0;
        let users: Array<{ id: string }> = [];
        const publish = () => dispatch("room:broadcast", {
            id: "room", ownerServerId: url, roomInstanceId: "instance",
            epoch: 1, revision: ++revision, users, bombs: [], isStart: false,
        });
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
        await waitFor(() => sessions.length === 1 && Boolean(socket.id === undefined || sessions[0].connected));
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
