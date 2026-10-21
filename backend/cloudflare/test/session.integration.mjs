import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const requireServer = createRequire(
    resolve(root, "backend/server/package.json"),
);
const { io } = requireServer("socket.io-client");
const { WebSocket } = requireServer("ws");
async function until(predicate, label, timeout = 6000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
        if (await predicate()) return;
        await delay(20);
    }
    throw new Error(`Timed out: ${label}`);
}

// These use production handlers, actual JWT verification and real transports.
// A test-only Worker subclass exposes stored state and replays a close callback;
// it does not replace the session/game implementation or add production routes.
for (const transport of ["node", "worker"])
    test(
        `standalone ${transport}: session replacement, reconnect grace, explicit exit and final room deletion`,
        { timeout: 45000 },
        async (t) => {
            const temp = await mkdtemp(resolve(tmpdir(), "etb-session-"));
            t.after(() => rm(temp, { recursive: true, force: true }));
            const roomId = randomUUID();
            const row = {
                id: roomId,
                max_players: 6,
                game_duration: 120,
                items: [
                    { id: "q", type: "typed_recall", prompt: "q", answer: "a" },
                ],
            };
            const broker = createServer((req, res) => {
                if (!req.url.startsWith("/rest/v1/ei_typebomb_rooms")) {
                    res.writeHead(500).end();
                    return;
                }
                const id = new URL(req.url, "http://fixture").searchParams
                    .get("id")
                    ?.slice(3);
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify([{ ...row, id: id ?? roomId }]));
            });
            await new Promise((resolve) =>
                broker.listen(0, "127.0.0.1", resolve),
            );
            t.after(
                () =>
                    new Promise((resolve) => {
                        broker.closeAllConnections();
                        broker.close(resolve);
                    }),
            );
            const { privateKey, publicKey } = await generateKeyPair("ES256");
            const bindings = {
                JWT_KEY_ID: "session-test",
                JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
                NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${broker.address().port}`,
                NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-only",
            };
            const sign = (claims, audience) =>
                new SignJWT(claims)
                    .setProtectedHeader({
                        alg: "ES256",
                        kid: bindings.JWT_KEY_ID,
                    })
                    .setIssuer("ei-typebomb")
                    .setAudience(audience)
                    .setIssuedAt()
                    .setExpirationTime("1h")
                    .sign(privateKey);
            const jwtToken = await sign(
                { id: roomId, role: "authenticated" },
                "authenticated",
            );
            const identities = [randomUUID(), randomUUID(), randomUUID()];
            const tokens = await Promise.all(
                identities.map((sessionId) =>
                    sign(
                        { roomId, sessionId, role: "client_session" },
                        "ei-typebomb:client-session",
                    ),
                ),
            );
            let endpoint,
                mf,
                output = "";
            if (transport === "node") {
                const portServer = createServer();
                await new Promise((resolve) =>
                    portServer.listen(0, "127.0.0.1", resolve),
                );
                const port = portServer.address().port;
                await new Promise((resolve) => portServer.close(resolve));
                endpoint = `http://127.0.0.1:${port}`;
                const child = spawn(
                    process.execPath,
                    ["--import", "tsx", "src/index.ts"],
                    {
                        cwd: resolve(root, "backend/server"),
                        stdio: ["ignore", "pipe", "pipe"],
                        env: {
                            ...process.env,
                            ...bindings,
                            PORT: String(port),
                            ETB_CLUSTER_CONFIG: undefined,
                            PRIMARY_SERVER_URL: undefined,
                            PARENT_SERVER_URL: undefined,
                            SERVER_PUBLIC_URL: undefined,
                            NEXT_PUBLIC_POSTHOG_KEY: "",
                            DOTENV_CONFIG_PATH: resolve(temp, "no-env"),
                        },
                    },
                );
                child.stdout.on("data", (chunk) => (output += chunk));
                child.stderr.on("data", (chunk) => (output += chunk));
                t.after(async () => {
                    if (child.exitCode === null) {
                        const closed = new Promise((resolve) =>
                            child.once("exit", resolve),
                        );
                        child.kill("SIGKILL");
                        await closed;
                    }
                });
                try {
                    await until(async () => {
                        try {
                            return (await fetch(endpoint + "/health")).ok;
                        } catch {
                            return false;
                        }
                    }, "Node ready");
                } catch (error) {
                    throw new Error(`${error.message}\n${output}`);
                }
            } else {
                const bundle = await build({
                    stdin: {
                        resolveDir: resolve(root, "backend/cloudflare"),
                        contents: `
                import worker, {GameRoom as ProductionGameRoom, ClusterDO, ReplicaDO} from './src/index.ts';
                export {ClusterDO, ReplicaDO};
                export class GameRoom extends ProductionGameRoom {
                    lastClosed;
                    async webSocketClose(ws) { this.lastClosed = ws; await super.webSocketClose(ws); }
                    async fetch(request) {
                        const path = new URL(request.url).pathname;
                        if (path === '/test/repeat-close' && this.lastClosed)
                            await super.webSocketClose(this.lastClosed);
                        if (path.startsWith('/test/')) return Response.json({
                            state: await this.ctx.storage.get('state'),
                            pending: await this.ctx.storage.get('pendingLeaves')
                        });
                        return super.fetch(request);
                    }
                }
                export default worker;
            `,
                    },
                    bundle: true,
                    write: false,
                    format: "esm",
                    target: "es2022",
                    external: ["cloudflare:workers"],
                });
                mf = new Miniflare(
                    convertV4MiniflareOptions({
                        script: bundle.outputFiles[0].text,
                        modules: true,
                        compatibilityDate: "2026-10-16",
                        durableObjects: {
                            ROOMS: { className: "GameRoom", useSQLite: true },
                            CLUSTER: {
                                className: "ClusterDO",
                                useSQLite: true,
                            },
                            REPLICAS: {
                                className: "ReplicaDO",
                                useSQLite: true,
                            },
                        },
                        bindings,
                    }),
                );
                t.after(() => mf.dispose());
                endpoint = String(await mf.ready).replace(/\/$/, "");
            }
            const clients = [];
            t.after(() => clients.forEach((client) => client.close()));
            async function connect(index) {
                const events = [];
                const client = {
                    room: undefined,
                    errors: [],
                    events,
                    closed: false,
                    id: undefined,
                    send(event, data) {
                        if (socket.io) socket.emit(event, data);
                        else socket.send(JSON.stringify({ event, data }));
                    },
                    close() {
                        if (socket.io) socket.disconnect();
                        else socket.close();
                    },
                };
                const receive = (event, data) => {
                    events.push({ event, data });
                    if (event === "auth:request")
                        client.send("auth:response", {
                            jwtToken,
                            sessionToken: tokens[index],
                            displayName: `tab-${index}`,
                        });
                    if (event === "auth:session") client.id = data.id;
                    if (event === "room:broadcast") client.room = data;
                    if (event === "error") client.errors.push(data);
                };
                const socket =
                    transport === "node"
                        ? io(endpoint, {
                              autoConnect: false,
                              reconnection: false,
                              transports: ["websocket"],
                          })
                        : new WebSocket(
                              `${endpoint.replace("http", "ws")}/ws/${roomId}`,
                          );
                client.socket = socket;
                clients.push(client);
                if (transport === "node") {
                    socket.onAny(receive);
                    socket.on("disconnect", () => (client.closed = true));
                    socket.connect();
                } else {
                    socket.on("message", (raw) => {
                        const p = JSON.parse(raw);
                        receive(p.event, p.data);
                    });
                    socket.on("close", () => (client.closed = true));
                }
                await until(
                    () => client.id && client.room,
                    `authenticate ${index}`,
                );
                assert.deepEqual(client.errors, []);
                return client;
            }
            try {
                const a = await connect(0),
                    b = await connect(1),
                    spectator = await connect(2);
                a.send("room:join");
                b.send("room:join");
                a.send("room:join");
                await until(
                    () => b.room.users.length === 2,
                    "two unique seats",
                );
                assert.equal(
                    new Set(b.room.users.map((user) => user.id)).size,
                    2,
                );
                // The same page replaces its transport, while a different tab
                // remains a distinct player. Old close must not remove the seat.
                const replacement = await connect(0);
                await until(() => a.closed, "old transport closed");
                assert.deepEqual(
                    new Set(replacement.room.users.map((user) => user.id)),
                    new Set(identities.slice(0, 2)),
                );
                replacement.send("game:start");
                await until(() => b.room.isStart, "game start");
                const gameId = b.room.gameId;
                replacement.close();
                await delay(350);
                assert.equal(
                    b.room.isStart,
                    true,
                    "temporary transport loss must preserve active match",
                );
                const resumed = await connect(0);
                assert.equal(resumed.room.gameId, gameId);
                assert.equal(resumed.room.users.length, 2);
                const authCount = resumed.events.filter(
                    (p) => p.event === "auth:session",
                ).length;
                resumed.send("auth:response", {
                    jwtToken,
                    sessionToken: tokens[1],
                    displayName: "tab-0",
                });
                await until(
                    () => resumed.errors.length > 0,
                    "identity switch rejected on authenticated transport",
                );
                assert.equal(
                    resumed.events.filter((p) => p.event === "auth:session")
                        .length,
                    authCount,
                );
                assert.equal(
                    b.closed,
                    false,
                    "rejected identity change cannot replace another player's connection",
                );
                resumed.errors.length = 0;
                const requestId = randomUUID();
                resumed.send("room:leave", { requestId });
                await until(
                    () =>
                        resumed.events.some(
                            (p) =>
                                p.event === "room:leave:ack" &&
                                p.data.requestId === requestId,
                        ),
                    "committed exit ACK",
                );
                assert.equal(resumed.room.isStart, false);
                assert.deepEqual(resumed.room.users, []);
                resumed.send("room:leave", { requestId });
                resumed.send("room:join");
                b.send("room:join");
                await until(
                    () => b.room.users.length === 2,
                    "rejoin on authenticated transports",
                );
                resumed.send("game:start");
                await until(() => b.room.isStart, "second match");
                resumed.close();
                let workerStub;
                if (transport === "worker") {
                    const namespace =
                        await mf.getDurableObjectNamespace("ROOMS");
                    workerStub = namespace.get(namespace.idFromName(roomId));
                    let deadline;
                    await until(async () => {
                        const stored = await (
                            await workerStub.fetch("http://fixture/test/state")
                        ).json();
                        deadline = stored.pending?.[identities[0]];
                        return deadline !== undefined;
                    }, "persisted reconnect deadline");
                    await delay(200);
                    const repeated = await (
                        await workerStub.fetch(
                            "http://fixture/test/repeat-close",
                        )
                    ).json();
                    assert.equal(
                        repeated.pending[identities[0]],
                        deadline,
                        "close/error retry cannot extend the original persisted deadline",
                    );
                }
                // Leave one observer to verify actual grace expiry cancels the
                // match and removes the disconnected player from visible state.
                await delay(20_400);
                await until(
                    () =>
                        !spectator.room.isStart &&
                        !spectator.room.users.some(
                            (user) => user.id === identities[0],
                        ),
                    "20s grace expiry",
                );
                b.close();
                spectator.close();
                if (transport === "worker") {
                    await until(
                        async () =>
                            !(
                                await (
                                    await workerStub.fetch(
                                        "http://fixture/test/state",
                                    )
                                ).json()
                            ).state,
                        "Worker stored room deleted",
                    );
                } else {
                    await until(
                        () => output.includes(`deleted ${roomId}`),
                        "Node room deleted",
                    );
                }
                const fresh = await connect(0);
                assert.deepEqual(fresh.room.users, []);
                assert.equal(fresh.room.isStart, false);
                assert.equal(
                    fresh.room.revision,
                    0,
                    "reopened room has a fresh runtime",
                );
                for (const client of clients)
                    assert.deepEqual(client.errors, []);
            } catch (error) {
                t.diagnostic(output);
                throw error;
            }
        },
    );
