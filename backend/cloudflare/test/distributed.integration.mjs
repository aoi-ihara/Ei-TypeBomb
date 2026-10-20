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
import { chromium } from "playwright";
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

for (const scenario of ["worker", "render", "render-restart", "render-state-loss", "fallback5-reopen", "browser-close-render", "browser-close-worker", "browser-close-fallback5"]) test(
    `real Socket.IO → workerd → Socket.IO failover: ${scenario}`,
    { timeout: 180000 },
    async (t) => {
        const temp = await mkdtemp(resolve(tmpdir(), "etb-workerd-"));
        t.after(() => rm(temp, { recursive: true, force: true }));
        const fallbackIndex = ["fallback5-reopen", "browser-close-fallback5"].includes(scenario) ? 6 : 2;
        const ports = await Promise.all(Array.from({ length: fallbackIndex + 1 }, () => freePort()));
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
            max_players: scenario === "fallback5-reopen" ? 2 : 6,
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
        let browserBundle;
        const broker = createServer((req, res) => {
            if (req.url === "/test/browser.js") {
                res.setHeader("Content-Type", "text/javascript");
                res.end(browserBundle);
                return;
            }
            if (req.url === "/test/browser") {
                res.setHeader("Content-Type", "text/html");
                res.end('<!doctype html><title>Real game transport test</title><button onclick="gameSocket.emit(\'room:join\')">Join</button><button onclick="gameSocket.emit(\'game:start\')">Start</button><pre id="state"></pre><script src="/test/browser.js"></script>');
                return;
            }
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
        t.after(() => new Promise((resolve) => { broker.closeAllConnections(); broker.close(resolve); }));
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
        let render = await startNode(fallbackIndex);
        const intermediates = [];
        for (let i = 2; i < fallbackIndex; i++) intermediates.push(await startNode(i));
        const clients = [];
        await wait(async () => {
            try {
                const response = await fetch(`${urls[0]}/cluster/route`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ jwtToken: roomToken }),
                });
                return (
                    response.ok && (await response.json()).servers.length === urls.length
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

        if (scenario.startsWith("browser-close-")) {
            routed.closePage();
            routed.disconnect();
            await delay(200);
            const bundle = await build({
                entryPoints: [resolve(root, "backend/cloudflare/test/browserGameClient.mjs")],
                bundle: true, platform: "browser", format: "iife", write: false,
            });
            browserBundle = bundle.outputFiles[0].text;
            const browser = await chromium.launch({ headless: true });
            t.after(() => browser.close());
            const context = await browser.newContext();
            context.setDefaultTimeout(10000);
            const pages = await Promise.all([context.newPage(), context.newPage()]);
            const openPage = async (page, player, sessionToken = sessions[player]) => {
                await page.goto(`${api}/test/browser`);
                await page.evaluate((config) => window.boot(config), {
                    urls, roomId, jwtToken: roomToken, sessionToken, name: `Browser ${player}`,
                });
                await page.waitForFunction(() => !!window.room, null, { timeout: 10000 }).catch(async (error) => {
                    throw new Error(`${error.message}; browser errors=${JSON.stringify(await page.evaluate(() => window.errors))}`);
                });
            };
            await Promise.all(pages.map((page, i) => openPage(page, i)));
            for (const page of pages) await page.getByRole("button", { name: "Join", exact: true }).click();
            await pages[0].waitForFunction(() => window.room.users.length === 2);
            await pages[0].getByRole("button", { name: "Start", exact: true }).click();
            await pages[0].waitForFunction(() => window.room.isStart && window.room.bombs?.[0]?.wordIndex !== undefined);
            const gameId = await pages[0].evaluate(() => window.room.gameId);
            await delay(300);
            const workerOwner = scenario.endsWith("worker");
            if (!workerOwner) {
                await mf.dispose();
                await Promise.all(processes.slice(2).map(child => {
                    child.kill("SIGKILL");
                    return new Promise(resolve => child.once("exit", resolve));
                }));
            }
            primary.kill("SIGKILL");
            await new Promise(resolve => primary.once("exit", resolve));
            if (workerOwner) {
                render.kill("SIGKILL");
                await new Promise(resolve => render.once("exit", resolve));
            }
            for (const page of pages) await page.waitForFunction(({owner, gameId}) =>
                window.room?.ownerServerId === owner && !window.room.migrating && window.room.gameId === gameId,
                {owner: urls[workerOwner ? 1 : fallbackIndex], gameId}, { timeout: 30000 });
            const oldConnectionId = await pages[0].evaluate(() => window.gameSocket.id);
            const beforeReconnect = await pages[0].evaluate(() => window.authentications);
            await pages[0].evaluate(() => window.gameSocket.transport.disconnect());
            await pages[0].waitForFunction(({count,gameId}) => window.authentications > count &&
                window.room.isStart && !window.room.migrating && window.room.gameId === gameId,
                {count:beforeReconnect,gameId}, {timeout:10000});
            const oldInstance = await pages[0].evaluate(() => window.room.roomInstanceId);
            const leaveEndpoint = `${urls[workerOwner ? 1 : fallbackIndex]}/cluster/leave`;
            for (const invalid of [
                {sessionToken:"forged",expectedInstance:oldInstance},
                {sessionToken:roomToken,expectedInstance:oldInstance},
                {sessionToken:sessions[0]},
                {sessionToken:sessions[0],expectedInstance:randomUUID()},
                {sessionToken:sessions[0],expectedInstance:oldInstance,connectionId:oldConnectionId},
            ]) {
                const response = await fetch(leaveEndpoint,{method:"POST",headers:{"Content-Type":"text/plain"},
                    body:JSON.stringify({jwtToken:roomToken,connectionId:await pages[0].evaluate(() => window.gameSocket.id),...invalid})});
                assert.equal(response.ok,false,"forged/stale exit must be rejected");
            }
            assert.equal(await pages[1].evaluate(() => window.room.gameId),gameId);
            assert.equal(await pages[1].evaluate(() => window.room.isStart),true);
            // Closing a real Chromium tab must retire its seat, even in a match.
            // Deliberately lose the WebSocket leave packet: the HTTP beacon
            // must still retire the seat before the 20s recovery grace.
            await pages[0].evaluate(() => {
                const transport = window.gameSocket.transport, emit = transport.emit.bind(transport);
                transport.emit = (event, data) => event === "room:leave" ? transport : emit(event, data);
            });
            pages[0].on("request", request => { if (request.url().endsWith("/cluster/leave")) t.diagnostic("Closing page sent authenticated exit beacon"); });
            await pages[0].close({ runBeforeUnload: true });
            await pages[1].waitForFunction(id => !window.room.users.some(user => user.id === id), players[0], { timeout: 3000 });
            assert.equal(await pages[1].evaluate(() => window.room.isStart), false);
            console.log(`Browser ${scenario}: tab closed and seat removed`);
            // Reopen with a NEW page identity: old seats cannot be hidden by reconnecting.
            const replacementId = randomUUID();
            const replacementToken = await new SignJWT({role:"client_session", roomId, sessionId:replacementId})
                .setProtectedHeader({alg:"ES256",kid}).setIssuer("ei-typebomb").setAudience("ei-typebomb:client-session")
                .setIssuedAt().setExpirationTime("1h").sign(privateKey);
            await pages[1].getByRole("button", {name:"Join",exact:true}).click();
            let replacement = await context.newPage();
            await openPage(replacement, 0, replacementToken);
            await replacement.getByRole("button", {name:"Join", exact:true}).click();
            await pages[1].waitForFunction(id => window.room.users.some(user => user.id === id), replacementId);
            // A cached/restored page may keep the same authenticated socket.
            // HTTP exit must allow that connection to rejoin without reauth.
            const liveExit = await fetch(leaveEndpoint,{method:"POST",headers:{"Content-Type":"text/plain"},
                body:JSON.stringify({jwtToken:roomToken,sessionToken:replacementToken,expectedInstance:oldInstance,
                    connectionId:await replacement.evaluate(() => window.gameSocket.id)})});
            assert.equal(liveExit.ok,true);
            await pages[1].waitForFunction(id => !window.room.users.some(user => user.id === id),replacementId,{timeout:3000});
            await replacement.getByRole("button",{name:"Join",exact:true}).click();
            await pages[1].waitForFunction(id => window.room.users.some(user => user.id === id),replacementId,{timeout:3000});
            // Lobby close is also immediate, without ending the surviving seat.
            await replacement.close({runBeforeUnload:true});
            await pages[1].waitForFunction(id => !window.room.users.some(user => user.id === id),replacementId,{timeout:3000});
            assert.equal(await pages[1].evaluate(id => window.room.users.some(user => user.id === id),players[1]),true);
            replacement = await context.newPage();
            const nextId = randomUUID();
            const nextToken = await new SignJWT({role:"client_session",roomId,sessionId:nextId})
                .setProtectedHeader({alg:"ES256",kid}).setIssuer("ei-typebomb").setAudience("ei-typebomb:client-session")
                .setIssuedAt().setExpirationTime("1h").sign(privateKey);
            await openPage(replacement,0,nextToken);
            await replacement.getByRole("button",{name:"Join",exact:true}).click();
            await pages[1].waitForFunction(() => window.room.users.length === 2);
            await pages[1].getByRole("button", {name:"Start", exact:true}).click();
            await pages[1].waitForFunction(() => window.room.isStart && window.room.bombs?.[0]?.wordIndex !== undefined);
            // Close the whole room, then create and play a fresh instance with the same room URL.
            await replacement.close({ runBeforeUnload: true });
            await pages[1].close({ runBeforeUnload: true });
            console.log(`Browser ${scenario}: all player tabs closed`);
            const endpoint = `${urls[workerOwner ? 1 : fallbackIndex]}/cluster/route`;
            await wait(async () => (await fetch(endpoint, {method:"POST", headers:{"Content-Type":"application/json"},
                body:JSON.stringify({jwtToken:roomToken})}).then(r=>r.json())).ownership?.lifecycle === "DELETED", "browser close tombstone", 4000);
            console.log(`Browser ${scenario}: certified tombstone observed`);
            if (!workerOwner) {
                render.kill("SIGKILL");
                await new Promise(resolve => render.once("exit",resolve));
                render = await startNode(fallbackIndex);
            }
            const freshIds = [];
            const freshPages = await Promise.all([context.newPage(), context.newPage()]);
            for (let i=0;i<2;i++) {
                const sessionId = randomUUID();
                freshIds.push(sessionId);
                const token = await new SignJWT({role:"client_session",roomId,sessionId})
                    .setProtectedHeader({alg:"ES256",kid}).setIssuer("ei-typebomb").setAudience("ei-typebomb:client-session")
                    .setIssuedAt().setExpirationTime("1h").sign(privateKey);
                await openPage(freshPages[i], i, token);
                await freshPages[i].getByRole("button", {name:"Join", exact:true}).click();
            }
            await freshPages[0].waitForFunction(() => window.room.users.length === 2);
            await freshPages[0].getByRole("button", {name:"Start", exact:true}).click();
            await freshPages[0].waitForFunction(() => window.room.isStart && window.room.bombs?.[0]?.wordIndex !== undefined);
            const replay = await fetch(leaveEndpoint,{method:"POST",headers:{"Content-Type":"text/plain"},
                body:JSON.stringify({jwtToken:roomToken,sessionToken:sessions[0],expectedInstance:oldInstance,connectionId:oldConnectionId})});
            assert.equal(replay.ok,false,"a delayed old-page exit must not affect the new room instance");
            const activeRoom = await freshPages[0].evaluate(() => window.room);
            const turn = activeRoom.bombs[0].turn;
            const answering = freshIds.indexOf(activeRoom.users[activeRoom.bombs[0].holder].id);
            await freshPages[answering].evaluate(() => window.gameSocket.emit("word:success"));
            await freshPages[0].waitForFunction(turn => window.room.bombs[0].turn > turn,turn);
            assert.notEqual(activeRoom.roomInstanceId,oldInstance);
            for (const page of freshPages) assert.deepEqual(await page.evaluate(() => window.errors), []);
            return;
        }

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
            for (const child of intermediates) {
                child.kill("SIGKILL");
                await new Promise((resolve) => child.once("exit", resolve));
            }
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
            await wait(() => observed?.ownerServerId === urls[fallbackIndex],
                "routed client reaches sole surviving Render", 30000);
            let r1 = await nodeClient(fallbackIndex, 0), r2 = await nodeClient(fallbackIndex, 1);
            await wait(() => !r1.room.migrating, "Render resumes both players");
            assert.equal(r1.room.gameId, expected.gameId);
            assert.equal(r1.room.roomInstanceId, expected.roomInstanceId);
            assert.deepEqual(r1.room.users, expected.users);
            if (scenario === "fallback5-reopen") {
                routed.disconnect();
                let openPages = [r1.socket, r2.socket];
                let lastPages;
                for (const cycle of [0, 1]) {
                    const closedAt = Date.now();
                    openPages.forEach((socket) => socket.disconnect());
                    const history = [];
                    const newIds = [randomUUID(), randomUUID()];
                    const pages = await Promise.all(newIds.map(async (id, i) => {
                        const session = await new SignJWT({ role: "client_session", roomId, sessionId: id })
                            .setProtectedHeader({ alg: "ES256", kid }).setIssuer("ei-typebomb")
                            .setAudience("ei-typebomb:client-session").setIssuedAt().setExpirationTime("1h").sign(privateKey);
                        const socket = new RoutedSocket(urls, nativeTransport, async () => roomToken,
                            () => true, async () => session);
                        t.after(() => socket.disconnect());
                        const page = { socket, room: null, authenticated: false };
                        socket.on("auth:request", () => socket.emit("auth:response", {
                            jwtToken: roomToken, sessionToken: session, displayName: `Reopened ${cycle}-${i}`,
                        }));
                        socket.on("auth:session", () => page.authenticated = true);
                        socket.on("room:broadcast", (room) => {
                            page.room = room;
                            const previous = history.findLast((entry) => entry.page === i);
                            if (!previous || previous.epoch !== room.epoch || previous.revision !== room.revision ||
                                previous.migrating !== room.migrating)
                                history.push({ ms: Date.now() - closedAt, page: i,
                                    migrating: room.migrating, epoch: room.epoch, revision: room.revision,
                                    users: room.users.map((user) => user.displayName) });
                        });
                        return page;
                    }));
                    await wait(() => pages.every((page) => page.authenticated && page.room),
                        "new browser sessions authenticate at fallback 5", 20000);
                    pages.forEach((page) => page.socket.emit("room:join"));
                    if (cycle === 1) {
                        // Recreating the owner runtime while waiting must not
                        // extend the original reconnect deadline indefinitely.
                        await delay(Math.max(0, closedAt + 10_000 - Date.now()));
                        render.kill("SIGKILL");
                        await new Promise((resolve) => render.once("exit", resolve));
                        render = await startNode(fallbackIndex);
                    }
                    try {
                        await wait(() => pages.every((page) => page.room && !page.room.migrating &&
                            page.room.users.length === 2 && page.room.users.every((user) => newIds.includes(user.id))),
                            `fallback 5 new sessions leave migration wait, cycle ${cycle}`,
                            Math.max(1000, closedAt + 26_000 - Date.now()));
                    } catch (error) {
                        throw new Error(`${error.message}\n${JSON.stringify(history)}`);
                    }
                    pages[0].socket.emit("game:start");
                    await wait(() => pages.every((page) => page.room.isStart && page.room.bombs?.[0]?.wordIndex !== undefined),
                        "new fallback 5 participants actually start a new playable match", 8000);
                    const beforeTurn = pages[0].room.bombs[0].turn;
                    const holderId = pages[0].room.users[pages[0].room.bombs[0].holder].id;
                    pages[newIds.indexOf(holderId)].socket.emit("word:success");
                    await wait(() => pages.every((page) => page.room.bombs[0].turn > beforeTurn),
                        "new fallback 5 match accepts a real answer", 5000);
                    openPages = pages.map((page) => page.socket);
                    lastPages = pages;
                }
                // An authenticated explicit exit while all players are paused
                // must make the room joinable immediately, without waiting 20s.
                openPages.forEach((socket) => socket.disconnect());
                lastPages[0].authenticated = false;
                lastPages[0].socket.emit("room:leave");
                await lastPages[0].socket.connect();
                await wait(() => lastPages[0].authenticated && !lastPages[0].room.migrating &&
                    !lastPages[0].room.isStart, "fallback 5 exit clears reconnect wait immediately", 8000);
                lastPages[0].socket.emit("room:join");
                await wait(() => lastPages[0].room.users.length === 1, "fallback 5 lobby accepts a new join");
                await lastPages[1].socket.connect();
                await wait(() => {
                    lastPages[1].socket.emit("room:join");
                    return lastPages[0].room.users.length === 2;
                }, "fill the old lobby before restoring it", 8000);
                const lobbyEpoch = lastPages[0].room.epoch;
                render.kill("SIGKILL");
                lastPages.forEach((page) => page.socket.disconnect());
                await new Promise((resolve) => render.once("exit", resolve));
                render = await startNode(fallbackIndex);
                // All replacement pages have NEW identities: reusing the old
                // sessions would hide ghost seats by reconnecting them.
                const replacementIds = [randomUUID(), randomUUID()];
                const replacements = await Promise.all(replacementIds.map(async (id, i) => {
                    const session = await new SignJWT({ role: "client_session", roomId, sessionId: id })
                        .setProtectedHeader({ alg: "ES256", kid }).setIssuer("ei-typebomb")
                        .setAudience("ei-typebomb:client-session").setIssuedAt().setExpirationTime("1h").sign(privateKey);
                    const socket = new RoutedSocket(urls, nativeTransport, async () => roomToken,
                        () => true, async () => session);
                    t.after(() => socket.disconnect());
                    const page = { socket, room: null, authenticated: false };
                    socket.on("auth:request", () => socket.emit("auth:response", {
                        jwtToken: roomToken, sessionToken: session, displayName: `Replacement ${i}`,
                    }));
                    socket.on("auth:session", () => page.authenticated = true);
                    socket.on("room:broadcast", (room) => page.room = room);
                    return page;
                }));
                await wait(() => replacements.every((page) => page.authenticated && page.room &&
                    page.room.epoch > lobbyEpoch && !page.room.migrating),
                    "new identities authenticate to the restored full lobby", 10000);
                replacements.forEach((page) => assert.deepEqual(page.room.users, [], "no old seats when wait clears"));
                replacements.forEach((page) => page.socket.emit("room:join"));
                await wait(() => replacements.every((page) => page.room.users.length === 2 &&
                    page.room.users.every((user) => replacementIds.includes(user.id))),
                    "both replacements join without waiting for ghost-seat expiry", 3000);
                replacements[0].socket.emit("game:start");
                await wait(() => replacements.every((page) => page.room.isStart &&
                    page.room.bombs?.[0]?.wordIndex !== undefined), "play a match after lobby restoration", 8000);
                const replacementGameId = replacements[0].room.gameId;
                await delay(21_000);
                replacements.forEach((page) => {
                    assert.equal(page.room.isStart, true, "old session expiry must not cancel replacement match");
                    assert.equal(page.room.gameId, replacementGameId);
                    assert.ok(page.room.users.every((user) => replacementIds.includes(user.id)));
                });
                const turn = replacements[0].room.bombs[0].turn;
                const holder = replacements[0].room.users[replacements[0].room.bombs[0].holder].id;
                replacements[replacementIds.indexOf(holder)].socket.emit("word:success");
                await wait(() => replacements.every((page) => page.room.bombs[0].turn > turn),
                    "replacement match still accepts answers after old expiry", 5000);
                assert.deepEqual(unexpected, []);
                return;
            }
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
        const activeAgain = await workerClient(0);
        await command(activeAgain, 0, "room:join");
        await command(w2, 1, "game:start");
        await wait(() => w2.room.bombs?.[0]?.wordIndex !== undefined, "Worker match before paused exit");
        workerClients.at(-1).close();
        workerClients[1].close();
        const exiting = await workerClient(0);
        assert.equal(exiting.room.migrating, true);
        exiting.send("room:leave");
        await wait(() => !exiting.room.migrating && !exiting.room.isStart,
            "Worker exit clears paused match barrier immediately", 3000);
        await command(exiting, 0, "room:join");
        assert.equal(exiting.room.users.length, 1);
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
