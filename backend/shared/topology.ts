import { parseETBClusterConfig } from "./clusterConfig";
export type TopologyEnv = {
    ETB_CLUSTER_CONFIG?: string;
    PRIMARY_SERVER_URL?: string;
    PARENT_SERVER_URL?: string;
    SERVER_PUBLIC_URL?: string;
    SERVER_NODE_ID?: string;
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
        const selected = env.SERVER_NODE_ID
            ? servers.find(server => server.id === env.SERVER_NODE_ID)
            : undefined;
        if (env.SERVER_NODE_ID && !selected)
            throw new Error("SERVER_NODE_ID is absent from ETB_CLUSTER_CONFIG");
        const explicit = serverUrl(env.SERVER_PUBLIC_URL ?? env.RENDER_EXTERNAL_URL, "SERVER_PUBLIC_URL");
        if (selected && explicit && selected.origin !== explicit)
            throw new Error("SERVER_NODE_ID and SERVER_PUBLIC_URL select different servers");
        const own = selected?.origin ?? explicit
            ?? (candidates.length === 1 ? candidates[0].origin
                : transport === "socket.io" && servers[0].transport === "socket.io" ? primaryUrl : null);
        if (!own) return { role: "standalone", primaryUrl, parentUrl: null, publicUrl: null };
        const index = servers.findIndex(server => server.origin === own);
        if (index < 0) throw new Error("Server identity is absent from ETB_CLUSTER_CONFIG");
        return { role: index === 0 ? "primary" : "replica",
            primaryUrl, parentUrl: index ? servers[index - 1].origin : null, publicUrl: own };
    }
    // Compatibility for existing deployments until all nodes migrate together.
    const primaryUrl = serverUrl(env.PRIMARY_SERVER_URL, "PRIMARY_SERVER_URL");
    const parentUrl = serverUrl(env.PARENT_SERVER_URL, "PARENT_SERVER_URL");
    const publicUrl = serverUrl(env.SERVER_PUBLIC_URL, "SERVER_PUBLIC_URL");
    if (parentUrl && !primaryUrl) throw new Error("PARENT_SERVER_URL requires PRIMARY_SERVER_URL");
    if (parentUrl && publicUrl === parentUrl) throw new Error("Server cannot be its own parent");
    if (parentUrl && publicUrl === primaryUrl) throw new Error("Primary cannot declare a parent");
    if (primaryUrl && !parentUrl && publicUrl && primaryUrl !== publicUrl)
        throw new Error("Only the primary server can omit PARENT_SERVER_URL");
    return { role: !primaryUrl ? "standalone" : parentUrl ? "replica" : "primary",
        primaryUrl, parentUrl, publicUrl };
}
