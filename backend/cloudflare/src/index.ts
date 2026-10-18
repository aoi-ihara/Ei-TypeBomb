import { readLimitedBody } from "../../shared/distributed/replication";
import type { Env } from "./types";
import { clusterConfig, HttpControl } from "../../shared/distributed/control";
import { parseServerTopology } from "../../shared/topology";
// Preserve the existing production Durable Object class namespace.
// Preview deployments continue to use RoomDO directly.
export { RoomDO, RoomDO as GameRoom } from "./RoomDO";

const ROOM_ID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default {
    async scheduled(_event: ScheduledController, env: Env): Promise<void> {
        if (clusterConfig(env, "websocket"))
            await new HttpControl(env, "websocket").register();
    },
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const topology = parseServerTopology(env);
        if (url.pathname === "/health") {
            return Response.json({ ok: true, role: topology.role });
        }
        if (url.pathname === "/cluster/route") {
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
                const roomId = await verifyRoomToken(
                    JSON.parse(body).jwtToken,
                    env,
                );
                const control = new HttpControl(env, "websocket");
                await control.register();
                const result = await control.call("read", { roomId });
                return Response.json(
                    { ownership: result.ownership, servers: result.servers },
                    { headers: cors },
                );
            } catch {
                return new Response(null, { status: 503, headers: cors });
            }
        }
        if (
            url.pathname === "/internal/replicate" &&
            request.method === "POST"
        ) {
            if (!clusterConfig(env, "websocket"))
                return new Response(null, { status: 404 });
            // Route an opaque notification to the room object. Authentication is
            // performed against the durable receipt before any state is stored.
            const authorization = request.headers.get("Authorization");
            if (
                !authorization?.startsWith("Bearer ") ||
                authorization.length > 2048
            )
                return new Response(null, { status: 403 });
            try {
                const copy = await readLimitedBody(request, 524288);
                const roomId = JSON.parse(copy).roomId;
                if (typeof roomId !== "string" || !ROOM_ID.test(roomId))
                    return new Response(null, { status: 400 });
                return env.ROOMS.get(
                    env.ROOMS.idFromName(roomId.toLowerCase()),
                ).fetch(
                    new Request(request.url, {
                        method: "POST",
                        headers: request.headers,
                        body: copy,
                    }),
                );
            } catch (error) {
                return new Response(null, {
                    status: error instanceof RangeError ? 413 : 400,
                });
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
