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

test("explicit leave is never dropped behind a pending game command", async () => {
    const originalFetch = globalThis.fetch;
    const server = { id: "https://primary.test", depth: 0, transport: "socket.io" };
    const ownership = {
        owner: server.id, epoch: 1, revision: 0, instance: "instance",
        lifecycle: "ACTIVE", roomId: "room",
    };
    globalThis.fetch = (async () => Response.json({
        ownership, servers: [server],
    })) as typeof fetch;
    const listeners = new Map<string, ((value?: any) => void)[]>();
    const commands: any[] = [];
    const notify = (event: string, value?: any) => {
        for (const fn of listeners.get(event) ?? []) fn(value);
    };
    const transport = {
        connected: true,
        on(event: string, listener: (value?: any) => void) {
            listeners.set(event, [...(listeners.get(event) ?? []), listener]);
            return transport;
        },
        emit(event: string, data?: any) {
            if (event === "game:command") commands.push(data);
            if (event === "auth:response") {
                queueMicrotask(() => {
                    notify("auth:session", { id: "player" });
                    notify("room:broadcast", {
                        id: "room", roomInstanceId: "instance", epoch: 1,
                        revision: 0, users: [{ id: "player" }], bombs: [],
                    });
                });
            }
            return transport;
        },
        disconnect() { transport.connected = false; },
    };
    const socket = new RoutedSocket(
        [server.id], () => transport, async () => "jwt", () => true,
    );
    socket.on("auth:request", () =>
        socket.emit("auth:response", { jwtToken: "jwt" }),
    );
    try {
        for (let i = 0; i < 100 && !socket.connected; i++)
            await new Promise((resolve) => setTimeout(resolve, 5));
        for (let i = 0; i < 100 && !commands.length; i++) {
            socket.emit("room:join");
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        assert.equal(commands[0]?.event.type, "room:join");
        // With the first command still unacknowledged, leave must be sent.
        socket.emit("room:leave");
        assert.equal(commands.at(-1)?.event.type, "room:leave");
        const leaveId = commands.at(-1).id;
        socket.emit("room:leave");
        assert.equal(commands.at(-1)?.id, leaveId);
        notify("command:ack", { id: leaveId, status: "accepted" });
    } finally {
        socket.disconnect();
        globalThis.fetch = originalFetch;
    }
});
