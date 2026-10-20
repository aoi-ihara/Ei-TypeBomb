import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { Identity, type Member, type Credential, type IdentityPins } from "../../../shared/distributed/identity";
import type { ClusterServer } from "../../../shared/clusterConfig";
import type { PeerStorage, VoteRecord } from "../../../shared/distributed/peers";

/** One disk and one process per identity. SQLite's exclusive OS lock is released
 * even on SIGKILL. Never reuse an incarnation without its votes/promises. */
export class NodePeerStorage implements PeerStorage {
    private readonly db: DatabaseSync;
    readonly boot: string;
    readonly credential?: Credential;
    constructor(directory: string, certificate?: string, generated?: Credential) {
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
            const savedCredential = this.get<Credential>("credential");
            const missingSavedKey = !certificate && !savedCredential;
            this.credential = certificate ? undefined : savedCredential ?? generated;
            certificate ??= this.credential?.certificate;
            if (!certificate) throw new Error("Missing persistent cluster identity");
            const previous = this.get<{ certificate: string; boot: string }>("identity");
            if (previous && previous.certificate !== certificate) {
                if (missingSavedKey)
                    throw new Error("Existing cluster state has no saved signing key: upgrade once with CLUSTER_SERVER_TOKEN before removing it");
                throw new Error("Cluster certificate changed: drain rooms and use a new state directory");
            }
            this.boot = previous?.boot ?? randomUUID();
            if (!previous) this.put("identity", { certificate, boot: this.boot });
            if (this.credential) this.put("credential", this.credential);
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
    pins() { return this.get<IdentityPins>("identity-pins") ?? {}; }
    async savePins(pins: IdentityPins) { this.put("identity-pins", pins); }
    saveCredential(credential: Credential) { this.put("credential", credential); }
    members() { return this.get<Member[]>("registry") ?? []; }
    close() { this.db.close(); }
}

export async function persistentPeerIdentity(bundle: string | undefined, directory: string,
    automatic?: { servers: ClusterServer[]; id: string }) {
    if (!bundle && !automatic) throw new Error("Automatic cluster identity requires a configured roster");
    const generated = !bundle ? JSON.parse(await Identity.generate(automatic!.servers, automatic!.id)) as Credential : undefined;
    const inspected = bundle ? await Identity.create(bundle) : undefined;
    const storage = new NodePeerStorage(directory, inspected?.member.certificate, generated);
    try {
        const identity = await Identity.create(bundle ?? JSON.stringify(storage.credential), storage.boot);
        storage.saveCredential(identity.credential);
        if (automatic) identity.enableDiscovery(automatic.servers, storage.pins(), pins => storage.savePins(pins));
        return { identity, storage };
    } catch (error) {
        storage.close();
        throw error;
    }
}
