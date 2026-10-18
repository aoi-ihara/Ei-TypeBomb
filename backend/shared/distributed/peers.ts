import { Identity, digest, verify, type Member } from "./identity";
import { attachLink, type ClusterSocket, type PeerLink } from "./link";
import type { Control, ControlResult, Checkpoint, DurableRoom } from "./types";
import { difference, applyDifference } from "./replication";

export type VotedCheckpoint = Checkpoint & {
    voters: Member[];
    hash: string;
    decision?: string;
};
export type VoteRecord = {
    committed?: VotedCheckpoint;
    pending?: Proposal;
    promised: number;
    candidate: string;
    contact: number;
};
type Proposal = {
    checkpoint: VotedCheckpoint;
    mode: "init" | "commit" | "elect";
    proof: string;
    base?: VotedCheckpoint;
    baseHash?: string;
    delta?: ReturnType<typeof difference>;
};
export type PeerStorage = {
    load(room: string): Promise<VoteRecord | undefined>;
    save(room: string, record: VoteRecord): Promise<void>;
    registry?(members: Member[]): Promise<void>;
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
            throw new Error("Certificate/topology mismatch");
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
                /* A failed parent never erases the authenticated registry. */
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
            const member = await Identity.inspect(
                entry.certificate,
                this.identity.credential.authorityKey,
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
            if (conflict) throw new Error("Conflicting priority certificate");
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
    private cohort(cp: VotedCheckpoint) {
        const start = cp.voters.findIndex((v) => v.id === cp.ownership.owner);
        if (start < 0) throw new Error("Owner outside cohort");
        return cp.voters.slice(start);
    }
    private async validate(cp: VotedCheckpoint, decided = true) {
        if (
            !cp ||
            !Array.isArray(cp.voters) ||
            cp.voters.length === 0 ||
            cp.voters.length > 1000
        )
            throw new Error("Missing voter configuration");
        let previous: Member | undefined;
        for (const member of cp.voters) {
            const verified = await Identity.inspect(
                member.certificate,
                this.identity.credential.authorityKey,
                member.boot,
            );
            if (
                verified.id !== member.id ||
                verified.depth !== member.depth ||
                JSON.stringify(verified.publicKey) !==
                    JSON.stringify(member.publicKey) ||
                (previous &&
                    (member.parent !== previous.id ||
                        member.depth !== previous.depth + 1))
            )
                throw new Error("Invalid fixed cohort");
            previous = member;
        }
        const { hash, decision, ...value } = cp;
        if (hash !== (await digest(value)))
            throw new Error("Checkpoint digest mismatch");
        if (decided) {
            const tail = cp.voters[cp.voters.length - 1];
            const proof = await verify(
                cp.decision!,
                tail.publicKey,
                "etb-room-decision",
                tail.id,
            );
            if (proof.hash !== cp.hash || proof.boot !== tail.boot)
                throw new Error("Invalid tail decision");
        }
    }
    private async seal(
        value: Omit<VotedCheckpoint, "hash">,
    ): Promise<VotedCheckpoint> {
        const {
            decision,
            hash: ignored,
            ...withoutDecision
        } = value as VotedCheckpoint;
        return {
            ...withoutDecision,
            hash: await digest(withoutDecision),
        } as VotedCheckpoint;
    }
    private result(cp?: VotedCheckpoint): ControlResult {
        return structuredClone({
            ...(cp ?? { ownership: null, value: null }),
            servers: this.servers(),
        }) as ControlResult;
    }
    async read(roomId: string): Promise<VotedCheckpoint | undefined> {
        const candidates: VotedCheckpoint[] = [];
        let failures = 0;
        const local =
            (await this.record(roomId)).committed ?? this.mirrors.get(roomId);
        if (local) candidates.push(local);
        await Promise.all(
            [
                ...new Set([
                    ...this.identity.member.roster,
                    ...this.members.keys(),
                ]),
            ]
                .filter((id) => id !== this.config.id)
                .map(async (id) => {
                    try {
                        const cp = await this.rpc(id, "status", { roomId });
                        if (cp) {
                            await this.validate(cp);
                            candidates.push(cp);
                        }
                    } catch {
                        failures++;
                    }
                }),
        );
        candidates.sort(
            (a, b) =>
                b.ownership.epoch - a.ownership.epoch ||
                b.ownership.revision - a.ownership.revision,
        );
        if (!candidates.length && failures)
            throw new Error(
                "Unknown room while a member is unreachable; no database reload",
            );
        return candidates[0];
    }
    async call(
        op: string,
        args: Record<string, unknown> = {},
    ): Promise<ControlResult> {
        const roomId = args.roomId as string;
        if (op === "register") return this.register();
        if (op === "read") return this.result(await this.read(roomId));
        if (op === "report") return this.report(roomId, args);
        if (op === "snapshot") {
            const cp = (await this.record(roomId)).committed;
            if (!cp) throw new Error("Unknown room");
            this.broadcast(cp);
            return this.result(cp);
        }
        if (op === "open") {
            const old = await this.read(roomId);
            if (old && old.ownership.lifecycle !== "DELETED") {
                if (old.ownership.owner !== this.config.id)
                    throw new Error("Connect to the current owner");
                return this.result(await this.promote(old, true));
            }
            if (this.config.id !== this.config.primary)
                throw new Error("Only primary can create a fresh room");
            const voters = this.identity.member.roster.map(
                (id) => this.members.get(id)!,
            );
            if (voters.some((v) => !v))
                throw new Error("Incomplete signed roster");
            voters.sort((a, b) => a.depth - b.depth);
            if (voters.length < 2)
                throw new Error("Wait for authenticated backup registration");
            // Every registered member must be reached. A forgotten old room can
            // never be replaced merely because a peer cannot be contacted.
            for (const voter of voters)
                if (voter.id !== this.config.id) {
                    const link = await this.connect(voter.id);
                    if (link.member.boot !== voter.boot)
                        throw new Error("Membership changed; retry discovery");
                }
            const initial = args.initial as DurableRoom;
            if (
                !initial ||
                initial.game.room.id !== roomId ||
                initial.game.room.isStart ||
                initial.game.room.users.length ||
                Object.keys(initial.sessions).length ||
                Object.keys(initial.events).length
            )
                throw new Error("Invalid fresh room");
            const cp = await this.seal({
                ownership: {
                    roomId,
                    instance: crypto.randomUUID(),
                    owner: this.config.id,
                    epoch: (old?.ownership.epoch ?? 0) + 1,
                    revision: 0,
                    lifecycle: "CREATING",
                    savedAt: Date.now(),
                },
                value: initial,
                voters,
            });
            return this.result(await this.propose(cp, "init", old));
        }
        const local = await this.record(roomId),
            current = local.committed;
        if (
            !current ||
            current.ownership.owner !== this.config.id ||
            current.ownership.instance !== args.instance ||
            current.ownership.epoch !== args.epoch ||
            local.promised > current.ownership.epoch
        )
            throw new Error("Fenced owner");
        if (op === "confirm") {
            await this.rpc(this.config.id, "fence", {
                roomId,
                epoch: args.epoch,
                owner: this.config.id,
            });
            return this.result((await this.record(roomId)).committed);
        }
        if (op === "handoff") {
            this.draining = true;
            return this.result(current);
        }
        if (op !== "commit" && op !== "delete")
            throw new Error("Unknown control operation");
        if (
            current.ownership.lifecycle === "DELETED" ||
            current.ownership.revision !== args.revision
        )
            throw new Error("Revision conflict");
        const value = op === "delete" ? null : (args.value as DurableRoom);
        if (
            op === "delete" &&
            (Object.keys(current.value!.sessions).length ||
                current.value!.game.room.isStart)
        )
            throw new Error("Room still in use");
        if (
            value &&
            (value.game.room.id !== roomId ||
                value.game.revision !== current.ownership.revision + 1)
        )
            throw new Error("Invalid revision");
        const cp = await this.seal({
            ...current,
            decision: undefined,
            ownership: {
                ...current.ownership,
                revision: current.ownership.revision + 1,
                savedAt: Date.now(),
                lifecycle:
                    op === "delete"
                        ? "DELETED"
                        : value?.resumeUntil
                          ? "MIGRATING"
                          : "ACTIVE",
            },
            value,
        });
        const decided = await this.propose(
            cp,
            "commit",
            undefined,
            args.kind === "input" ? current : undefined,
        );
        this.broadcast(decided);
        return this.result(decided);
    }
    private async propose(
        cp: VotedCheckpoint,
        mode: Proposal["mode"],
        base?: VotedCheckpoint,
        deltaBase?: VotedCheckpoint,
    ): Promise<VotedCheckpoint> {
        const proof = await this.identity.proof("etb-room-proposal", {
            hash: cp.hash,
            mode,
        });
        const full: Proposal = { checkpoint: cp, proof, mode, base };
        await this.serial(cp.ownership.roomId, async () => {
            const record = await this.record(cp.ownership.roomId);
            await this.store(cp.ownership.roomId, { ...record, pending: full });
        });
        const wire: Proposal =
            deltaBase?.value && cp.value
                ? {
                      ...full,
                      checkpoint: { ...cp, value: null },
                      baseHash: deltaBase.hash,
                      delta: difference(deltaBase.value, cp.value),
                  }
                : full;
        return this.rpc(this.config.id, "stage", { proposal: wire });
    }
    private broadcast(cp: VotedCheckpoint) {
        const self = this.identity.member;
        void Promise.allSettled(
            [...this.members.values()]
                .filter((member) => member.depth > self.depth)
                .map((member) =>
                    this.rpc(member.id, "mirror", { checkpoint: cp }),
                ),
        );
    }
    async report(
        roomId: string,
        args: Record<string, unknown>,
    ): Promise<ControlResult> {
        const cp = await this.read(roomId);
        if (!cp || cp.ownership.lifecycle === "DELETED")
            throw new Error("No existing room to restore");
        if (
            args.owner !== cp.ownership.owner ||
            typeof args.revision !== "number" ||
            args.revision > cp.ownership.revision
        )
            return this.result(cp);
        if (
            this.identity.member.depth <=
            cp.voters.find((v) => v.id === cp.ownership.owner)!.depth
        )
            return this.result(cp);
        try {
            const owner = await this.rpc(cp.ownership.owner, "probe", {
                roomId,
                target: this.config.id,
            });
            if (owner.healthy) return this.result(cp);
            if (!owner.release)
                throw new Error("Owner has not approved transfer");
        } catch (error) {
            if (
                error instanceof Error &&
                error.message === "Owner has not approved transfer"
            )
                throw error;
        }
        return this.result(await this.promote(cp));
    }
    private async promote(
        cp: VotedCheckpoint,
        selfRecovery = false,
    ): Promise<VotedCheckpoint> {
        const self = cp.voters.find((v) => v.id === this.config.id);
        if (
            !self ||
            self.boot !== this.identity.member.boot ||
            (!selfRecovery &&
                self.depth <=
                    cp.voters.find((v) => v.id === cp.ownership.owner)!.depth)
        )
            throw new Error("Ineligible voter or lost process memory");
        const suffix = cp.voters.slice(
            cp.voters.findIndex((v) => v.id === this.config.id),
        );
        const ballots = await Promise.all(
            suffix.map((v) =>
                this.rpc(v.id, "ballot", { roomId: cp.ownership.roomId }),
            ),
        );
        const epoch = Math.max(cp.ownership.epoch, ...ballots) + 1;
        const state = await this.rpc(this.config.id, "promise", {
            roomId: cp.ownership.roomId,
            candidate: this.config.id,
            epoch,
            configuration: cp,
        });
        const latest = state.checkpoint as VotedCheckpoint;
        await this.validate(latest);
        const replacement = await this.seal({
            ...latest,
            decision: undefined,
            ownership: {
                ...latest.ownership,
                owner: this.config.id,
                epoch,
                lifecycle: "MIGRATING",
                pausedAt: state.contact,
            },
        });
        return this.propose(replacement, "elect", latest);
    }
    async dispatch(
        peer: Member,
        op: string,
        args: Record<string, any>,
    ): Promise<any> {
        if (peer.roster[0] !== this.config.primary)
            throw new Error("Peer belongs to another cluster");
        if (peer.id !== this.config.id && !this.members.has(peer.id))
            this.members.set(peer.id, peer);
        if (op === "register") {
            await this.merge(args.members);
            return { members: [...this.members.values()] };
        }
        if (
            typeof args.roomId !== "string" &&
            op !== "stage" &&
            op !== "mirror"
        )
            throw new Error("Missing room ID");
        if (op === "status")
            return (
                (await this.record(args.roomId)).committed ??
                this.mirrors.get(args.roomId) ??
                null
            );
        if (op === "ballot") return (await this.record(args.roomId)).promised;
        if (op === "prepared") return (await this.record(args.roomId)).pending;
        if (op === "probe") {
            const state = await this.record(args.roomId),
                cp = state.committed;
            if (!cp || cp.ownership.owner !== this.config.id)
                return { healthy: false, release: false };
            if (this.draining) return { healthy: false, release: true };
            try {
                await this.rpc(this.config.id, "fence", {
                    roomId: args.roomId,
                    epoch: cp.ownership.epoch,
                    owner: this.config.id,
                });
                return { healthy: true };
            } catch {
                return { healthy: false, release: true };
            }
        }
        if (op === "mirror") {
            const cp = args.checkpoint as VotedCheckpoint;
            await this.validate(cp);
            const voted = (await this.record(cp.ownership.roomId)).committed;
            if (
                voted &&
                (voted.ownership.epoch > cp.ownership.epoch ||
                    (voted.ownership.epoch === cp.ownership.epoch &&
                        voted.ownership.revision >= cp.ownership.revision))
            )
                return false;
            const old = this.mirrors.get(cp.ownership.roomId);
            if (
                !old ||
                cp.ownership.epoch > old.ownership.epoch ||
                (cp.ownership.epoch === old.ownership.epoch &&
                    cp.ownership.revision > old.ownership.revision)
            )
                this.mirrors.set(cp.ownership.roomId, cp);
            return true;
        }
        const roomId =
            op === "stage"
                ? args.proposal?.checkpoint?.ownership?.roomId
                : args.roomId;
        if (typeof roomId !== "string") throw new Error("Invalid room");
        return this.serial(roomId, async () => {
            const record = await this.record(roomId);
            if (op === "promise" || op === "fence") {
                const cp = record.committed;
                if (!cp) throw new Error("Voter lost state; cannot vote");
                if (cp.ownership.lifecycle === "DELETED")
                    throw new Error("Deleted instance cannot regain ownership");
                const self = cp.voters.find((v) => v.id === this.config.id);
                if (self?.boot !== this.identity.member.boot)
                    throw new Error("Voter incarnation changed");
                const owner = op === "promise" ? args.candidate : args.owner;
                const index = cp.voters.findIndex(
                        (v) => v.id === this.config.id,
                    ),
                    candidate = cp.voters.findIndex((v) => v.id === owner);
                if (
                    candidate < 0 ||
                    index < candidate ||
                    peer.id !==
                        (index === candidate ? owner : cp.voters[index - 1].id)
                )
                    throw new Error("Invalid confirmation path");
                if (op === "promise") {
                    await this.validate(args.configuration);
                    if (
                        args.configuration.ownership.instance !==
                            cp.ownership.instance ||
                        (await digest(args.configuration.voters)) !==
                            (await digest(cp.voters))
                    )
                        throw new Error("Wrong election configuration");
                    const oldDepth = cp.voters.findIndex(
                        (v) => v.id === cp.ownership.owner,
                    );
                    if (
                        candidate < oldDepth ||
                        args.epoch <= cp.ownership.epoch ||
                        args.epoch < record.promised ||
                        (args.epoch === record.promised &&
                            record.candidate !== owner)
                    )
                        throw new Error("Promise conflict");
                    await this.store(roomId, {
                        ...record,
                        promised: args.epoch,
                        candidate: owner,
                    });
                } else {
                    if (
                        cp.ownership.owner !== owner ||
                        cp.ownership.epoch !== args.epoch ||
                        record.promised > args.epoch
                    )
                        throw new Error("Fenced owner");
                    await this.store(roomId, {
                        ...record,
                        contact: Date.now(),
                    });
                }
                const next = cp.voters[index + 1];
                if (next) return this.rpc(next.id, op, args);
                return {
                    checkpoint: cp,
                    contact: record.contact || cp.ownership.savedAt,
                };
            }
            if (op !== "stage") throw new Error("Unsupported RPC");
            let proposal = args.proposal as Proposal,
                cp = proposal.checkpoint;
            if (proposal.delta) {
                if (
                    record.committed &&
                    record.committed.hash === proposal.baseHash &&
                    record.committed.value
                )
                    cp = {
                        ...cp,
                        value: applyDifference(
                            record.committed.value,
                            proposal.delta,
                        ),
                    };
                else {
                    const full = await this.rpc(
                        cp.ownership.owner,
                        "prepared",
                        { roomId },
                    );
                    if (full?.checkpoint.hash !== cp.hash)
                        throw new Error("Snapshot repair unavailable");
                    proposal = full;
                    cp = full.checkpoint;
                }
            }
            await this.validate(cp, false);
            const owner = cp.voters.find((v) => v.id === cp.ownership.owner)!;
            const proof = await verify(
                proposal.proof,
                owner.publicKey,
                "etb-room-proposal",
                owner.id,
            );
            if (
                proof.hash !== cp.hash ||
                proof.mode !== proposal.mode ||
                proof.sub !== owner.boot
            )
                throw new Error("Invalid owner proof");
            const index = cp.voters.findIndex((v) => v.id === this.config.id),
                start = cp.voters.findIndex((v) => v.id === owner.id);
            if (
                index < start ||
                cp.voters[index]?.boot !== this.identity.member.boot ||
                peer.id !==
                    (index === start ? owner.id : cp.voters[index - 1].id)
            )
                throw new Error("Wrong replication path/incarnation");
            const old = record.committed;
            if (
                record.promised > cp.ownership.epoch ||
                (record.promised === cp.ownership.epoch &&
                    record.candidate &&
                    record.candidate !== owner.id)
            )
                throw new Error("Fenced proposal");
            if (old?.hash === cp.hash) {
                await this.validate(old);
                return old;
            }
            if (proposal.mode === "init") {
                // A migrated owner only writes its suffix. The signed terminal
                // tombstone authorizes replacing stale records at old owners.
                let released = !old || old.ownership.lifecycle === "DELETED";
                if (proposal.base) {
                    const base = proposal.base;
                    await this.validate(base);
                    if (
                        base.ownership.roomId !== roomId ||
                        base.ownership.lifecycle !== "DELETED" ||
                        base.ownership.instance === cp.ownership.instance ||
                        base.ownership.epoch >= cp.ownership.epoch ||
                        (old &&
                            (base.ownership.instance !==
                                old.ownership.instance ||
                                base.ownership.epoch < old.ownership.epoch ||
                                (base.ownership.epoch === old.ownership.epoch &&
                                    base.ownership.revision <
                                        old.ownership.revision) ||
                                (await digest(base.voters)) !==
                                    (await digest(old.voters))))
                    )
                        throw new Error("Invalid release tombstone");
                    released = true;
                }
                if (
                    JSON.stringify(cp.voters.map((v) => v.id)) !==
                        JSON.stringify(this.identity.member.roster) ||
                    owner.id !== this.config.primary ||
                    start !== 0 ||
                    !released ||
                    (old &&
                        (cp.ownership.epoch <= old.ownership.epoch ||
                            cp.ownership.instance ===
                                old.ownership.instance)) ||
                    cp.value?.game.room.isStart ||
                    cp.value?.game.room.users.length ||
                    Object.keys(cp.value?.sessions ?? {}).length
                )
                    throw new Error("Cannot replace an existing game");
            } else if (proposal.mode === "elect") {
                await this.validate(proposal.base!);
                if (
                    !old ||
                    record.promised !== cp.ownership.epoch ||
                    record.candidate !== owner.id ||
                    proposal.base!.ownership.instance !==
                        cp.ownership.instance ||
                    proposal.base!.ownership.revision !==
                        cp.ownership.revision ||
                    cp.ownership.epoch <= old.ownership.epoch
                )
                    throw new Error("Missing election barrier");
            } else if (
                !old ||
                old.ownership.instance !== cp.ownership.instance ||
                old.ownership.epoch !== cp.ownership.epoch ||
                old.ownership.owner !== owner.id ||
                cp.ownership.revision !== old.ownership.revision + 1 ||
                old.ownership.lifecycle === "DELETED"
            )
                throw new Error("Out-of-order revision");
            const staged = { ...proposal, checkpoint: cp, delta: undefined };
            await this.store(roomId, {
                ...record,
                promised: cp.ownership.epoch,
                candidate: owner.id,
                pending: staged,
            });
            const next = cp.voters[index + 1];
            let decided: VotedCheckpoint;
            if (next) decided = await this.rpc(next.id, "stage", { proposal });
            else
                decided = {
                    ...cp,
                    decision: await this.identity.proof(
                        "etb-room-decision",
                        { hash: cp.hash, boot: this.identity.member.boot },
                        31536000,
                    ),
                };
            await this.validate(decided);
            if (decided.hash !== cp.hash) throw new Error("Wrong ACK");
            await this.store(roomId, {
                committed: decided,
                promised: cp.ownership.epoch,
                candidate: owner.id,
                contact: Date.now(),
            });
            return decided;
        });
    }
    close() {
        for (const link of this.links.values()) link.close();
        this.links.clear();
    }
}
