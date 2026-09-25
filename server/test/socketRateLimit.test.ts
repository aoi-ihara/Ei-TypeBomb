import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { Server } from "socket.io";
import { io as connect } from "socket.io-client";
import { createSocketRateLimit } from "../src/lib/socketRateLimit";

const harness = () => {
    let time = 0;
    const middleware = createSocketRateLimit(() => time);
    return {
        advance: (ms: number) => { time += ms; },
        accept: (event: string) => {
            let accepted = false;
            middleware([event], (error) => {
                assert.equal(error, undefined);
                accepted = true;
            });
            return accepted;
        },
    };
};

for (const [event, capacity, refillMs] of [
    ["currentInput", 60, 34],
    ["word:success", 10, 200],
    ["room:join", 5, 500],
    ["room:leave", 5, 500],
    ["game:start", 2, 1000],
    ["auth:response", 3, 2000],
] as const) {
    test(`${event}: bounds bursts and recovers after excess traffic`, () => {
        const h = harness();
        for (let i = 0; i < capacity; i++) assert.equal(h.accept(event), true);
        for (let i = 0; i < 1000; i++) assert.equal(h.accept(event), false);
        h.advance(refillMs);
        assert.equal(h.accept(event), true);
        assert.equal(h.accept(event), false);
        h.advance(60_000);
        for (let i = 0; i < capacity; i++) assert.equal(h.accept(event), true);
        assert.equal(h.accept(event), false);
    });
}

test("fast typing at 20 events/second remains uninterrupted", () => {
    const h = harness();
    for (let i = 0; i < 1200; i++) {
        assert.equal(h.accept("currentInput"), true);
        h.advance(50);
    }
});

test("continuous rejected traffic preserves fractional refill", () => {
    const h = harness();
    for (let i = 0; i < 60; i++) h.accept("currentInput");
    let accepted = 0;
    for (let i = 0; i < 1000; i++) {
        h.advance(1);
        if (h.accept("currentInput")) accepted++;
    }
    assert.ok(accepted >= 29 && accepted <= 30);
});

test("budgets are independent across events and connections", () => {
    const h = harness();
    for (let i = 0; i < 60; i++) h.accept("currentInput");
    assert.equal(h.accept("currentInput"), false);
    for (const event of ["word:success", "room:leave", "room:join", "auth:response", "game:start"])
        assert.equal(h.accept(event), true);
    assert.equal(harness().accept("currentInput"), true);
    for (const event of ["unknown", "toString", "__proto__"])
        assert.equal(h.accept(event), true);
});

test("Socket.IO drops excess broadcasts without blocking other events or disconnect cleanup", { timeout: 5000 }, async (t) => {
    const http = createServer();
    const server = new Server(http);
    t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
    let time = 0;
    const disconnects: string[] = [];
    server.on("connection", (socket) => {
        socket.use(createSocketRateLimit(() => time));
        socket.join("test");
        socket.on("currentInput", (input) => server.to("test").emit("typing:input", input));
        socket.on("word:success", (ack) => ack());
        socket.on("disconnect", () => disconnects.push(socket.id));
    });
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const sender = connect(url, { transports: ["websocket"], forceNew: true });
    const observer = connect(url, { transports: ["websocket"], forceNew: true });
    t.after(() => { sender.disconnect(); observer.disconnect(); });
    await Promise.all([once(sender, "connect"), once(observer, "connect")]);
    const received: string[] = [];
    sender.on("typing:input", (input) => received.push(input));
    let observerCount = 0;
    observer.on("typing:input", () => observerCount++);
    const errors: unknown[] = [];
    sender.on("error", (error) => errors.push(error));
    for (let i = 0; i < 1000; i++) sender.emit("currentInput", String(i));
    // ACK is an ordered barrier after all sender packets and its broadcasts.
    await sender.timeout(1000).emitWithAck("word:success");
    assert.equal(received.length, 60);
    assert.equal(sender.connected, true);
    assert.deepEqual(errors, []);
    const independent = once(sender, "typing:input");
    observer.emit("currentInput", "independent");
    await independent;
    assert.equal(received.at(-1), "independent");
    time = 1000;
    sender.emit("currentInput", "recovered");
    await sender.timeout(1000).emitWithAck("word:success");
    assert.equal(received.at(-1), "recovered");
    await observer.timeout(1000).emitWithAck("word:success");
    assert.equal(observerCount, 62);
    const socket = server.sockets.sockets.get(sender.id!)!;
    const disconnected = once(socket, "disconnect");
    sender.disconnect();
    await disconnected;
    assert.ok(disconnects.includes(socket.id));
});
