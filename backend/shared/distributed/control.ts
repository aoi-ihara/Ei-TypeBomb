import { parseServerTopology, type TopologyEnv } from "../topology";
import { parseETBClusterConfig } from "../clusterConfig";
export type ClusterEnv = TopologyEnv & { CLUSTER_SERVER_TOKEN?: string };
export function clusterConfig(env: ClusterEnv, transport: "socket.io" | "websocket") {
    const topology = parseServerTopology(env);
    if (topology.role === "standalone") {
        if (env.ETB_CLUSTER_CONFIG !== undefined)
            throw new Error("ETB_CLUSTER_CONFIG requires a per-server CLUSTER_SERVER_TOKEN");
        return null;
    }
    if (!topology.publicUrl || !env.CLUSTER_SERVER_TOKEN)
        throw new Error("Distributed mode requires a signed CLUSTER_SERVER_TOKEN identity bundle");
    if (env.ETB_CLUSTER_CONFIG !== undefined) {
        const servers = parseETBClusterConfig(env.ETB_CLUSTER_CONFIG);
        const me = servers.find(s => s.origin === topology.publicUrl);
        if (!me || me.transport !== transport)
            throw new Error("Cluster transport does not match ETB_CLUSTER_CONFIG (/ws marks Workers)");
    }
    for (const value of [topology.publicUrl, topology.parentUrl, topology.primaryUrl])
        if (value && (new URL(value).origin !== value ||
            (new URL(value).protocol !== "https:" &&
                !["localhost", "127.0.0.1"].includes(new URL(value).hostname))))
            throw new Error("Cluster requires HTTPS origins");
    return { id: topology.publicUrl, parent: topology.parentUrl,
        primary: topology.primaryUrl!, transport };
}
