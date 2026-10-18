/**
 * Environment-driven hierarchy. This validates the node's declared place;
 * replication, registration and ownership transfer are separate operations.
 */
export type TopologyEnv = {
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
    if (!["https:", "http:"].includes(parsed.protocol) ||
        parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error(`${key} must be an http(s) URL without credentials or query parameters`);
    }
    const normalized = parsed.toString();
    return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function parseServerTopology(env: TopologyEnv): ServerTopology {
    const primaryUrl = serverUrl(env.PRIMARY_SERVER_URL, "PRIMARY_SERVER_URL");
    const parentUrl = serverUrl(env.PARENT_SERVER_URL, "PARENT_SERVER_URL");
    const publicUrl = serverUrl(env.SERVER_PUBLIC_URL, "SERVER_PUBLIC_URL");
    if (parentUrl && !primaryUrl) throw new Error("PARENT_SERVER_URL requires PRIMARY_SERVER_URL");
    if (parentUrl && publicUrl === parentUrl) throw new Error("Server cannot be its own parent");
    if (parentUrl && publicUrl === primaryUrl) throw new Error("Primary cannot declare a parent");
    if (primaryUrl && !parentUrl && publicUrl && primaryUrl !== publicUrl) {
        throw new Error("Only the primary server can omit PARENT_SERVER_URL");
    }
    return {
        role: !primaryUrl ? "standalone" : parentUrl ? "replica" : "primary",
        primaryUrl,
        parentUrl,
        publicUrl,
    };
}
