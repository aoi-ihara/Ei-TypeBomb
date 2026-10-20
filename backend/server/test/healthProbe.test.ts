import assert from "node:assert/strict";
import test from "node:test";
import { probeServerHealth, probeServerTransport, healthRowKey } from "../../../frontend/lib/room/healthProbe";

test("health probe measures a real uncached HTTP round trip, including Worker /ws entries", async () => {
    let sent = "";
    let opts: RequestInit | undefined;
    const fakeFetch = (async (url: string, options: RequestInit) => {
        sent = url;
        opts = options;
        return Response.json({ ok: true });
    }) as typeof fetch;
    let tick = 100;
    const result = await probeServerHealth("https://worker.example.test/ws",
        undefined, fakeFetch, () => { tick += 11; return tick; });
    assert.deepEqual(result, { healthy: true, latencyMs: 11 });
    assert.equal(sent, "https://worker.example.test/health");
    assert.equal(opts?.credentials, "omit");
    assert.equal(opts?.cache, "no-store");
    assert.equal(opts?.redirect, "error");
    assert.equal(opts?.method, "GET");
    assert.equal(opts?.body, undefined);
    assert.equal(opts?.headers && (opts.headers as Record<string, string>).Authorization, undefined);
});

test("invalid or unsuccessful health responses are errors, not healthy connections", async () => {
    const no = (value: Response) =>
        probeServerHealth("https://server.example.test",
            undefined, (async () => value) as typeof fetch);
    assert.deepEqual(await no(Response.json({ ok: false })),
        { healthy: false, latencyMs: null });
    assert.deepEqual(await no(new Response(null, { status: 503 })),
        { healthy: false, latencyMs: null });
    assert.deepEqual(await no(new Response("not JSON")),
        { healthy: false, latencyMs: null });
});

test("a silent backend resolves as unhealthy after a bounded timeout", async () => {
    const fakeFetch = ((_: string, options: RequestInit) =>
        new Promise<Response>((_, reject) => {
            options.signal?.addEventListener("abort",
                () => reject(new Error("aborted")), { once: true });
        })) as typeof fetch;
    const started = Date.now();
    const result = await probeServerHealth(
        "https://offline.example.test", undefined, fakeFetch, undefined, 25);
    assert.deepEqual(result, { healthy: false, latencyMs: null });
    assert.ok(Date.now() - started < 1000);
});

test("a canceled probe cannot keep the health page waiting", async () => {
    const controller = new AbortController();
    const fakeFetch = ((_: string, options: RequestInit) =>
        new Promise<Response>((_, reject) => {
            options.signal?.addEventListener("abort",
                () => reject(new Error("aborted")), { once: true });
        })) as typeof fetch;
    const pending = probeServerHealth("https://offline.example.test",
        controller.signal, fakeFetch);
    controller.abort();
    assert.deepEqual(await pending, { healthy: false, latencyMs: null });
});


test("a transport probe measures an anonymous handshake and closes the socket", async () => {
    let closed = 0;
    let tick = 100;
    const listeners = new Map<string, () => void>();
    const result = await probeServerTransport(() => ({
        on(event, callback) { listeners.set(event, callback); },
        connect() {
            assert.ok(listeners.has("connect"), "Subscribe before connecting");
            listeners.get("connect")?.();
        },
        disconnect() { closed++; },
    }), undefined, () => { tick += 12; return tick; });
    assert.deepEqual(result, { healthy: true, latencyMs: 12 });
    assert.equal(closed, 1);
});

test("an unreachable transport terminates and disconnects even without an error event", async () => {
    let closed = 0;
    const result = await probeServerTransport(() => ({
        on() {},
        connect() {},
        disconnect() { closed++; },
    }), undefined, undefined, 20);
    assert.deepEqual(result, { healthy: false, latencyMs: null });
    assert.equal(closed, 1);
});

test("a canceled transport closes without waiting for a timeout", async () => {
    const controller = new AbortController();
    let closed = 0;
    const pending = probeServerTransport(() => ({
        on() {},
        connect() {},
        disconnect() { closed++; },
    }), controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    assert.deepEqual(await pending, { healthy: false, latencyMs: null });
    assert.equal(closed, 1);
});

test("HTTP probe has a hard timeout even if fetch ignores abort", async () => {
    const started = Date.now();
    const never = (async () => new Promise<Response>(() => {})) as typeof fetch;
    const result = await probeServerHealth(
        "https://offline.example.test", undefined, never, undefined, 20);
    assert.deepEqual(result, { healthy: false, latencyMs: null });
    assert.ok(Date.now() - started < 1000);
});

test("HTTP success does not mask an independent WebSocket failure", async () => {
    const http = await probeServerHealth(
        "https://owner.example.test",
        undefined,
        (async () => Response.json({ ok: true })) as typeof fetch);
    const transport = await probeServerTransport(() => ({
        on(_event, listener) { if (_event === "connect_error") listener(); },
        connect() {},
        disconnect() {},
    }));
    assert.equal(http.healthy, true);
    assert.equal(transport.healthy, false);
});

test("reordering servers invalidates the prior row identities", () => {
    const old = [
        healthRowKey(0, "https://one.example.test"),
        healthRowKey(1, "https://two.example.test"),
    ];
    const updated = [
        healthRowKey(0, "https://two.example.test"),
        healthRowKey(1, "https://one.example.test"),
    ];
    assert.equal(old.filter((key) => updated.includes(key)).length, 0);
});
