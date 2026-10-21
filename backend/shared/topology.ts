import { parseETBClusterConfig } from "./clusterConfig";
export type TopologyEnv = {
    ETB_CLUSTER_CONFIG?: string;
    SERVER_PUBLIC_URL?: string;
    RENDER_EXTERNAL_URL?: string;
};
export type ServerTopology = {
    role: "standalone" | "primary" | "replica";
    primaryUrl: string | null;
    parentUrl: string | null;
    publicUrl: string | null;
};
function serverUrl(value: string | undefined, key: string): string | null {
    if (!value?.trim()) return null;
    let parsed: URL;
    try { parsed = new URL(value.trim()); }
    catch { throw new Error(`${key} must be an absolute http(s) URL`); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username ||
        parsed.password || parsed.search || parsed.hash)
        throw new Error(`${key} must be an http(s) URL without credentials or query parameters`);
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}
export function parseServerTopology(env: TopologyEnv, transport?: "socket.io" | "websocket"): ServerTopology {
    if (env.ETB_CLUSTER_CONFIG !== undefined) {
        const servers = parseETBClusterConfig(env.ETB_CLUSTER_CONFIG);
        const primaryUrl = servers[0].origin;
        const candidates = servers.filter(server => server.transport === transport);
        const own = serverUrl(env.SERVER_PUBLIC_URL ?? env.RENDER_EXTERNAL_URL, "SERVER_PUBLIC_URL")
            ?? (candidates.length === 1 ? candidates[0].origin
                : transport === "socket.io" && servers[0].transport === "socket.io" ? primaryUrl : null);
        if (!own) return { role: "standalone", primaryUrl, parentUrl: null, publicUrl: null };
        const index = servers.findIndex(server => server.origin === own);
        if (index < 0) throw new Error("Server identity is absent from ETB_CLUSTER_CONFIG");
        return { role: index === 0 ? "primary" : "replica",
            primaryUrl, parentUrl: index ? servers[index - 1].origin : null, publicUrl: own };
    }
    // No implicit legacy PRIMARY_SERVER_URL/PARENT_SERVER_URL topology.
    // Without the current cluster JSON this process runs standalone.
    return { role: "standalone", primaryUrl: null, parentUrl: null, publicUrl: null };
}
