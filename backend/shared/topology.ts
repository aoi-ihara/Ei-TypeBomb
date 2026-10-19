import { parseETBClusterConfig } from "./clusterConfig";
export type TopologyEnv = {
    ETB_CLUSTER_CONFIG?: string;
    CLUSTER_SERVER_TOKEN?: string;
    PRIMARY_SERVER_URL?: string;
    PARENT_SERVER_URL?: string;
    SERVER_PUBLIC_URL?: string;
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
/** The certificate subject selects this host from the common config.
 * The identity must be cryptographically verified by Identity.create. */
function certificateSubject(bundle: string): string {
    try {
        const { certificate } = JSON.parse(bundle);
        const payload = certificate.split(".")[1];
        const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        if (typeof claims.sub !== "string") throw new Error("Missing subject");
        return claims.sub;
    } catch { throw new Error("Invalid CLUSTER_SERVER_TOKEN certificate"); }
}
export function parseServerTopology(env: TopologyEnv): ServerTopology {
    if (env.ETB_CLUSTER_CONFIG !== undefined) {
        const servers = parseETBClusterConfig(env.ETB_CLUSTER_CONFIG);
        const primaryUrl = servers[0].origin;
        if (!env.CLUSTER_SERVER_TOKEN)
            return { role: "standalone", primaryUrl, parentUrl: null, publicUrl: null };
        const own = certificateSubject(env.CLUSTER_SERVER_TOKEN);
        const index = servers.findIndex(server => server.origin === own);
        if (index < 0) throw new Error("Signed server identity is absent from ETB_CLUSTER_CONFIG");
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
