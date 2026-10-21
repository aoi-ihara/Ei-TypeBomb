import { mkdirSync, chmodSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Identity } from "../../../shared/distributed/identity";
import type { PeerStorage, VoteRecord } from "../../../shared/distributed/peers";

/** Never write runtime state into the checked-out server or repository directory.
 * A mounted, durable CLUSTER_STATE_DIR is strongly recommended for Render. */
export function clusterStateRoot(
    env: Pick<NodeJS.ProcessEnv, "CLUSTER_STATE_DIR" | "XDG_STATE_HOME">,
    workingDirectory = process.cwd(),
): string {
    const fallback = env.XDG_STATE_HOME && isAbsolute(env.XDG_STATE_HOME)
        ? join(env.XDG_STATE_HOME, "ei-typebomb", "cluster")
        : join(homedir(), ".local", "state", "ei-typebomb", "cluster");
    const configured = env.CLUSTER_STATE_DIR ?? fallback;
    if (!isAbsolute(configured))
        throw new Error("CLUSTER_STATE_DIR must be absolute and outside the repository");
    const location = resolve(configured);
    const cwd = resolve(workingDirectory);
    const repository = basename(cwd) === "server" && basename(dirname(cwd)) === "backend"
        ? resolve(cwd, "../..") : cwd;
    if (location === repository || location.startsWith(repository + sep))
        throw new Error("CLUSTER_STATE_DIR must be outside the repository; only logs may be written there");
    return location;
}

/** The CURRENT declaration selects a new namespace. No former server URL or
 * former topology is loaded from disk, even if old unscoped SQLite exists. */
export function topologyStateDirectory(root: string, declaration: string): string {
    return join(root, "v2-" + createHash("sha256").update(declaration).digest("hex"));
}

/** One persistent voter per scoped directory. SQLite's exclusive OS lock is
 * released after SIGKILL; boot and votes must survive ordinary restarts. */
export class NodePeerStorage implements PeerStorage {
    private readonly db: DatabaseSync;
    readonly boot: string;
    constructor(directory: string) {
        mkdirSync(directory, { recursive: true, mode: 0o700 });
        const path = resolve(directory, "cluster.sqlite");
        this.db = new DatabaseSync(path);
        try {
            chmodSync(path, 0o600);
            this.db.exec(`PRAGMA locking_mode=EXCLUSIVE;
                PRAGMA synchronous=FULL;
                BEGIN EXCLUSIVE;
                CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                COMMIT;`);
            this.db.exec("BEGIN IMMEDIATE");
            // Persist only the voter incarnation, not a server URL, parent,
            // roster or a previously configured topology.
            const previous = this.get<{ boot?: unknown }>("identity");
            if (previous && (typeof previous.boot !== "string" || !previous.boot.length))
                throw new Error("Invalid persisted voter incarnation");
            this.boot = previous?.boot as string | undefined ?? randomUUID();
            this.put("identity", { boot: this.boot });
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
    async registry(members: import("../../../shared/distributed/identity").Member[]) {
        this.put("registry", members);
    }
    members() {
        return this.get<import("../../../shared/distributed/identity").Member[]>("registry") ?? [];
    }
    close() { this.db.close(); }
}

export async function persistentPeerIdentity(declaration: string, root: string) {
    await Identity.create(declaration);
    const storage = new NodePeerStorage(topologyStateDirectory(root, declaration));
    try {
        return { identity: await Identity.create(declaration, storage.boot), storage };
    } catch (error) { storage.close(); throw error; }
}
