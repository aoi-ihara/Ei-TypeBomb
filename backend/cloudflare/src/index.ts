import type { Env } from "./types";
import { parseServerTopology } from "../../shared/topology";
// Preserve the existing production Durable Object class namespace.
// Preview deployments continue to use RoomDO directly.
export { RoomDO, RoomDO as GameRoom } from "./RoomDO";

const ROOM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const topology = parseServerTopology(env);
        if (url.pathname === "/health") {
            return Response.json({ ok: true, role: topology.role });
        }
        const match = /^\/ws\/([^/]+)$/.exec(url.pathname);
        if (!match || (match[1] !== "health" && !ROOM_ID.test(match[1]))) {
            return new Response("Not found", { status: 404 });
        }
        if (request.method !== "GET" ||
            request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
            return new Response("WebSocket upgrade required", { status: 426 });
        }
        if (env.ALLOWED_ORIGINS) {
            const allowed = env.ALLOWED_ORIGINS.split(",").map(value => value.trim());
            const origin = request.headers.get("Origin");
            if (!origin || !allowed.includes(origin)) {
                return new Response("Origin not allowed", { status: 403 });
            }
        }
        const id = env.ROOMS.idFromName(match[1].toLowerCase());
        return env.ROOMS.get(id).fetch(request);
    },
};
