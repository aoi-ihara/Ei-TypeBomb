import { generateKeyPair, exportJWK, SignJWT, importJWK } from "jose";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
const raw = process.argv.slice(2);
let existingAuthority;
if (raw[0] === "--authority") {
    raw.shift();
    existingAuthority = raw.shift();
}
const [out, ...args] = raw;
if (!out || args.length < 2)
    throw new Error(
        "Usage: node scripts/cluster-credentials.mjs NEW_PRIVATE_DIRECTORY socket.io=https://primary websocket=https://worker socket.io=https://render ...",
    );
const servers = args.map((value) => {
    const split = value.indexOf("=");
    const transport = value.slice(0, split),
        url = value.slice(split + 1);
    if (
        !["socket.io", "websocket"].includes(transport) ||
        new URL(url).origin !== url ||
        (new URL(url).protocol !== "https:" &&
            !["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    )
        throw new Error("Specify a transport and HTTPS origin");
    return { transport, url };
});
const roster = servers.map((server) => server.url);
if (new Set(roster).size !== roster.length) throw new Error("Duplicate URL");
await mkdir(out, { mode: 0o700 });
let authority, authorityKey, authorityPrivate;
if (existingAuthority) {
    const jwk = JSON.parse(await readFile(existingAuthority, "utf8"));
    const { d, ...publicJwk } = jwk;
    authorityKey = publicJwk;
    authorityPrivate = jwk;
    authority = {
        privateKey: await importJWK(jwk, "ES256"),
        publicKey: await importJWK(publicJwk, "ES256"),
    };
} else {
    authority = await generateKeyPair("ES256", { extractable: true });
    authorityKey = await exportJWK(authority.publicKey);
    authorityPrivate = await exportJWK(authority.privateKey);
}
await writeFile(
    resolve(out, "offline-authority.json"),
    JSON.stringify(authorityPrivate),
    { mode: 0o600 },
);
const deployment = [];
for (let depth = 0; depth < servers.length; depth++) {
    const pair = await generateKeyPair("ES256", { extractable: true }),
        server = servers[depth];
    const publicKey = await exportJWK(pair.publicKey);
    const certificate = await new SignJWT({
        roster,
        parent: roster[depth - 1] ?? null,
        depth,
        transport: server.transport,
        publicKey,
    })
        .setProtectedHeader({ alg: "ES256", typ: "JWT" })
        .setIssuer("etb-cluster")
        .setAudience("etb-cluster-server")
        .setSubject(server.url)
        .setIssuedAt()
        .setExpirationTime("1y")
        .sign(authority.privateKey);
    const file = `server-${depth}.json`;
    await writeFile(
        resolve(out, file),
        JSON.stringify({
            authorityKey,
            certificate,
            privateKey: await exportJWK(pair.privateKey),
        }),
        { mode: 0o600 },
    );
    deployment.push({
        PRIMARY_SERVER_URL: roster[0],
        PARENT_SERVER_URL: roster[depth - 1] ?? "",
        SERVER_PUBLIC_URL: server.url,
        CLUSTER_SERVER_TOKEN_FILE: file,
    });
}
await writeFile(
    resolve(out, "deployment.json"),
    JSON.stringify(deployment, null, 2),
    { mode: 0o600 },
);
console.log(
    "Created private server identity files and an offline authority key. Keep the authority key off every game server.",
);
