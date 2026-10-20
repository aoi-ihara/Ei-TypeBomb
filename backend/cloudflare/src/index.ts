import { readLimitedBody } from "../../shared/distributed/replication";
import type { Env } from "./types";
import { clusterConfig } from "../../shared/distributed/control";
import { parseServerTopology } from "../../shared/topology";
// Preserve the existing production Durable Object class namespace.
// Preview deployments continue to use RoomDO directly.
export { RoomDO, RoomDO as GameRoom } from "./RoomDO";
export { ClusterDO, ReplicaDO } from "./ClusterDO";
import { WorkerControl } from "./lib/cluster";

const ROOM_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default {
    async scheduled(_event: ScheduledController, env: Env): Promise<void> {
        if (clusterConfig(env, "websocket"))
            await new WorkerControl(env).register();
    },
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const topology = parseServerTopology(env);
        if (url.pathname === "/health") {
            if (request.method !== "GET")
                return new Response(null, { status: 405 });
            return Response.json(
                { ok: true, role: topology.role },
                { headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-store",
                } },
            );
        }
        if (url.pathname === "/cluster/ws")
            return env.CLUSTER.get(env.CLUSTER.idFromName("server")).fetch(
                request,
            );
        if (
            url.pathname === "/cluster/route" ||
            url.pathname === "/cluster/report"
        ) {
            const cors = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Headers": "content-type",
                "Access-Control-Allow-Methods": "POST",
            };
            if (request.method === "OPTIONS")
                return new Response(null, { status: 204, headers: cors });
            try {
                if (!clusterConfig(env, "websocket"))
                    return new Response(null, { status: 404, headers: cors });
                if (
                    request.method !== "POST" ||
                    Number(request.headers.get("Content-Length") ?? 0) > 8192
                )
                    return new Response(null, { status: 400, headers: cors });
                const { verifyRoomToken } = await import("./lib/auth");
                const body = await readLimitedBody(request, 8192);
                if (body.length > 8192)
                    return new Response(null, { status: 413, headers: cors });
                const data = JSON.parse(body);
                const roomId = await verifyRoomToken(data.jwtToken, env);
                const report = url.pathname.endsWith("report");
                if (data.roomId && data.roomId !== roomId)
                    throw new Error("Wrong room");
                if (report) {
                    const { verifyClientSessionToken } = await import(
                        "./lib/auth"
                    );
                    await verifyClientSessionToken(
                        data.sessionToken,
                        roomId,
                        env,
                    );
                    if (data.failure !== true)
                        throw new Error("Missing report");
                }
                const control = new WorkerControl(env);
                const result = await control.call(report ? "report" : "read", {
                    roomId,
                    owner: data.owner,
                    revision: data.revision,
                });
                if (
                    report &&
                    result.ownership?.owner === control.config.id &&
                    result.ownership.lifecycle === "MIGRATING"
                )
                    await env.ROOMS.get(
                        env.ROOMS.idFromName(roomId),
                    ).resumeMigration(roomId);
                return Response.json(
                    { ownership: result.ownership, servers: result.servers },
                    { headers: cors },
                );
            } catch (error) {
                // Diagnose failed promotion/peer lookups in Worker logs without
                // exposing cluster internals or secrets to unauthenticated clients.
                console.error("Cluster route/report failed:",
                    error instanceof Error ? error.message : "Unknown error");
                return new Response(null, { status: 503, headers: cors });
            }
        }
        const match = /^\/ws\/([^/]+)$/.exec(url.pathname);
        if (!match || (match[1] !== "health" && !ROOM_ID.test(match[1]))) {
            return new Response("Not found", { status: 404 });
        }
        if (
            request.method !== "GET" ||
            request.headers.get("Upgrade")?.toLowerCase() !== "websocket"
        ) {
            return new Response("WebSocket upgrade required", { status: 426 });
        }
        if (env.ALLOWED_ORIGINS) {
            const allowed = env.ALLOWED_ORIGINS.split(",").map((value) =>
                value.trim(),
            );
            const origin = request.headers.get("Origin");
            if (!origin || !allowed.includes(origin)) {
                return new Response("Origin not allowed", { status: 403 });
            }
        }
        const id = env.ROOMS.idFromName(match[1].toLowerCase());
        return env.ROOMS.get(id).fetch(request);
    },
};
