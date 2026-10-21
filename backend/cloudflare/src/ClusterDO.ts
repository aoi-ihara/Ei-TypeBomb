import { DurableObject } from "cloudflare:workers";
import { PeerControl, type VoteRecord } from "../../shared/distributed/peers";
import { Identity, type Member } from "../../shared/distributed/identity";
import { parseETBClusterConfig } from "../../shared/clusterConfig";
import { clusterConfig, assertClusterIdentity } from "../../shared/distributed/control";
import { bufferPeerSocket, type ClusterSocket } from "../../shared/distributed/link";
import type { Env } from "./types";
import { replicaObjectName } from "./lib/namespace";
/** A per-room storage atom. It never advances games or initiates ownership. */
export class ReplicaDO extends DurableObject<Env> {
    async load(): Promise<VoteRecord | undefined> {
        return this.ctx.storage.get("vote");
    }
    async save(record: VoteRecord): Promise<void> {
        await this.ctx.storage.put("vote", record);
    }
}
/** Server-level transport/registry only; game/vote persistence is sharded into
 * ReplicaDOs. Outgoing WebSockets intentionally use the standard (nonhibernating)
 * API; this has duration cost documented in DISTRIBUTED.md. */
export class ClusterDO extends DurableObject<Env> {
    private ready: Promise<PeerControl>;
    constructor(ctx: DurableObjectState, env: Env) {
        super(ctx, env);
        this.ready = ctx.blockConcurrencyWhile(async () => {
            const config = clusterConfig(env, "websocket");
            if (!config) throw new Error("Cluster disabled");
            const boot =
                (await ctx.storage.get<string>("boot")) ?? crypto.randomUUID();
            const servers = parseETBClusterConfig(env.ETB_CLUSTER_CONFIG!);
            const declaration = await Identity.generate(servers, config.id);
            const identity = await Identity.create(declaration, boot);
            assertClusterIdentity(env, identity);
            // This Durable Object is already scoped to the current topology.
            // Keep only the incarnation; never store or inspect old config.
            await ctx.storage.put("boot", boot);
            const peer = new PeerControl(
                identity,
                config,
                async (id) => {
                    const url = new URL("/cluster/ws", id);
                    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
                    const ws = new WebSocket(url.toString());
                    const buffered = bufferPeerSocket(ws);
                    await new Promise<void>((resolve, reject) => {
                        const timer = setTimeout(() => {
                            ws.close();
                            reject(new Error("Peer timeout"));
                        }, 1500);
                        ws.addEventListener("open", () => {
                            clearTimeout(timer);
                            resolve();
                        });
                        ws.addEventListener("error", () => {
                            clearTimeout(timer);
                            reject(new Error("Peer connection failed"));
                        });
                    });
                    return buffered;
                },
                {
                    load: async (room) =>
                        env.REPLICAS.get(env.REPLICAS.idFromName(await replicaObjectName(env, room))).load(),
                    save: async (room, state) =>
                        env.REPLICAS.get(env.REPLICAS.idFromName(await replicaObjectName(env, room))).save(
                            state,
                        ),
                    registry: (members) => ctx.storage.put("registry", members),
                },
            );
            peer.draining = env.CLUSTER_DRAINING === "true";
            await peer.restoreRegistry((await ctx.storage.get<Member[]>("registry")) ?? []);
            return peer;
        });
        // Network registration starts after local initialization, outside the
        // constructor's concurrency gate, and cannot block incoming peer links.
        ctx.waitUntil(
            this.ready.then((peer) => peer.register()).then(() => {}),
        );
    }
    async invoke(op: string, args: Record<string, unknown> = {}) {
        return (await this.ready).call(op, args);
    }
    async fetch(request: Request): Promise<Response> {
        if (new URL(request.url).pathname === "/cluster/identity") {
            if (request.method !== "GET") return new Response(null, { status: 405 });
            return Response.json((await this.ready).identity.publicIdentity(),
                { headers: { "Cache-Control": "no-store" } });
        }
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
            return new Response(null, { status: 426 });
        const peer = await this.ready;
        const [client, server] = Object.values(new WebSocketPair());
        server.accept();
        void peer
            .accept(server as unknown as ClusterSocket)
            .catch(() => server.close(1008, "Cluster handshake failed"));
        return new Response(null, { status: 101, webSocket: client });
    }
}
