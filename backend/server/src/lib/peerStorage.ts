import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { Identity, readRecord, type Member } from "../../../shared/distributed/identity";
import { parseETBClusterConfig } from "../../../shared/clusterConfig";
import type { ClusterEnv } from "../../../shared/distributed/control";
import type { PeerStorage, VoteRecord } from "../../../shared/distributed/peers";

/** One disk and one process per identity. SQLite's exclusive OS lock is released
 * even on SIGKILL. Never reuse an incarnation without its votes/promises. */
export class NodePeerStorage implements PeerStorage {
    private readonly db: DatabaseSync;
    readonly boot: string;
    constructor(directory: string, declaration: string) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(resolve(directory, "cluster.sqlite"));
        try {
            chmodSync(resolve(directory, "cluster.sqlite"), 0o600);
            this.db.exec(`PRAGMA locking_mode=EXCLUSIVE;
                PRAGMA synchronous=FULL;
                BEGIN EXCLUSIVE;
                CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                COMMIT;`);
            this.db.exec("BEGIN IMMEDIATE");
            const nextId = declaration.startsWith("{") ? readRecord(declaration).id : declaration;
            const previous = this.get<{ id?: string; declaration?: string; certificate?: string; boot: string }>("identity");
            const previousId = previous?.id ?? (previous?.certificate ? readRecord(previous.certificate).sub : undefined);
            if (previousId && previousId !== nextId)
                throw new Error("Stable cluster server ID changed: restore the original ID to preserve votes");
            if (previous?.declaration)
                Identity.assertDurableTopology(previous.declaration, declaration, previous.boot);
            if (previous?.certificate && !previous.declaration)
                Identity.assertLegacyTopology(previous.certificate, declaration, previous.boot);
            this.boot = previous?.boot ?? randomUUID();
            this.put("identity", { id: nextId, declaration, boot: this.boot });
            this.db.prepare("DELETE FROM state WHERE key IN ('credential', 'identity-pins')").run();
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.close();
            throw error;
        }
    }
    private get<T>(key: string): T | undefined {
        const row = this.db.prepare("SELECT value FROM state WHERE key = ?").get(key);
        return row ? JSON.parse(row.value as string) as T : undefined;
    }
    private put(key: string, value: unknown) {
        this.db.prepare("INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)")
            .run(key, JSON.stringify(value));
    }
    async load(room: string) { return this.get<VoteRecord>(`room:${room}`); }
    async save(room: string, value: VoteRecord) { this.put(`room:${room}`, value); }
    async registry(members: Member[]) { this.put("registry", members); }
    members() { return this.get<Member[]>("registry") ?? []; }
    close() { this.db.close(); }
}

export async function persistentPeerIdentity(declaration: string, directory: string) {
    await Identity.create(declaration);
    const storage = new NodePeerStorage(directory, declaration);
    try {
        return { identity: await Identity.create(declaration, storage.boot), storage };
    } catch (error) { storage.close(); throw error; }
}

/** Reuse the durable voter ID across endpoint rotations. Legacy v1 clusters
 * continue selecting their origin. Never regenerate a voter ID from a new URL. */
export function nodeClusterEnv<T extends ClusterEnv & { CLUSTER_STATE_DIR?: string }>(env: T): T & { SERVER_PUBLIC_URL?: string; SERVER_NODE_ID?: string } {
    if (env.SERVER_NODE_ID || env.SERVER_PUBLIC_URL || env.RENDER_EXTERNAL_URL || !env.ETB_CLUSTER_CONFIG) return env;
    const path = resolve(env.CLUSTER_STATE_DIR ?? ".cluster-state", "cluster.sqlite");
    if (!existsSync(path)) return env;
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'state'").get()) return env;
        const row = db.prepare("SELECT value FROM state WHERE key = 'identity'").get();
        if (!row) return env;
        const previous = JSON.parse(row.value as string);
        const id = previous.id ?? (previous.certificate ? readRecord(previous.certificate).sub : undefined);
        if (typeof id !== "string") throw new Error("Invalid persisted cluster ID");
        const servers = parseETBClusterConfig(env.ETB_CLUSTER_CONFIG);
        if (servers.some(server => server.id === id))
            return { ...env, SERVER_NODE_ID: id };
        // An old v1 deployment that still has its URL in the roster.
        // Do not guess a different identity from its position in the list.
        throw new Error("Persisted server ID is not in ETB_CLUSTER_CONFIG; retain its old ID in a version 2 entry");
    } finally { db.close(); }
}
