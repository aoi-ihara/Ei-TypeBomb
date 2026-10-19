import type { ServerInfo } from "./types";
const bytes = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value));
const enc = (value: Uint8Array) =>
    btoa(String.fromCharCode(...value))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
const dec = (value: string) =>
    Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
        c.charCodeAt(0),
    );
export async function sign(
    key: CryptoKey,
    claims: Record<string, unknown>,
): Promise<string> {
    const input = `${enc(bytes({ alg: "ES256", typ: "JWT" }))}.${enc(bytes(claims))}`;
    return `${input}.${enc(new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input))))}`;
}
export async function verify(
    token: string,
    jwk: JsonWebKey,
    audience: string,
    issuer?: string,
): Promise<Record<string, unknown>> {
    if (typeof token !== "string" || token.length > 8192)
        throw new Error("Invalid signed proof");
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT");
    const header = JSON.parse(new TextDecoder().decode(dec(parts[0])));
    const data = JSON.parse(new TextDecoder().decode(dec(parts[1])));
    if (
        header.alg !== "ES256" ||
        header.typ !== "JWT" ||
        data.aud !== audience ||
        (issuer && data.iss !== issuer) ||
        !Number.isFinite(data.exp) ||
        data.exp <= Date.now() / 1000
    )
        throw new Error("Invalid JWT claims");
    const key = await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
    );
    if (
        !(await crypto.subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            key,
            dec(parts[2]),
            new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
        ))
    )
        throw new Error("Invalid signature");
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
export type Credential = {
    privateKey: JsonWebKey;
    certificate: string;
    authorityKey: JsonWebKey;
};
export type Member = ServerInfo & {
    boot: string;
    certificate: string;
    publicKey: JsonWebKey;
    roster: string[];
};
export class Identity {
    private constructor(
        readonly credential: Credential,
        readonly member: Member,
        readonly key: CryptoKey,
    ) {}
    static async create(
        bundle: string,
        boot = crypto.randomUUID(),
    ): Promise<Identity> {
        const credential = JSON.parse(bundle) as Credential;
        const info = await Identity.inspect(
            credential.certificate,
            credential.authorityKey,
            boot,
        );
        const key = await crypto.subtle.importKey(
            "jwk",
            credential.privateKey,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["sign"],
        );
        const identity = new Identity(credential, info, key);
        await verify(
            await identity.proof(info.id, { test: true }),
            info.publicKey,
            info.id,
            info.id,
        );
        return identity;
    }
    static async inspect(
        certificate: string,
        authority: JsonWebKey,
        boot: string,
    ): Promise<Member> {
        const data = await verify(
            certificate,
            authority,
            "etb-cluster-server",
            "etb-cluster",
        );
        if (
            typeof data.sub !== "string" ||
            !Number.isSafeInteger(data.depth) ||
            (data.depth as number) < 0 ||
            typeof boot !== "string" ||
            boot.length > 100 ||
            !["socket.io", "websocket"].includes(data.transport as string) ||
            !data.publicKey ||
            !Array.isArray(data.roster) ||
            data.roster.length < 2 ||
            data.roster.length > 1000 ||
            !data.roster.every((id: unknown) => typeof id === "string") ||
            new Set(data.roster).size !== data.roster.length ||
            !data.roster.includes(data.sub) ||
            (data.parent !== null && typeof data.parent !== "string")
        )
            throw new Error("Invalid server certificate");
        const url = new URL(data.sub);
        if (
            url.origin !== data.sub ||
            (url.protocol !== "https:" &&
                !["127.0.0.1", "localhost"].includes(url.hostname))
        )
            throw new Error("Unsafe peer URL");
        return {
            id: data.sub,
            parent: data.parent as string | null,
            depth: data.depth as number,
            transport: data.transport as Member["transport"],
            seen: Date.now(),
            certificate,
            publicKey: data.publicKey as JsonWebKey,
            roster: data.roster as string[],
            boot,
        };
    }
    proof(audience: string, claims: Record<string, unknown>, ttl = 30) {
        return sign(this.key, {
            ...claims,
            iss: this.member.id,
            aud: audience,
            sub: this.member.boot,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + ttl,
        });
    }
}
