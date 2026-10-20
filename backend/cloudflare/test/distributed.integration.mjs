import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
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
const { io } = requireServer("socket.io-client");
const { WebSocket } = requireServer("ws");
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

for (const scenario of ["worker", "render", "render-restart", "render-state-loss"]) test(
    `real Socket.IO → workerd → Socket.IO failover: ${scenario}`,
    { timeout: 120000 },
    async (t) => {
        const temp = await mkdtemp(resolve(tmpdir(), "etb-workerd-"));
        t.after(() => rm(temp, { recursive: true, force: true }));
        const ports = await Promise.all([freePort(), freePort(), freePort()]);
        const urls = ports.map((port) => `http://127.0.0.1:${port}`);
        const { credentials } = await import(
            "../../server/test/clusterFixture.ts"
        );
        const tokens = (await credentials(urls)).map((bundle) =>
            JSON.stringify(bundle),
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
        let databaseReads = 0;
        const unexpected = [];
        const broker = createServer((req, res) => {
            if (req.url.startsWith("/rest/v1/ei_typebomb_rooms")) {
                databaseReads++;
                const requested =
                    new URL(req.url, "http://localhost").searchParams
                        .get("id")
                        ?.slice(3) ?? row.id;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify([{ ...row, id: requested }]));
            } else {
                unexpected.push(req.url);
                res.writeHead(500).end("Database control access is forbidden");
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
            ETB_CLUSTER_CONFIG: JSON.stringify({
                version: 1,
                servers: urls.map((url, i) => i === 1 ? url + "/ws" : url),
            }),
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
        const processLogs = [];
        const startNode = async (i) => {
            const child = spawn(
                process.execPath,
                ["--import", "tsx", "src/index.ts"],
                {
                    cwd: resolve(root, "backend/server"),
                    env: {
                        ...process.env,
                        ...common,
                        CLUSTER_SERVER_TOKEN: tokens[i],
                        CLUSTER_STATE_DIR: resolve(temp, `node-${i}`),
                        PORT: String(ports[i]),
                        NEXT_PUBLIC_POSTHOG_KEY: "",
                        DOTENV_CONFIG_PATH: resolve(temp, "no-env"),
                    },
                    stdio: ["ignore", "pipe", "pipe"],
                },
            );
            processes.push(child);
            let output = "";
            processLogs.push(() => output);
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
                    CLUSTER: { className: "ClusterDO", useSQLite: true },
                    REPLICAS: { className: "ReplicaDO", useSQLite: true },
                },
                bindings: {
                    ...common,
                    CLUSTER_SERVER_TOKEN: tokens[1],
                },
            }),
        );
        t.after(() => mf.dispose());
        await mf.ready;
        const primary = await startNode(0);
        let render = await startNode(2);
        const clients = [];
        await wait(async () => {
            try {
                const response = await fetch(`${urls[0]}/cluster/route`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jwtToken: roomToken }),
                });
                return (
                    response.ok && (await response.json()).servers.length === 3
                );
            } catch {
                return false;
            }
        }, "authenticated cluster registration");
        // Neither registration nor room reads are callable before peer auth.
        for (const url of urls) {
            const socket = new WebSocket(
                `${url.replace("http", "ws")}/cluster/ws`,
            );
            const replies = [];
            const closed = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    socket.terminate();
                    reject(
                        new Error(
                            "Unauthenticated cluster socket remained open",
                        ),
                    );
                }, 4000);
                socket.on("message", (data) =>
                    replies.push(JSON.parse(data.toString())),
                );
                socket.on("close", () => {
                    clearTimeout(timeout);
                    resolve();
                });
                socket.on("error", reject);
            });
            socket.on("open", () =>
                socket.send(
                    JSON.stringify({
                        type: "rpc",
                        id: "anonymous",
                        op: "status",
                        args: { roomId },
                    }),
                ),
            );
            await closed;
            assert.equal(
                replies.some((message) => message.type === "reply"),
                false,
            );
        }
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
        const nativeTransport = (target, targetRoomId = roomId) => {
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
                `${target.replace("http", "ws")}/${targetRoomId}`,
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
        // The Socket.IO transport drops this ACK once; the routed client
        // must retry the very same command ID, not apply the action twice.
        dropNextAck = true;
        // Explicit room:leave now bypasses game:command so it can remove the
        // player immediately. Use an invalid pre-game success command to
        // exercise retry-stable command IDs without changing room membership.
        routed.emit("word:success");
        await wait(
            () => routedCommands.length >= 2,
            "lost ACK retries the same event ID",
        );
        assert.equal(new Set(routedCommands).size, 1);

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
        const typing = holder === 0 ? p1 : p2;
        typing.send("currentInput", "t");
        typing.send("currentInput", "te");
        typing.send("currentInput", "test");
        await wait(
            () => p1.room.typingFocusInput === "test",
            "coalesced delta over peer WebSockets",
        );
        const healthy = await fetch(`${urls[1]}/cluster/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jwtToken: roomToken,
                sessionToken: observerSession,
                roomId,
                owner: urls[0],
                revision: p1.room.revision,
                failure: true,
            }),
        }).then((response) => response.json());
        assert.equal(
            healthy.ownership.owner,
            urls[0],
            "one report cannot steal a healthy room",
        );
        const unauth = await fetch(`${urls[1]}/cluster/report`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                jwtToken: roomToken,
                sessionToken: "forged",
                roomId,
                owner: urls[0],
                revision: p1.room.revision,
                failure: true,
            }),
        });
        assert.equal(unauth.ok, false);
        await command(holder === 0 ? p1 : p2, holder, "word:success");
        const expected = structuredClone(p1.room);
        const readsBeforeFailover = databaseReads;
        // Give the Worker a chance to receive the confirmed state. Losing
        // the only owner before any checkpoint transfer is unrecoverable.
        await delay(200);
        if (scenario !== "worker") {
            let recoveryFailure;
            let recoveryFailures = 0;
            routed.on("cluster:recovery-failed", (problem) => {
                recoveryFailure = problem;
                recoveryFailures++;
            });
            if (scenario === "render-state-loss") {
                render.kill("SIGKILL");
                await new Promise((resolve) => render.once("exit", resolve));
                await rm(resolve(temp, "node-2"), { recursive: true, force: true });
                render = await startNode(2);
                // Keep the owner alive long enough to send a real signed
                // mirror to the new incarnation. It must never become a vote.
                await delay(6_000);
            }
            await mf.dispose();
            primary.kill("SIGKILL");
            await new Promise((resolve) => primary.once("exit", resolve));
            if (scenario === "render-state-loss") {
                await wait(() => recoveryFailure, "lost voter memory is classified", 30000);
                assert.equal(recoveryFailure.code, "VOTER_STATE_LOST");
                assert.match(processLogs.map((read) => read()).join("\n"),
                    /Cluster \/cluster\/report failed: Ineligible voter or lost process memory/);
                assert.equal(recoveryFailure.retryable, false);
                await delay(2_500);
                assert.equal(recoveryFailures, 1, "unrecoverable reports do not loop");
                assert.equal(routed.connected, false);
                assert.equal(databaseReads, readsBeforeFailover, "never recreate missing game from settings");
                return;
            }
            if (scenario === "render-restart") {
                render.kill("SIGKILL");
                await new Promise((resolve) => render.once("exit", resolve));
                await startNode(2);
            }
            await wait(() => observed?.ownerServerId === urls[2],
                "routed client reaches sole surviving Render", 30000);
            let r1 = await nodeClient(2, 0), r2 = await nodeClient(2, 1);
            await wait(() => !r1.room.migrating, "Render resumes both players");
            assert.equal(r1.room.gameId, expected.gameId);
            assert.equal(r1.room.roomInstanceId, expected.roomInstanceId);
            assert.deepEqual(r1.room.users, expected.users);
            if (scenario === "render-restart") {
                const epoch = observed.epoch;
                const activeRender = processes.at(-1);
                activeRender.kill("SIGKILL");
                await new Promise((resolve) => activeRender.once("exit", resolve));
                await startNode(2);
                await wait(() => observed?.epoch > epoch, "incumbent Render reopens after SIGKILL", 25000);
                r1 = await nodeClient(2, 0);
                r2 = await nodeClient(2, 1);
                await wait(() => !r1.room.migrating, "restarted Render resumes");
                assert.equal(r1.room.gameId, expected.gameId);
                assert.equal(r1.room.roomInstanceId, expected.roomInstanceId);
            }
            const renderTyping = r1.room.bombs[0].holder === 0 ? r1 : r2;
            renderTyping.send("currentInput", "render-solo");
            await wait(() => r2.room.typingFocusInput === "render-solo", "sole Render accepts gameplay input");
            // All actual game transports disappear together. The observer is
            // also closed; a spectator must not be required to retain a match.
            routed.disconnect();
            r1.socket.disconnect();
            r2.socket.disconnect();
            await delay(9_000);
            const returned = await nodeClient(2, 0);
            const returned2 = await nodeClient(2, 1);
            assert.equal(returned.room.isStart, true);
            assert.equal(returned.room.gameId, expected.gameId);
            await startNode(0);
            const route = await fetch(`${urls[0]}/cluster/route`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jwtToken: roomToken }),
            }).then((response) => response.json());
            assert.equal(route.ownership.owner, urls[2], "no automatic failback");
            const staleOwnerSocket = io(urls[0], { transports: ["websocket"], reconnection: false });
            clients.push(staleOwnerSocket);
            let staleOwnerError;
            let staleOwnerSnapshot;
            staleOwnerSocket.on("auth:request", () => staleOwnerSocket.emit("auth:response", {
                jwtToken: roomToken, sessionToken: observerSession, displayName: "Old owner",
            }));
            staleOwnerSocket.on("error", (error) => staleOwnerError = error);
            staleOwnerSocket.on("room:broadcast", (room) => staleOwnerSnapshot = room);
            await wait(() => staleOwnerError, "old owner rejects gameplay authentication");
            assert.equal(staleOwnerSnapshot, undefined);
            staleOwnerSocket.disconnect();
            returned.socket.emit("room:leave");
            await wait(() => returned2.room.users.length === 0 && !returned2.room.isStart,
                "explicit Render leave is broadcast to the other player");
            if (scenario === "render") {
                // Reopening a browser page creates a NEW signed session. Do
                // not accidentally test only a reconnect with the old token.
                await command(returned, 0, "room:join");
                await command(returned2, 1, "room:join");
                await wait(() => returned.room.users.length === 2, "migrated Render lobby seats");
                returned2.socket.disconnect();
                await wait(() => !returned.room.users.some((user) => user.id === players[1]),
                    "closed tab leaves the migrated Render lobby", 3000);
                const reopenedId = randomUUID();
                const reopenedSession = await new SignJWT({ role: "client_session", roomId, sessionId: reopenedId })
                    .setProtectedHeader({ alg: "ES256", kid }).setIssuer("ei-typebomb")
                    .setAudience("ei-typebomb:client-session").setIssuedAt().setExpirationTime("1h").sign(privateKey);
                let reopenedRoom;
                const reopened = new RoutedSocket(urls, nativeTransport, async () => roomToken,
                    () => true, async () => reopenedSession);
                t.after(() => reopened.disconnect());
                reopened.on("auth:request", () => reopened.emit("auth:response", {
                    jwtToken: roomToken, sessionToken: reopenedSession, displayName: "Reopened tab",
                }));
                reopened.on("room:broadcast", (room) => reopenedRoom = room);
                await wait(() => reopenedRoom, "new page authenticates to migrated Render room");
                assert.equal(reopenedRoom.users.some((user) => user.id === players[1]), false);
                assert.equal(reopenedRoom.users.some((user) => user.displayName === "Player 1"), false);
                reopened.emit("room:join");
                await wait(() => reopenedRoom.users.some((user) => user.id === reopenedId && user.displayName === "Reopened tab"),
                    "new page displays only its new name");
                reopened.disconnect();
                await wait(() => returned.room.users.length === 1, "reopened tab also leaves cleanly", 3000);
                returned.socket.disconnect();
                await wait(async () => {
                    const response = await fetch(`${urls[2]}/cluster/route`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ jwtToken: roomToken }),
                    });
                    return response.ok && (await response.json()).ownership?.lifecycle === "DELETED";
                }, "last closed tab retires migrated Render room", 3000);
            }
            // Stop the recovered primary again, leaving Render to create a
            // completely new room from the normal JWT/settings path.
            const recoveredPrimary = processes.at(-1);
            recoveredPrimary.kill("SIGKILL");
            await new Promise((resolve) => recoveredPrimary.once("exit", resolve));
            const freshId = randomUUID();
            const signRoom = (claims, audience) => new SignJWT(claims)
                .setProtectedHeader({ alg: "ES256", kid }).setIssuer("ei-typebomb")
                .setAudience(audience).setIssuedAt().setExpirationTime("1h").sign(privateKey);
            const freshToken = await signRoom({ id: freshId, role: "authenticated" }, "authenticated");
            const freshSession = await signRoom({ roomId: freshId, sessionId: randomUUID(), role: "client_session" }, "ei-typebomb:client-session");
            const readsBeforeMissing = databaseReads;
            const missing = await fetch(`${urls[2]}/cluster/route`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ jwtToken: freshToken, expectedInstance: "previous-instance" }),
            });
            assert.equal(missing.status, 409);
            assert.equal((await missing.json()).code, "CHECKPOINT_UNAVAILABLE");
            assert.equal(databaseReads, readsBeforeMissing);
            let freshRoom;
            const fresh = new RoutedSocket(urls, (target) => nativeTransport(target, freshId),
                async () => freshToken, () => true, async () => freshSession);
            t.after(() => fresh.disconnect());
            fresh.on("auth:request", () => fresh.emit("auth:response", {
                jwtToken: freshToken, sessionToken: freshSession, displayName: "Render only",
            }));
            fresh.on("room:broadcast", (room) => freshRoom = room);
            await wait(() => freshRoom, "fresh room on Render alone", 25000);
            fresh.emit("room:join");
            await wait(() => freshRoom.users.length === 1, "join new room on Render alone");
            assert.equal(freshRoom.ownerServerId, urls[2]);
            const secondSession = await signRoom({ roomId: freshId, sessionId: randomUUID(), role: "client_session" }, "ei-typebomb:client-session");
            let secondRoom;
            const second = new RoutedSocket(urls, (target) => nativeTransport(target, freshId),
                async () => freshToken, () => true, async () => secondSession);
            t.after(() => second.disconnect());
            second.on("auth:request", () => second.emit("auth:response", {
                jwtToken: freshToken, sessionToken: secondSession, displayName: "Second Render player",
            }));
            second.on("room:broadcast", (room) => secondRoom = room);
            await wait(() => secondRoom, "second fresh Render authentication");
            second.emit("room:join");
            await wait(() => freshRoom.users.length === 2, "two fresh Render participants");
            fresh.emit("game:start");
            await wait(() => secondRoom.isStart && secondRoom.bombs?.[0]?.wordIndex !== undefined,
                "new Render-only match is playable");
            if (scenario === "render") {
                // A tab disappearing has no room:leave packet. Close the
                // actual transport and keep the other player watching.
                second.disconnect();
                await delay(1_000);
                assert.equal(freshRoom.isStart, true, "match survives transient disconnect");
                assert.equal(freshRoom.users.length, 2);
                await wait(() => !freshRoom.isStart && freshRoom.users.length === 0,
                    "closed Render game tab expires despite another connected player", 25000);
                fresh.emit("room:join");
                await wait(() => freshRoom.users.length === 1, "remaining player rejoins lobby");
                const revision = secondRoom.revision;
                await second.connect();
                await wait(() => secondRoom.revision > revision, "second tab reauthenticates");
                second.emit("room:join");
                await wait(() => freshRoom.users.length === 2, "second lobby seat");
                second.disconnect();
                await wait(() => freshRoom.users.length === 1,
                    "closed lobby tab is removed immediately", 3000);
                fresh.disconnect();
                await wait(async () => {
                    const response = await fetch(`${urls[2]}/cluster/route`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ jwtToken: freshToken }),
                    });
                    return response.ok && (await response.json()).ownership?.lifecycle === "DELETED";
                }, "closing last lobby tab retires Render room", 3000);
            }
            assert.deepEqual(unexpected, []);
            return;
        }
        render.kill("SIGKILL");
        await new Promise((resolve) => render.once("exit", resolve));
        primary.kill("SIGKILL");
        await new Promise((resolve) => primary.once("exit", resolve));
        await wait(
            () => observed?.ownerServerId === urls[1],
            "client failure report promotes Worker",
            25000,
        );
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
        // Both Node servers are down: the Worker must still accept actual
        // gameplay updates without waiting for sleeping Render.
        const typingWorker = expected.bombs[0].holder === 0 ? w1 : w2;
        typingWorker.send("currentInput", "solo");
        await wait(
            () => w1.room.typingFocusInput === "solo",
            "Worker accepts typing with both Node servers offline",
        );
        // A recovered primary remains unable to recreate this migrated room.
        await startNode(0);
        const route = await fetch(`${urls[0]}/cluster/route`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jwtToken: roomToken }),
        }).then((response) => response.json());
        assert.equal(route.ownership.owner, urls[1]);
        assert.equal(observed.epoch, w1.room.epoch);
        assert.equal(databaseReads, readsBeforeFailover);
        const freshId = randomUUID();
        const freshRoomJwt = await new SignJWT({
            id: freshId,
            role: "authenticated",
        })
            .setProtectedHeader({ alg: "ES256", kid })
            .setIssuer("ei-typebomb")
            .setAudience("authenticated")
            .setIssuedAt()
            .setExpirationTime("1h")
            .sign(privateKey);
        const freshSession = await new SignJWT({
            roomId: freshId,
            sessionId: randomUUID(),
            role: "client_session",
        })
            .setProtectedHeader({ alg: "ES256", kid })
            .setIssuer("ei-typebomb")
            .setAudience("ei-typebomb:client-session")
            .setIssuedAt()
            .setExpirationTime("1h")
            .sign(privateKey);
        // Exercise the production retry path while the restarted primary's
        // authenticated membership links are still converging.
        const freshSocket = new RoutedSocket(
            [urls[0]],
            (target) => nativeTransport(target, freshId),
            async () => freshRoomJwt,
            () => true,
            async () => freshSession,
        );
        t.after(() => freshSocket.disconnect());
        let freshRoom;
        freshSocket.on("auth:request", () =>
            freshSocket.emit("auth:response", {
                jwtToken: freshRoomJwt,
                sessionToken: freshSession,
                displayName: "New room",
            }),
        );
        freshSocket.on("room:broadcast", (room) => (freshRoom = room));
        await wait(() => freshRoom, "new room at recovered primary");
        assert.equal(freshRoom.ownerServerId, urls[0]);

        // The fresh room can also progress without the sleeping Render.
        freshSocket.emit("room:join");
        await wait(
            () => freshRoom?.users?.length === 1,
            "Mac mini + Worker commit a join while Render is asleep",
        );
        freshSocket.emit("room:leave");
        await wait(
            () => freshRoom?.users?.length === 0,
            "Mac mini + Worker commit a leave while Render is asleep",
        );
        freshSocket.disconnect();
        // Explicit leave on the Worker uses the authenticated socket event,
        // not a game:command ACK; it must cancel the active match immediately.
        w1.send("room:leave");
        await wait(
            () => w1.room && !w1.room.isStart && w1.room.users.length === 0,
            "direct Worker leave cancels active match",
        );
        await command(w1, 0, "room:join");
        await command(w2, 1, "room:join");
        await command(w1, 0, "game:start");
        await wait(() => w2.room.bombs?.[0]?.wordIndex !== undefined, "Worker countdown before tab close");
        workerClients[0].close();
        await delay(1_000);
        assert.equal(w2.room.isStart, true, "Worker preserves disconnect grace");
        await wait(() => !w2.room.isStart && w2.room.users.length === 0,
            "closed Worker game tab expires despite connected spectator/player", 25000);
        await command(w2, 1, "room:join");
        await wait(() => w2.room.users.length === 1, "Worker returns to lobby");
        const replacement = await workerClient(0);
        await command(replacement, 0, "room:join");
        await wait(() => w2.room.users.length === 2, "Worker lobby has two players");
        workerClients.at(-1).close();
        await wait(() => w2.room.users.length === 1, "Worker removes closed lobby tab immediately", 3000);
        assert.ok(
            databaseReads > readsBeforeFailover,
            "creating a new room must load its settings",
        );
        assert.deepEqual(
            unexpected,
            [],
            "no database synchronization, RPC, registration or lease requests",
        );
    },
);
