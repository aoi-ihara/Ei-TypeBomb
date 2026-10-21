/** Shared public topology. /ws selects a native Worker WebSocket transport. */
export type ClusterServer = {
    endpoint: string;
    origin: string;
    transport: "socket.io" | "websocket";
};
export function parseETBClusterConfig(raw: string): ClusterServer[] {
    let input: unknown;
    try {
        input = JSON.parse(raw);
    } catch {
        throw new Error("ETB_CLUSTER_CONFIG is not valid JSON");
    }
    if (!input || typeof input !== "object" || Array.isArray(input))
        throw new Error("ETB_CLUSTER_CONFIG must be an object");
    const config = input as Record<string, unknown>;
    if (
        config.version !== 1 ||
        !Array.isArray(config.servers) ||
        config.servers.length < 1 ||
        config.servers.length > 1000 ||
        Object.keys(config).some((k) => k !== "version" && k !== "servers")
    )
        throw new Error(
            "Expected ETB_CLUSTER_CONFIG version 1 and 1-1000 servers",
        );
    const servers: ClusterServer[] = config.servers.map((item, i) => {
        if (
            typeof item !== "string" ||
            item !== item.trim() ||
            item.length > 2048
        )
            throw new Error(`Invalid cluster URL at position ${i}`);
        let parsed: URL;
        try {
            parsed = new URL(item);
        } catch {
            throw new Error(`Invalid cluster URL at position ${i}`);
        }
        if (
            (parsed.protocol !== "https:" &&
                !(
                    parsed.protocol === "http:" &&
                    ["localhost", "127.0.0.1"].includes(parsed.hostname)
                )) ||
            parsed.username ||
            parsed.password ||
            parsed.search ||
            parsed.hash ||
            !["/", "/ws"].includes(parsed.pathname) ||
            item !== parsed.origin + (parsed.pathname === "/ws" ? "/ws" : "")
        )
            throw new Error(
                `Server #${i} must be an HTTPS origin or HTTPS origin/ws`,
            );
        return {
            endpoint: item,
            origin: parsed.origin,
            transport: parsed.pathname === "/ws" ? "websocket" : "socket.io",
        };
    });
    if (new Set(servers.map((s) => s.origin)).size !== servers.length)
        throw new Error("Duplicate server origins in ETB_CLUSTER_CONFIG");
    return servers;
}
