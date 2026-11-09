/** Manual real-browser fixture. Local-only disposable DB and simulated user;
 * never contacts rcAccount, never reads deployment keys, never grants live access.
 * A local TLS-offload shim maps the fixture's HTTP loopback origins to the
 * canonical HTTPS issuer/client origins consumed by the production handler.
 */
import { createServer } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { exportJWK, generateKeyPair } from "jose";
import type { NextApiRequest, NextApiResponse } from "next";
import { createOAuthHandler } from "../../lib/mcp/authorization-server/http";
import { verifyMcpToken } from "../../lib/mcp/authorization-server/verify";
import { closeOAuthDatabase } from "../../lib/mcp/authorization-server/store";

const databaseUrl =
  process.env.ETB_MCP_BROWSER_TEST_DATABASE_URL ??
  "postgresql://localhost/etb_mcp_oauth_browser_test";
const dbUrl = new URL(databaseUrl);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname) ||
  dbUrl.pathname !== "/etb_mcp_oauth_browser_test"
) {
  throw new Error(
    "Browser fixture requires local etb_mcp_oauth_browser_test database",
  );
}
const issuer = "https://issuer.example";
const clientOrigin = "https://client.example";
const userId = "11111111-1111-4111-8111-111111111111";
const { privateKey } = await generateKeyPair("ES256", { extractable: true });
Object.assign(process.env, {
  ETB_BASE_URL: issuer,
  ETB_MCP_OAUTH_ENABLED: "true",
  NEXT_PUBLIC_ETB_OAUTH_ENABLED: "false",
  ETB_MCP_DATABASE_URL: databaseUrl,
  ETB_MCP_STORAGE_KEY: randomBytes(32).toString("base64url"),
  ETB_MCP_COOKIE_KEYS: randomBytes(48).toString("base64url"),
  ETB_MCP_SIGNING_JWKS: JSON.stringify({
    keys: [
      {
        ...(await exportJWK(privateKey)),
        kid: "browser-fixture",
        alg: "ES256",
        use: "sig",
      },
    ],
  }),
});
const db = new Pool({ connectionString: databaseUrl });
const migration = (
  await readFile(
    new URL(
      "../../../supabase/migrations/20261108120000_mcp_oauth_storage.sql",
      import.meta.url,
    ),
    "utf8",
  )
).replaceAll("public, anon, authenticated", "public");
await db.query("drop schema if exists etb_mcp_oauth cascade");
await db.query(migration);

const pending = new Map<string, string>();
const stats = { callbacks: 0, denials: 0, exchanges: 0, verified: 0 };
const handler = createOAuthHandler(async () => userId);
const client = createServer(async (req, res) => {
  const url = new URL(req.url!, callbackBase);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  const verifier = pending.get(url.searchParams.get("state") ?? "");
  if (!verifier) {
    res.statusCode = 400;
    res.end("Unknown client state");
    return;
  }
  pending.delete(url.searchParams.get("state")!);
  stats.callbacks++;
  if (url.searchParams.get("error") === "access_denied") {
    stats.denials++;
    res.end("<h1>拒否が接続元へ返りました</h1><p>Local fixture only</p>");
    return;
  }
  try {
    const response = await fetch(issuerBase + "/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code: url.searchParams.get("code") ?? "",
        code_verifier: verifier,
        redirect_uri: clientOrigin + "/callback",
        resource: issuer + "/api/mcp",
      }),
    });
    if (!response.ok) throw new Error("Token exchange rejected");
    const tokens = await response.json();
    stats.exchanges++;
    const principal = await verifyMcpToken(tokens.access_token);
    if (principal.userId !== userId) throw new Error("Wrong principal");
    stats.verified++;
    res.end(
      "<h1>認可・コールバック・コード交換・MCP JWT検証が成功しました</h1><p>Local fixture only</p>",
    );
  } catch {
    res.statusCode = 500;
    res.end("Browser fixture callback failed");
  }
});
await new Promise<void>((resolve) => client.listen(0, "127.0.0.1", resolve));
const callbackBase = `http://localhost:${(client.address() as { port: number }).port}`;
const server = createServer(async (req, res) => {
  if (req.url === "/fixture/status") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(stats));
    return;
  }
  if (req.url === "/start") {
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    pending.set(state, verifier);
    const params = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: clientOrigin + "/callback",
      resource: issuer + "/api/mcp",
      scope: "etb:rooms",
      state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    res.writeHead(302, { Location: "/api/oauth/authorize?" + params });
    res.end();
    return;
  }
  // Test-only TLS-offload mapping. Preserve every cookie/path/header and only
  // translate the two known local origins; a foreign Origin remains foreign.
  req.headers.host = new URL(issuer).host;
  if (req.headers.origin === issuerBase) req.headers.origin = issuer;
  (req as NextApiRequest).cookies = {};
  const original = res.setHeader.bind(res);
  res.setHeader = ((
    name: string,
    value: string | number | readonly string[],
  ) => {
    if (
      typeof value === "string" &&
      ["location", "content-security-policy"].includes(name.toLowerCase())
    ) {
      value = value
        .replaceAll(clientOrigin, callbackBase)
        .replaceAll(issuer, issuerBase);
    }
    return original(name, value);
  }) as typeof res.setHeader;
  await handler(req as NextApiRequest, res as NextApiResponse);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const issuerBase = `http://localhost:${(server.address() as { port: number }).port}`;
const registered = await fetch(issuerBase + "/api/oauth/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "Local browser fixture",
    redirect_uris: [clientOrigin + "/callback"],
    response_types: ["code"],
    grant_types: ["authorization_code", "refresh_token"],
    token_endpoint_auth_method: "none",
  }),
});
if (registered.status !== 201) throw new Error("Fixture DCR failed");
const clientId = (await registered.json()).client_id;
console.log(
  JSON.stringify({
    start: issuerBase + "/start",
    status: issuerBase + "/fixture/status",
    callback: callbackBase,
  }),
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  server.close();
  client.close();
  await closeOAuthDatabase();
  await db.end();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
