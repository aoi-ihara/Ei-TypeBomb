/** Public endpoints and stable voter IDs. /ws selects the Worker transport.
 * Version 1 keeps origin-based IDs. Version 2 decouples IDs from URLs. */
export type ClusterServer = {
    id?: string;
    endpoint: string;
    origin: string;
    transport: "socket.io" | "websocket";
};
export function parseETBClusterConfig(raw: string): ClusterServer[] {
    let input: unknown;
    try { input = JSON.parse(raw); }
    catch { throw new Error("ETB_CLUSTER_CONFIG is not valid JSON"); }
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("ETB_CLUSTER_CONFIG must be an object");
    const config = input as Record<string, unknown>;
    if ((config.version !== 1 && config.version !== 2) ||
        !Array.isArray(config.servers) || config.servers.length < 1 ||
        config.servers.length > 1000 ||
        Object.keys(config).some(k => k !== "version" && k !== "servers"))
        throw new Error("Expected ETB_CLUSTER_CONFIG version 1 or 2 and 1-1000 servers");
    const servers: ClusterServer[] = config.servers.map((item, i) => {
        let endpoint: string;
        let id: string | undefined;
        if (config.version === 2) {
            if (!item || typeof item !== "object" || Array.isArray(item) ||
                Object.keys(item).some(k => k !== "id" && k !== "url") ||
                typeof item.id !== "string" || typeof item.url !== "string")
                throw new Error(`Invalid cluster server #${i}: expected {id,url}`);
            id = item.id;
            endpoint = item.url;
            // Existing version-1 voters can migrate by retaining their original
            // origin as a stable ID. New installs should use short node IDs.
            const legacyOrigin = /^https?:\/\//.test(id!) && (() => {
                try {
                    const url = new URL(id!);
                    return url.origin === id && (url.protocol === "https:" ||
                        (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)));
                } catch { return false; }
            })();
            if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id!) && !legacyOrigin)
                throw new Error(`Invalid stable server id at position ${i}`);
        } else {
            if (typeof item !== "string") throw new Error(`Invalid cluster URL at position ${i}`);
            endpoint = item;
        }
        if (endpoint !== endpoint.trim() || endpoint.length > 2048)
            throw new Error(`Invalid cluster URL at position ${i}`);
        let parsed: URL;
        try { parsed = new URL(endpoint); }
        catch { throw new Error(`Invalid cluster URL at position ${i}`); }
        if ((parsed.protocol !== "https:" &&
            !(parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname))) ||
            parsed.username || parsed.password || parsed.search || parsed.hash ||
            !["/", "/ws"].includes(parsed.pathname) ||
            endpoint !== parsed.origin + (parsed.pathname === "/ws" ? "/ws" : ""))
            throw new Error(`Server #${i} must be an HTTPS origin or HTTPS origin/ws`);
        return { id: id ?? parsed.origin, endpoint, origin: parsed.origin,
            transport: parsed.pathname === "/ws" ? "websocket" : "socket.io" };
    });
    if (new Set(servers.map(s => s.origin)).size !== servers.length)
        throw new Error("Duplicate server origins in ETB_CLUSTER_CONFIG");
    if (new Set(servers.map(s => s.id)).size !== servers.length)
        throw new Error("Duplicate server ids in ETB_CLUSTER_CONFIG");
    return servers;
}
