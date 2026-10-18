import { parseServerTopology, type TopologyEnv } from "../topology";
export type ClusterEnv = TopologyEnv & { CLUSTER_SERVER_TOKEN?: string };
export function clusterConfig(
    env: ClusterEnv,
    transport: "socket.io" | "websocket",
) {
    const topology = parseServerTopology(env);
    if (topology.role === "standalone") return null;
    if (!topology.publicUrl || !env.CLUSTER_SERVER_TOKEN)
        throw new Error(
            "Distributed mode requires SERVER_PUBLIC_URL and a signed CLUSTER_SERVER_TOKEN identity bundle (legacy DB tokens are unsupported)",
        );
    for (const value of [
        topology.publicUrl,
        topology.parentUrl,
        topology.primaryUrl,
    ]) {
        if (
            value &&
            (new URL(value).origin !== value ||
                (new URL(value).protocol !== "https:" &&
                    !["localhost", "127.0.0.1"].includes(
                        new URL(value).hostname,
                    )))
        )
            throw new Error("Cluster requires HTTPS origins");
    }
    return {
        id: topology.publicUrl,
        parent: topology.parentUrl,
        primary: topology.primaryUrl!,
        transport,
    };
}
