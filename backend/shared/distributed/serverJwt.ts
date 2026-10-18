import type { Ownership } from "./types";

const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
const json = (value: unknown) =>
    encode(new TextEncoder().encode(JSON.stringify(value)));
/** Short-lived, recipient- and room-scoped sender proof. Only the control RPC
 * verifies it; no peer receives another server's reusable credential/key. */
export async function signReplication(
    token: string,
    issuer: string,
    audience: string,
    own: Ownership,
): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = json({ alg: "HS256", typ: "JWT" });
    const payload = json({
        iss: issuer,
        aud: audience,
        sub: own.roomId,
        instance: own.instance,
        epoch: own.epoch,
        revision: own.revision,
        iat: now,
        exp: now + 10,
    });
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(token),
    );
    const key = await crypto.subtle.importKey(
        "raw",
        digest,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${header}.${payload}`),
    );
    return `${header}.${payload}.${encode(new Uint8Array(signature))}`;
}
