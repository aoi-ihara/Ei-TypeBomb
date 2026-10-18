import { parseServerTopology, type TopologyEnv } from "../topology";
import type { Control, ControlResult } from "./types";

export type ClusterEnv = TopologyEnv & {
    CLUSTER_SERVER_TOKEN?: string;
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
};
export function clusterConfig(
    env: ClusterEnv,
    transport: "socket.io" | "websocket",
) {
    const topology = parseServerTopology(env);
    if (topology.role === "standalone") return null;
    if (
        !topology.publicUrl ||
        !env.CLUSTER_SERVER_TOKEN ||
        !env.NEXT_PUBLIC_SUPABASE_URL ||
        !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    )
        throw new Error(
            "Distributed mode requires SERVER_PUBLIC_URL, CLUSTER_SERVER_TOKEN and Supabase publishable configuration",
        );
    for (const url of [
        topology.publicUrl,
        topology.parentUrl,
        topology.primaryUrl,
        env.NEXT_PUBLIC_SUPABASE_URL,
    ]) {
        if (url && new URL(url).origin !== url)
            throw new Error("Cluster URLs must be origins without paths");
        if (
            url &&
            new URL(url).protocol !== "https:" &&
            !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
        )
            throw new Error("Cluster traffic requires HTTPS");
    }
    return {
        id: topology.publicUrl,
        parent: topology.parentUrl,
        primary: topology.primaryUrl,
        transport,
    };
}
export class HttpControl implements Control {
    readonly config;
    constructor(
        private readonly env: ClusterEnv,
        transport: "socket.io" | "websocket",
        private readonly request: typeof fetch = (input, init) =>
            fetch(input, init),
    ) {
        const config = clusterConfig(env, transport);
        if (!config) throw new Error("Cluster is not configured");
        this.config = config;
        if (!this.config) throw new Error("Cluster is not configured");
    }
    async call(
        op: string,
        args: Record<string, unknown> = {},
    ): Promise<ControlResult> {
        const response = await this.request(
            `${this.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/etb_cluster`,
            {
                method: "POST",
                redirect: "manual",
                headers: {
                    apikey: this.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    server_id: this.config!.id,
                    server_token: this.env.CLUSTER_SERVER_TOKEN,
                    operation: op,
                    args,
                }),
                signal: AbortSignal.timeout(2_000),
            },
        );
        if (!response.ok)
            throw new Error(`Cluster control unavailable (${response.status})`);
        return (await response.json()) as ControlResult;
    }
    register() {
        return this.call("register", this.config!);
    }
}
