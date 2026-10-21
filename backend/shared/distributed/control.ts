import { parseServerTopology, type TopologyEnv } from "../topology";
import { parseETBClusterConfig } from "../clusterConfig";
export type ClusterEnv = TopologyEnv;
export function clusterConfig(
    env: ClusterEnv,
    transport: "socket.io" | "websocket",
) {
    const topology = parseServerTopology(env, transport);
    if (topology.role === "standalone") {
        if (env.ETB_CLUSTER_CONFIG !== undefined)
            throw new Error(
                "Set SERVER_PUBLIC_URL to select this server from ETB_CLUSTER_CONFIG (Render uses RENDER_EXTERNAL_URL automatically)",
            );
        return null;
    }
    if (!topology.publicUrl || !env.ETB_CLUSTER_CONFIG)
        throw new Error(
            "Distributed mode requires ETB_CLUSTER_CONFIG and SERVER_PUBLIC_URL",
        );
    if (env.ETB_CLUSTER_CONFIG !== undefined) {
        const servers = parseETBClusterConfig(env.ETB_CLUSTER_CONFIG);
        const me = servers.find((s) => s.origin === topology.publicUrl);
        if (!me || me.transport !== transport)
            throw new Error(
                "Cluster transport does not match ETB_CLUSTER_CONFIG (/ws marks Workers)",
            );
    }
    for (const value of [
        topology.publicUrl,
        topology.parentUrl,
        topology.primaryUrl,
    ])
        if (
            value &&
            (new URL(value).origin !== value ||
                (new URL(value).protocol !== "https:" &&
                    !["localhost", "127.0.0.1"].includes(
                        new URL(value).hostname,
                    )))
        )
            throw new Error("Cluster requires HTTPS origins");
    return {
        id: topology.publicUrl,
        parent: topology.parentUrl,
        primary: topology.primaryUrl!,
        transport,
    };
}

// Validate only public configuration consistency; this does not authenticate a peer.
export function assertClusterIdentity(
    env: ClusterEnv,
    identity: {
        member: {
            id: string;
            parent: string | null;
            depth: number;
            transport: "socket.io" | "websocket";
            roster: string[];
        };
    },
): void {
    if (env.ETB_CLUSTER_CONFIG === undefined) return;
    const servers = parseETBClusterConfig(env.ETB_CLUSTER_CONFIG);
    const origins = servers.map((s) => s.origin);
    const depth = origins.indexOf(identity.member.id);
    if (
        depth < 0 ||
        depth !== identity.member.depth ||
        identity.member.parent !== (origins[depth - 1] ?? null) ||
        identity.member.transport !== servers[depth].transport ||
        JSON.stringify(identity.member.roster) !== JSON.stringify(origins)
    )
        throw new Error(
            "Cluster declaration does not match ETB_CLUSTER_CONFIG",
        );
}
