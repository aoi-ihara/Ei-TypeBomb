import { parseETBClusterConfig } from "../../../shared/clusterConfig";
import type { Env } from "../types";

/** Config-specific Durable Object names prevent old cluster metadata and votes
 * from being read by a newly configured cluster. The hash is not a secret. */
async function namespace(
    env: Pick<Env, "ETB_CLUSTER_CONFIG">,
): Promise<string | null> {
    if (!env.ETB_CLUSTER_CONFIG) return null; // Standalone: preserve existing rooms.
    const endpoints = parseETBClusterConfig(env.ETB_CLUSTER_CONFIG).map(
        (s) => s.endpoint,
    );
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify(endpoints)),
    );
    const hex = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
    return `v2:${hex}`;
}

export async function clusterObjectName(env: Pick<Env, "ETB_CLUSTER_CONFIG">) {
    const scope = await namespace(env);
    return scope ? `${scope}:server` : "server";
}
export async function replicaObjectName(
    env: Pick<Env, "ETB_CLUSTER_CONFIG">,
    room: string,
) {
    const scope = await namespace(env);
    return scope ? `${scope}:replica:${room}` : room;
}
export async function roomObjectName(
    env: Pick<Env, "ETB_CLUSTER_CONFIG">,
    room: string,
) {
    const scope = await namespace(env);
    return scope ? `${scope}:room:${room}` : room;
}
