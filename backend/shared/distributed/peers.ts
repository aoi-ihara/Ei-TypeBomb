import { Identity, digest, readStatement, type Member } from "./identity";
import { attachLink, type ClusterSocket, type PeerLink } from "./link";
import type { Control, ControlResult, Checkpoint, DurableRoom } from "./types";
import { difference, applyDifference } from "./replication";
import { canDeleteRoom } from "../session";
import { compareRoomVersion } from "./version";

export type VotedCheckpoint = Checkpoint & {
    voters: Member[];
    hash: string;
    decision?: string;
};
export type VoteRecord = {
    committed?: VotedCheckpoint;
    mirror?: VotedCheckpoint;
    pending?: Proposal;
    promised: number;
    candidate: string;
    contact: number;
};
type Proposal = {
    checkpoint: VotedCheckpoint;
    mode: "init" | "commit" | "elect";
    statement: string;
    proof?: string; // Read-only compatibility for previously persisted proposals.
    base?: VotedCheckpoint;
    baseHash?: string;
    delta?: ReturnType<typeof difference>;
    path?: string[];
};
export type PeerStorage = {
    load(room: string): Promise<VoteRecord | undefined>;
    save(room: string, record: VoteRecord): Promise<void>;
    registry?(members: Member[]): Promise<void>;
    members(): Member[];
    close(): void;
};
export class PeerControl implements Control {
    readonly links = new Map<string, PeerLink>();
    readonly members = new Map<string, Member>();
    private records = new Map<string, VoteRecord>();
    private loading = new Map<string, Promise<VoteRecord>>();
    private mirrors = new Map<string, VotedCheckpoint>();
    private queues = new Map<string, Promise<unknown>>();
    private connecting = new Map<string, Promise<PeerLink>>();
    draining = false;
    constructor(
        readonly identity: Identity,
        readonly config: {
            id: string;
            parent: string | null;
            primary: string;
            transport: "socket.io" | "websocket";
        },
        private readonly dial: (url: string) => Promise<ClusterSocket>,
        private readonly storage?: PeerStorage,
    ) {
        if (
            identity.member.roster[0] !== config.primary ||
            identity.member.id !== config.id ||
            identity.member.parent !== config.parent ||
            identity.member.transport !== config.transport ||
            (identity.member.depth === 0) !== (config.id === config.primary)
        )
            throw new Error("Declaration/topology mismatch");
        this.members.set(config.id, identity.member);
    }
    private async serial<T>(room: string, task: () => Promise<T>): Promise<T> {
        const next = (this.queues.get(room) ?? Promise.resolve()).then(task);
        this.queues.set(
            room,
            next.catch(() => {}),
        );
        return next;
    }
    private async record(room: string): Promise<VoteRecord> {
        const existing = this.records.get(room);
        if (existing) return existing;
        let loading = this.loading.get(room);
        if (!loading) {
            loading = (async () => {
                const value = (await this.storage?.load(room)) ?? {
                    promised: 0,
                    candidate: "",
                    contact: 0,
                };
                this.records.set(room, value);
                if (value.mirror) this.mirrors.set(room, value.mirror);
                return value;
            })().finally(() => this.loading.delete(room));
            this.loading.set(room, loading);
        }
        await loading;
        return this.records.get(room)!;
    }
    private async store(room: string, value: VoteRecord) {
        await this.storage?.save(room, structuredClone(value));
        this.records.set(room, value);
    }
    accept(socket: ClusterSocket, expected?: string) {
        return attachLink(
            socket,
            this.identity,
            expected,
            (member, op, args) => this.dispatch(member, op, args),
            (link) => {
                if (link.member.roster[0] !== this.config.primary) {
                    link.close();
                    return;
                }
                const old = this.links.get(link.member.id);
                const preferred = expected
                    ? this.identity.member.depth > link.member.depth
                    : this.identity.member.depth < link.member.depth;
                if (old && !preferred) {
                    link.close();
                    return;
                }
                this.links.set(link.member.id, link);
                this.members.set(link.member.id, link.member);
                if (old && old !== link) old.close();
            },
            (link) => {
                if (this.links.get(link.member.id) === link)
                    this.links.delete(link.member.id);
            },
        );
    }
    async connect(id: string): Promise<PeerLink> {
        const existing = this.links.get(id);
        if (existing) return existing;
        let pending = this.connecting.get(id);
        if (!pending) {
            pending = this.dial(id)
                .then((socket) => this.accept(socket, id))
                .then((link) => this.links.get(id) ?? link)
                .finally(() => this.connecting.delete(id));
            this.connecting.set(id, pending);
        }
        return pending;
    }
    private async rpc(
        id: string,
        op: string,
        args: Record<string, unknown>,
    ): Promise<any> {
        if (id === this.config.id)
            return this.dispatch(this.identity.member, op, args);
        return (await this.connect(id)).call(op, args);
    }
    async register() {
        await Promise.allSettled(
            this.identity.member.roster
                .filter((id) => id !== this.config.id)
                .map((id) => this.connect(id)),
        );
        if (this.config.parent) {
            try {
                const response = await this.rpc(
                    this.config.parent,
                    "register",
                    { members: [...this.members.values()] },
                );
                await this.merge(response.members);
            } catch {
                /* A failed parent never erases the saved registry. */
            }
        }
        const entries = [...this.members.values()];
        await Promise.allSettled(
            [...this.links.values()].map((link) =>
                link.call("register", { members: entries }),
            ),
        );
        return { servers: this.servers() } as ControlResult;
    }
    private async merge(entries: Member[]) {
        if (!Array.isArray(entries) || entries.length > 1000)
            throw new Error("Invalid registry");
        for (const entry of entries) {
            const member = await this.identity.inspectPeer(
                entry.declaration ?? entry.certificate!,
                entry.boot,
            );
            if (member.roster[0] !== this.config.primary)
                throw new Error("Registry member belongs to another cluster");
            if (member.id === this.config.id) continue;
            const connected = this.links.get(member.id);
            if (connected && connected.member.boot !== member.boot) continue;
            const conflict = [...this.members.values()].find(
                (other) =>
                    other.depth === member.depth && other.id !== member.id,
            );
            if (conflict) throw new Error("Conflicting priority declaration");
            this.members.set(member.id, { ...member, seen: Date.now() });
        }
        await this.storage?.registry?.([...this.members.values()]);
    }
    async restoreRegistry(entries: Member[]) {
        await this.merge(entries);
    }
    servers() {
        return [...this.members.values()]
            .sort((a, b) => a.depth - b.depth)
            .map(({ id, parent, depth, transport, seen }) => ({
                id,
                parent,
                depth,
                transport,
                seen,
            }));
    }
    /**
     * Availability-first: the owner may commit without waiting for standby
     * servers. This deliberately permits divergent histories on a partition.
     */
    private quorum(_cp: VotedCheckpoint): number {
        return 1;
    }

    private verifyPath(
        cp: VotedCheckpoint,
