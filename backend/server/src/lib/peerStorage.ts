import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { Identity, type Member } from "../../../shared/distributed/identity";
import type { PeerStorage, VoteRecord } from "../../../shared/distributed/peers";

/** One disk and one process per identity. SQLite's exclusive OS lock is released
 * even on SIGKILL. Never reuse an incarnation without its votes/promises. */
export class NodePeerStorage implements PeerStorage {
    private readonly db: DatabaseSync;
    readonly boot: string;
    constructor(directory: string, certificate: string) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(resolve(directory, "cluster.sqlite"));
        try {
            this.db.exec(`PRAGMA locking_mode=EXCLUSIVE;
                PRAGMA synchronous=FULL;
                BEGIN EXCLUSIVE;
                CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                COMMIT;`);
            const previous = this.get<{ certificate: string; boot: string }>("identity");
            if (previous && previous.certificate !== certificate)
                throw new Error("Cluster certificate changed: drain rooms and use a new state directory");
            this.boot = previous?.boot ?? randomUUID();
            if (!previous) this.put("identity", { certificate, boot: this.boot });
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

export async function persistentPeerIdentity(bundle: string, directory: string) {
    // Authenticate the credential before opening/creating its local storage.
    const inspected = await Identity.create(bundle);
    const storage = new NodePeerStorage(directory, inspected.member.certificate);
    try {
        return { identity: await Identity.create(bundle, storage.boot), storage };
    } catch (error) {
        storage.close();
        throw error;
    }
}
