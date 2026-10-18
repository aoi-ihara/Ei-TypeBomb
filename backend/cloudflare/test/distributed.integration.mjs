import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { build } from "esbuild";
import { generateKeyPair, exportJWK, SignJWT } from "jose";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const requireServer = createRequire(
    resolve(root, "backend/server/package.json"),
);
const { Pool } = requireServer("pg");
const { io } = requireServer("socket.io-client");
const database = process.env.ETB_TEST_DATABASE_URL;
const wait = async (predicate, description, timeout = 15000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
        const value = await predicate();
        if (value) return value;
        await delay(30);
    }
    throw new Error(`Timed out: ${description}`);
};
const freePort = async () => {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
};

test(
    "real Socket.IO → workerd WebSocket → Socket.IO preserves a running match",
    { skip: !database, timeout: 90000 },
    async (t) => {
        const pool = new Pool({ connectionString: database });
        t.after(() => pool.end());
        await pool.query(
            "drop function if exists public.etb_cluster(text,text,text,jsonb); drop schema if exists etb_private cascade",
        );
        await pool.query(
            await readFile(
                resolve(
                    root,
                    "supabase/migrations/20261018142210_distributed_room_control.sql",
                ),
                "utf8",
            ),
        );
        const temp = await mkdtemp(resolve(tmpdir(), "etb-workerd-"));
        t.after(() => rm(temp, { recursive: true, force: true }));
        const ports = await Promise.all([freePort(), freePort(), freePort()]);
        const urls = ports.map((port) => `http://127.0.0.1:${port}`);
        const tokens = urls.map(() => randomUUID() + randomUUID());
        for (let i = 0; i < 3; i++)
            await pool.query(
                "insert into etb_private.servers(id,token_hash,parent,depth,transport) values($1,sha256(convert_to($2,'UTF8')),$3,$4,$5)",
                [
                    urls[i],
                    tokens[i],
                    urls[i - 1] ?? null,
                    i,
                    i === 1 ? "websocket" : "socket.io",
                ],
            );
        const roomId = randomUUID();
        const row = {
            id: roomId,
            max_players: 6,
            game_duration: 120,
            items: [
                {
                    id: "q",
                    type: "typed_recall",
                    prompt: "test",
                    answer: "test",
                },
            ],
        };
        const receivedBy = new Set();
        const broker = createServer(async (req, res) => {
            try {
                if (req.url.startsWith("/rest/v1/rpc/etb_cluster")) {
                    let text = "";
                    for await (const part of req) text += part;
                    const body = JSON.parse(text);
                    const value = await pool.query(
                        "select public.etb_cluster($1,$2,$3,$4) value",
                        [
                            body.server_id,
                            body.server_token,
                            body.operation,
                            body.args,
                        ],
                    );
                    if (body.operation === "receive")
                        receivedBy.add(body.server_id);
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify(value.rows[0].value));
                } else if (req.url.startsWith("/rest/v1/ei_typebomb_rooms")) {
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify([row]));
                } else {
                    res.writeHead(404).end();
                }
            } catch (error) {
                res.writeHead(400, { "Content-Type": "application/json" }).end(
                    JSON.stringify({ message: error.message }),
                );
            }
        });
        await new Promise((resolve) => broker.listen(0, "127.0.0.1", resolve));
        t.after(() => new Promise((resolve) => broker.close(resolve)));
        const api = `http://127.0.0.1:${broker.address().port}`;
        const { privateKey, publicKey } = await generateKeyPair("ES256");
        const kid = "integration-test";
        const common = {
            JWT_KEY_ID: kid,
            JWT_PUBLIC_KEY: JSON.stringify(await exportJWK(publicKey)),
            NEXT_PUBLIC_SUPABASE_URL: api,
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-only",
            PRIMARY_SERVER_URL: urls[0],
        };
        const roomToken = await new SignJWT({
            id: roomId,
            role: "authenticated",
        })
            .setProtectedHeader({ alg: "ES256", kid })
            .setIssuer("ei-typebomb")
            .setAudience("authenticated")
            .setIssuedAt()
            .setExpirationTime("1h")
            .sign(privateKey);
        const players = [randomUUID(), randomUUID()];
        const sessions = await Promise.all(
            players.map((sessionId) =>
                new SignJWT({ role: "client_session", roomId, sessionId })
                    .setProtectedHeader({ alg: "ES256", kid })
                    .setIssuer("ei-typebomb")
                    .setAudience("ei-typebomb:client-session")
                    .setIssuedAt()
                    .setExpirationTime("1h")
                    .sign(privateKey),
            ),
        );
        const processes = [];
        const startNode = async (i) => {
            const child = spawn(
                process.execPath,
                ["--import", "tsx", "src/index.ts"],
                {
                    cwd: resolve(root, "backend/server"),
                    env: {
                        ...process.env,
                        ...common,
                        SERVER_PUBLIC_URL: urls[i],
                        PARENT_SERVER_URL: urls[i - 1] ?? "",
                        CLUSTER_SERVER_TOKEN: tokens[i],
                        PORT: String(ports[i]),
                        NEXT_PUBLIC_POSTHOG_KEY: "",
                        DOTENV_CONFIG_PATH: resolve(temp, "no-env"),
                    },
                    stdio: ["ignore", "pipe", "pipe"],
                },
            );
            processes.push(child);
            let output = "";
            child.stdout.on("data", (chunk) => (output += chunk));
            child.stderr.on("data", (chunk) => (output += chunk));
            try {
                await wait(async () => {
                    try {
                        return (await fetch(`${urls[i]}/health`)).ok;
                    } catch {
                        return false;
                    }
                }, `node ${i}`);
            } catch (error) {
                throw new Error(`${error.message}\n${output}`);
            }
            return child;
        };
        t.after(() => {
            for (const child of processes)
                if (child.exitCode === null) child.kill("SIGKILL");
        });
        await build({
            entryPoints: [resolve(root, "backend/cloudflare/src/index.ts")],
            bundle: true,
            keepNames: true,
            format: "esm",
            target: "es2022",
            outfile: resolve(temp, "worker.mjs"),
            external: ["cloudflare:workers"],
        });
        const mf = new Miniflare(
            convertV4MiniflareOptions({
                scriptPath: resolve(temp, "worker.mjs"),
                modulesRoot: temp,
                modules: true,
                compatibilityDate: "2026-10-16",
                port: ports[1],
                host: "127.0.0.1",
                durableObjects: {
                    ROOMS: { className: "GameRoom", useSQLite: true },
                },
                bindings: {
                    ...common,
                    SERVER_PUBLIC_URL: urls[1],
                    PARENT_SERVER_URL: urls[0],
                    CLUSTER_SERVER_TOKEN: tokens[1],
                },
            }),
        );
        t.after(() => mf.dispose());
        await mf.ready;
        const primary = await startNode(0);
        await startNode(2);
        const clients = [];
        const nodeClient = async (i, player) => {
            const socket = io(urls[i], {
                transports: ["websocket"],
                reconnection: false,
            });
            clients.push(socket);
            const state = {
                room: null,
                acks: [],
                socket,
                send: (event, data) => socket.emit(event, data),
            };
            socket.on("auth:request", () =>
                socket.emit("auth:response", {
                    jwtToken: roomToken,
                    sessionToken: sessions[player],
                    displayName: `Player ${player}`,
                }),
            );
            socket.on("room:broadcast", (room) => (state.room = room));
            socket.on("command:ack", (ack) => state.acks.push(ack));
            await wait(
                () => state.room,
                `authenticate player ${player} on node ${i}`,
            );
            return state;
        };
        t.after(() => clients.forEach((socket) => socket.disconnect()));
        const command = async (client, player, type) => {
            const id = randomUUID();
            await wait(async () => {
                if (
                    client.acks.find(
                        (ack) => ack.id === id && ack.status === "accepted",
                    )
                )
                    return true;
                const room = client.room;
                client.send("game:command", {
                    id,
                    originRevision: room.revision,
                    instance: room.roomInstanceId,
                    epoch: room.epoch,
                    revision: room.revision,
                    gameId: room.gameId,
                    bombId: room.bombs?.find(
                        (bomb) =>
                            room.users[bomb.holder]?.id === players[player],
                    )?.id,
                    turn: room.bombs?.find(
                        (bomb) =>
                            room.users[bomb.holder]?.id === players[player],
                    )?.turn,
                    event: { type },
                });
                await delay(180);
                return false;
            }, type);
        };
        const { RoutedSocket } = await import(
            "../../../frontend/lib/room/routedSocket.ts"
        );
        const observerId = randomUUID();
        const observerSession = await new SignJWT({
            role: "client_session",
            roomId,
            sessionId: observerId,
        })
            .setProtectedHeader({ alg: "ES256", kid })
            .setIssuer("ei-typebomb")
            .setAudience("ei-typebomb:client-session")
            .setIssuedAt()
            .setExpirationTime("1h")
            .sign(privateKey);
        let observed;
        let dropNextAck = false;
        const routedCommands = [];
        const nativeTransport = (target) => {
            if (!target.endsWith("/ws")) {
                const socket = io(target, {
                    transports: ["websocket"],
                    reconnection: false,
                });
                const on = socket.on.bind(socket),
                    emit = socket.emit.bind(socket);
                socket.on = (event, listener) =>
                    on(
                        event,
                        event === "command:ack"
                            ? (ack) => {
                                  if (dropNextAck) {
                                      dropNextAck = false;
                                      return;
                                  }
                                  listener(ack);
                              }
                            : listener,
                    );
                socket.emit = (event, data) => {
                    if (event === "game:command") routedCommands.push(data.id);
                    return emit(event, data);
                };
                return socket;
            }
            const listeners = new Map();
            const dispatch = (event, data) => {
                for (const callback of listeners.get(event) ?? [])
                    callback(data);
            };
            const ws = new WebSocket(
                `${target.replace("http", "ws")}/${roomId}`,
            );
            const transport = {
                connected: false,
                id: undefined,
                on(event, callback) {
                    const set = listeners.get(event) ?? new Set();
                    set.add(callback);
                    listeners.set(event, set);
                    return this;
                },
                emit(event, data) {
                    if (ws.readyState === 1)
                        ws.send(JSON.stringify({ event, data }));
                    return this;
                },
                disconnect() {
                    ws.close();
                    this.connected = false;
                },
            };
            ws.onmessage = (message) => {
                const packet = JSON.parse(message.data);
                if (packet.event === "connect") {
                    transport.id = packet.data.id;
                    transport.connected = true;
                }
                dispatch(packet.event, packet.data);
            };
            ws.onerror = () => dispatch("connect_error");
            ws.onclose = () => {
                transport.connected = false;
                dispatch("disconnect");
            };
            return transport;
        };
        const routed = new RoutedSocket(
            [urls[0]],
            nativeTransport,
            async () => roomToken,
            () => true,
        );
        t.after(() => routed.disconnect());
        routed.on("auth:request", () =>
            routed.emit("auth:response", {
                jwtToken: roomToken,
                sessionToken: observerSession,
                displayName: "Observer",
            }),
        );
        routed.on("room:broadcast", (room) => (observed = room));
        await wait(() => observed, "automatic routing to primary");
        const p1 = await nodeClient(0, 0),
            p2 = await nodeClient(0, 1);
        await command(p1, 0, "room:join");
        await command(p2, 1, "room:join");
        await command(p1, 0, "game:start");
        await wait(
            () => p1.room.bombs?.[0]?.wordIndex !== undefined,
            "countdown",
        );
        const holder = players.indexOf(
            p1.room.users[p1.room.bombs[0].holder].id,
        );
        await command(holder === 0 ? p1 : p2, holder, "word:success");
        const expected = structuredClone(p1.room);
        await wait(
            () => receivedBy.has(urls[1]) && receivedBy.has(urls[2]),
            "authenticated direct replication to every lower server",
        );
        primary.kill("SIGKILL");
        await new Promise((resolve) => primary.once("exit", resolve));
        await delay(3300); // Actual lease expiration, no forced SQL transfer.
        const workerClients = [];
        const workerClient = async (player) => {
            const response = await mf.dispatchFetch(`${urls[1]}/ws/${roomId}`, {
                headers: { Upgrade: "websocket" },
            });
            assert.equal(response.status, 101);
            const ws = response.webSocket;
            ws.accept();
            workerClients.push(ws);
            const state = {
                room: null,
                acks: [],
                send: (event, data) => ws.send(JSON.stringify({ event, data })),
            };
            ws.addEventListener("message", (message) => {
                const packet = JSON.parse(message.data);
                if (packet.event === "auth:request")
                    state.send("auth:response", {
                        jwtToken: roomToken,
                        sessionToken: sessions[player],
                        displayName: `Player ${player}`,
                    });
                if (packet.event === "room:broadcast") state.room = packet.data;
                if (packet.event === "command:ack")
                    state.acks.push(packet.data);
                if (packet.event === "error")
                    console.error("Worker test error", packet.data);
            });
            await wait(() => state.room, `worker auth ${player}`);
            return state;
        };
        t.after(() =>
            workerClients.forEach((ws) => {
                try {
                    ws.close();
                } catch {}
            }),
        );
        const w1 = await workerClient(0),
            w2 = await workerClient(1);
        await wait(() => !w1.room.migrating, "worker resume");
        await wait(
            () => observed?.epoch === w1.room.epoch,
            "automatic client primary-to-worker failover",
        );
        for (const client of [w1, w2]) {
            assert.equal(client.room.gameId, expected.gameId);
            assert.equal(client.room.roomInstanceId, expected.roomInstanceId);
            assert.deepEqual(client.room.users, expected.users);
            assert.equal(client.room.bombs[0].holder, expected.bombs[0].holder);
            assert.equal(client.room.bombs[0].turn, expected.bombs[0].turn);
        }
        // A recovered primary remains unable to recreate this migrated room.
        await startNode(0);
        const route = await fetch(`${urls[0]}/cluster/route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jwtToken: roomToken }),
        }).then((response) => response.json());
        assert.equal(route.ownership.owner, urls[1]);
        assert.equal(observed.epoch, w1.room.epoch);
        await mf.dispose();
        await delay(3300);
        const r1 = await nodeClient(2, 0),
            r2 = await nodeClient(2, 1);
        await wait(() => !r1.room.migrating, "tertiary resume");
        await wait(
            () => observed?.epoch === r1.room.epoch,
            "automatic client worker-to-tertiary failover",
        );
        assert.equal(observed.gameId, expected.gameId);
        assert.equal(r1.room.gameId, expected.gameId);
        assert.equal(r2.room.roomInstanceId, expected.roomInstanceId);
        assert.equal(r1.room.bombs[0].holder, expected.bombs[0].holder);
        assert.equal(r1.room.bombs[0].turn, expected.bombs[0].turn);
        assert.deepEqual(r1.room.users, expected.users);
        dropNextAck = true;
        routed.emit("room:leave"); // Observer command is a no-op, but its ACK is durable.
        await wait(
            () => routedCommands.length >= 2,
            "lost ACK retries the same event ID",
        );
        assert.equal(new Set(routedCommands).size, 1);
    },
);
