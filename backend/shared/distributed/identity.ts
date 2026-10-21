import type { ClusterServer } from "../clusterConfig";
import type { ServerInfo } from "./types";
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const enc = (value: Uint8Array) => btoa(String.fromCharCode(...value))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
/** Legacy JWT payloads are decoded only to retain old disk state. This is NOT
 * signature verification, authentication, or proof of the declared identity. */
export function readRecord(value: string): Record<string, any> {
    if (typeof value !== "string" || value.length > 65536) throw new Error("Invalid cluster record");
    if (value.startsWith("{")) return JSON.parse(value);
    const payload = value.split(".")[1];
    if (!payload) throw new Error("Invalid cluster record");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(
        atob(payload.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0))));
}
export function readStatement(value: string, audience: string, issuer?: string) {
    const data = readRecord(value);
    if (data.aud !== audience || (issuer && data.iss !== issuer) ||
        !Number.isFinite(data.exp) || data.exp <= Date.now() / 1000)
        throw new Error("Invalid cluster statement");
    return data;
}
export async function digest(value: unknown): Promise<string> {
    const stable = (v: any): any =>
        Array.isArray(v)
            ? v.map(stable)
            : v && typeof v === "object"
              ? Object.fromEntries(
                    Object.keys(v)
                        .sort()
                        .filter((key) => v[key] !== undefined)
                        .map((key) => [key, stable(v[key])]),
                )
              : v;
    return enc(
        new Uint8Array(
            await crypto.subtle.digest("SHA-256", bytes(stable(value))),
        ),
    );
}

export type Member = ServerInfo & {
    boot: string;
    declaration?: string;
    // Read-only compatibility for existing checkpoints, included in their hash.
    certificate?: string;
    publicKey?: JsonWebKey;
    roster: string[];
};
/** Public metadata only. There are no server keys, certificates to issue, or
 * cryptographic claims of peer identity. Access to the peer network is trusted. */
export class Identity {
    private constructor(readonly member: Member, readonly servers: ClusterServer[]) {}
    static async generate(servers: ClusterServer[], id: string): Promise<string> {
        const depth = servers.findIndex(server => server.origin === id);
        if (depth < 0) throw new Error("Server absent from configured roster");
        return JSON.stringify({ id, depth, parent: servers[depth - 1]?.origin ?? null,
            transport: servers[depth].transport, roster: servers.map(s => s.origin), servers });
    }
    static async create(declaration: string, boot: string = crypto.randomUUID()) {
        const data = readRecord(declaration);
        const member = Identity.inspect(declaration, boot);
        const servers = data.servers as ClusterServer[];
        if (!Array.isArray(servers)) throw new Error("Missing public cluster topology");
        const identity = new Identity(member, servers);
        await identity.inspectPeer(declaration, boot);
        return identity;
    }
    publicIdentity() { return { version: 3, declaration: this.member.declaration, boot: this.member.boot }; }
    static inspect(declaration: string, boot: string): Member {
        const data = readRecord(declaration);
        const id = data.id ?? data.sub;
        if (typeof id !== "string" || !Number.isSafeInteger(data.depth) || data.depth < 0 ||
            typeof boot !== "string" || !boot.length || boot.length > 100 ||
            !["socket.io", "websocket"].includes(data.transport) ||
            !Array.isArray(data.roster) || !data.roster.length || data.roster.length > 1000 ||
            !data.roster.every((id: unknown) => typeof id === "string") ||
            new Set(data.roster).size !== data.roster.length || !data.roster.includes(id) ||
            (data.parent !== null && typeof data.parent !== "string"))
            throw new Error("Invalid server declaration");
        const url = new URL(id);
        if (url.origin !== id || (url.protocol !== "https:" &&
            !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))))
            throw new Error("Unsafe peer URL");
        const legacy = !declaration.startsWith("{");
        return { id, depth: data.depth, parent: data.parent, transport: data.transport,
            roster: data.roster, boot, seen: Date.now(),
            ...(legacy ? { certificate: declaration, publicKey: data.publicKey } : { declaration }) };
    }
    async inspectPeer(declaration: string, boot: string): Promise<Member> {
        const member = Identity.inspect(declaration, boot);
        const index = this.servers.findIndex(s => s.origin === member.id);
        if (index < 0) throw new Error("Unconfigured peer origin");
        if (member.depth !== index || member.parent !== (this.servers[index - 1]?.origin ?? null) ||
            member.transport !== this.servers[index].transport ||
            JSON.stringify(member.roster) !== JSON.stringify(this.servers.map(s => s.origin)))
            throw new Error("Peer declaration differs from configured topology");
        return member;
    }
    async statement(audience: string, claims: Record<string, unknown>, ttl = 30) {
        return JSON.stringify({ ...claims, iss: this.member.id, aud: audience,
            sub: this.member.boot, exp: Math.floor(Date.now() / 1000) + ttl });
    }
}
