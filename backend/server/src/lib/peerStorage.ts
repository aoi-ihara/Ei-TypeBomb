import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { Identity, readRecord, type Member } from "../../../shared/distributed/identity";
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
            if (previousId && previousId !== nextId) throw new Error("Cluster server URL changed: use a new state directory");
            if (previous?.declaration && previous.declaration !== declaration)
                throw new Error("Cluster topology changed: drain rooms and use a new state directory");
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

/** Read only the public URL from existing disk metadata before topology is
 * selected. Never require or recreate an old secret key to boot the server. */
export function nodeClusterEnv<T extends ClusterEnv & { CLUSTER_STATE_DIR?: string }>(env: T): T & { SERVER_PUBLIC_URL?: string } {
    if (env.SERVER_PUBLIC_URL || env.RENDER_EXTERNAL_URL || !env.ETB_CLUSTER_CONFIG) return env;
    const path = resolve(env.CLUSTER_STATE_DIR ?? ".cluster-state", "cluster.sqlite");
    if (!existsSync(path)) return env;
    const db = new DatabaseSync(path, { readOnly: true });
    try {
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'state'").get()) return env;
        const row = db.prepare("SELECT value FROM state WHERE key = 'identity'").get();
        if (!row) return env;
        const previous = JSON.parse(row.value as string);
        const id = previous.id ?? (previous.certificate ? readRecord(previous.certificate).sub : undefined);
        if (typeof id !== "string") throw new Error("Invalid persisted cluster URL");
        return { ...env, SERVER_PUBLIC_URL: id };
    } finally { db.close(); }
}
