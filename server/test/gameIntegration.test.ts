import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import jwt from "jsonwebtoken";
import { io, type Socket } from "socket.io-client";

const waitFor = <T>(socket: Socket, event: string, accepts: (value: T) => boolean = () => true) =>
    new Promise<T>((resolve, reject) => {
        const timeout = setTimeout(() => {
            socket.off(event, listener);
            reject(new Error(`Timed out waiting for ${event}`));
        }, 8000);
        const listener = (value: T) => {
            if (!accepts(value)) return;
            clearTimeout(timeout);
            socket.off(event, listener);
            resolve(value);
        };
        socket.on(event, listener);
    });

type Snapshot = {
    id: string;
    users: { id: string }[];
    isStart: boolean;
    wordIndex?: number;
    bombHolder: number;
    password?: string;
    items?: unknown[];
    words: { jp: string; en: string }[];
};

test("real Node adapter preserves spectators, immutable membership and room-scoped timers", { timeout: 25000 }, async () => {
    const child = spawn(process.execPath, [
        "--require", "./test/fixtures/mockDatabase.cjs", "--import", "tsx", "src/index.ts",
    ], {
        cwd: process.cwd(),
        env: { ...process.env, JWT_SECRET: "integration-only", SUPABASE_DATABASE_URL: "postgres://test:test@localhost/test",
            NEXT_PUBLIC_POSTHOG_KEY: "", POSTHOG_LOGS_ENABLED: "false", PORT: "0" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    const sockets: Socket[] = [];
    try {
        const port = await new Promise<number>((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error(`Server did not listen:\n${output}`));
            }, 5000);
            const onData = () => {
                const match = output.match(/listening on :(\d+)/);
                if (match) { cleanup(); resolve(Number(match[1])); }
            };
            const onExit = () => { cleanup(); reject(new Error(`Server exited:\n${output}`)); };
            const cleanup = () => {
                clearTimeout(timeout);
                child.stdout.off("data", onData);
                child.off("exit", onExit);
            };
            child.stdout.on("data", onData);
            child.once("exit", onExit);
            onData();
        });
        const connect = async (name: string) => {
            const socket = io(`http://localhost:${port}`, { transports: ["websocket"], reconnection: false, autoConnect: false });
            sockets.push(socket);
            const auth = waitFor(socket, "auth:request");
            // Startup is asynchronous; retry only before the initial connection.
            const started = Date.now();
            while (true) {
                socket.connect();
                try { await Promise.race([once(socket, "connect"), once(socket, "connect_error").then(([error]) => Promise.reject(error))]); break; }
                catch (error) {
                    if (Date.now() - started > 5000) throw new Error(`${error}\n${output}`);
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            }
            await auth;
            const snapshot = waitFor<Snapshot>(socket, "room:broadcast", (room) => room.id === "a");
            socket.emit("auth:response", { jwtToken: jwt.sign({ id: "a" }, "integration-only"), displayName: name });
            await snapshot;
            return socket;
        };
        const first = await connect("first");
        const second = await connect("second");
        const spectator = await connect("spectator");
        for (const socket of [first, second]) {
            const joined = waitFor<Snapshot>(socket, "room:broadcast", (room) => room.users.some((user) => user.id === socket.id));
            socket.emit("room:join");
            await joined;
        }
        const started = waitFor<Snapshot>(first, "room:broadcast", (room) => room.isStart);
        spectator.emit("game:start");
        const game = await started;
        assert.equal(game.users.length, 2);
        assert.equal(game.password, undefined);
        assert.deepEqual(game.words, [{ jp: "猫", en: "cat" }]);
        // A spectator started this game, then changes auth room. Its closure must
        // not redirect the pending word deadline to the new room.
        const countdown = waitFor<Snapshot>(first, "room:broadcast", (room) => room.isStart && room.wordIndex === 0);
        const changed = waitFor<Snapshot>(spectator, "room:broadcast", (room) => room.id === "b");
        spectator.emit("auth:response", { jwtToken: jwt.sign({ id: "b" }, "integration-only"), displayName: "spectator" });
        await changed;
        const active = await countdown;
        const holder = [first, second].find((socket) => socket.id === active.users[active.bombHolder].id)!;
        const input = waitFor<{ input: string }>(first, "typing:input", (value) => value.input.length > 0);
        holder.emit("currentInput", "x".repeat(100));
        assert.deepEqual(await input, { input: "x".repeat(32) });
        const passed = waitFor<Snapshot>(first, "room:broadcast", (room) => room.bombHolder !== active.bombHolder);
        holder.emit("word:success");
        await passed;
        const cancelled = waitFor(first, "game:quited");
        const reset = waitFor<Snapshot>(first, "room:broadcast", (room) => !room.isStart && room.users.length === 0);
        second.emit("room:leave");
        await cancelled;
        await reset;
        // A pending settings query must not start after membership replacement.
        for (const socket of [first, second]) {
            const joined = waitFor<Snapshot>(socket, "room:broadcast", (room) => room.users.some((user) => user.id === socket.id));
            socket.emit("room:join");
            await joined;
        }
        let unexpectedStart = false;
        first.on("room:broadcast", (room: Snapshot) => { if (room.isStart) unexpectedStart = true; });
        first.emit("game:start");
        const left = waitFor<Snapshot>(first, "room:broadcast", (room) => room.users.length === 1);
        second.emit("room:leave");
        await left;
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.equal(unexpectedStart, false);
        // An older room lookup must not overwrite the newer authentication.
        const racing = await connect("auth-race");
        const selectedRooms: string[] = [];
        racing.on("room:broadcast", (room: Snapshot) => selectedRooms.push(room.id));
        const latest = waitFor<Snapshot>(racing, "room:broadcast", (room) => room.id === "fast-auth");
        racing.emit("auth:response", { jwtToken: jwt.sign({ id: "slow-auth" }, "integration-only"), displayName: "old" });
        const lookupStarted = waitFor(racing, "health:pong");
        racing.emit("health:ping", "12345678-1234-4123-8123-123456789abc");
        await lookupStarted;
        racing.emit("auth:response", { jwtToken: jwt.sign({ id: "fast-auth" }, "integration-only"), displayName: "new" });
        await latest;
        await new Promise((resolve) => setTimeout(resolve, 300));
        assert.ok(!selectedRooms.includes("slow-auth"));
        const joinedLatest = waitFor<Snapshot>(racing, "room:broadcast", (room) => room.users.some((user) => user.id === racing.id));
        racing.emit("room:join");
        assert.equal((await joinedLatest).id, "fast-auth");
    } finally {
        for (const socket of sockets) socket.disconnect();
        if (child.exitCode === null && child.signalCode === null) {
            child.kill();
            await once(child, "exit");
        }
    }
});
