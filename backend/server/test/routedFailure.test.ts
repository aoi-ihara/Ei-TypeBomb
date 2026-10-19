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
