import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request as httpRequest } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { generateKeyPair, exportJWK, decodeJwt, SignJWT } from "jose";
import type { NextApiRequest, NextApiResponse } from "next";
import { createOAuthHandler } from "../lib/mcp/authorization-server/http";
import {
  closeOAuthDatabase,
  OAuthStore,
} from "../lib/mcp/authorization-server/store";
import { getAuthorizationServerMetadata } from "../lib/mcp/authorization-server/config";
import { verifyMcpToken } from "../lib/mcp/authorization-server/verify";
import { getMcpProvider } from "../lib/mcp/authorization-server/provider";
import { authenticateMcpRequest } from "../lib/mcp/oauth";

// A dedicated disposable PostgreSQL database is mandatory: no in-memory
// substitute for the cross-instance storage and locking security properties.
const databaseUrl = process.env.ETB_MCP_TEST_DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "Set ETB_MCP_TEST_DATABASE_URL to a disposable local PostgreSQL database",
  );
const testDb = new URL(databaseUrl);
if (
  !["localhost", "127.0.0.1", "[::1]"].includes(testDb.hostname) ||
  !testDb.pathname.endsWith("_test")
) {
  throw new Error(
    "Integration tests require a local database with a name ending in _test",
  );
}
const issuer = "https://etb.example";
const resource = issuer + "/api/mcp";
const user = "11111111-1111-4111-8111-111111111111";
const otherUser = "22222222-2222-4222-8222-222222222222";

test("MCP authorization server with real PostgreSQL and HTTP", async (t) => {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  const jwk = {
    ...(await exportJWK(privateKey)),
    kid: "integration",
    alg: "ES256",
    use: "sig",
  };
  Object.assign(process.env, {
    ETB_BASE_URL: issuer,
    ETB_MCP_OAUTH_ENABLED: "true",
    ETB_MCP_DATABASE_URL: databaseUrl,
    ETB_MCP_SIGNING_JWKS: JSON.stringify({ keys: [jwk] }),
    ETB_MCP_STORAGE_KEY: randomBytes(32).toString("base64url"),
    ETB_MCP_COOKIE_KEYS: randomBytes(48).toString("base64url"),
  });
  const db = new Pool({ connectionString: databaseUrl });
  // Supabase has these roles already; a vanilla local PostgreSQL test database
  // need not modify cluster-global roles just to execute the migration.
  const migration = (
    await readFile(
      new URL(
        "../../supabase/migrations/20261108120000_mcp_oauth_storage.sql",
        import.meta.url,
      ),
      "utf8",
    )
  ).replaceAll("public, anon, authenticated", "public");
  await db.query("drop schema if exists etb_mcp_oauth cascade");
  await db.query(migration);
  const handler = createOAuthHandler(
    async (req) => (req.headers["x-test-user"] as string) || null,
  );
  const server = createServer((req, res) => {
    (req as NextApiRequest).cookies = {};
    handler(req as NextApiRequest, res as NextApiResponse);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  async function rawFetch(url: string, init: RequestInit = {}) {
    return new Promise<Response>((resolve, reject) => {
      const headers = Object.fromEntries(new Headers(init.headers));
      const req = httpRequest(url, { method: init.method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const h = new Headers();
          for (let i = 0; i < res.rawHeaders.length; i += 2)
            h.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
          resolve(
            new Response(
              res.statusCode === 204 ? null : Buffer.concat(chunks),
              { status: res.statusCode, headers: h },
            ),
          );
        });
      });
      req.on("error", reject);
      req.end(init.body?.toString());
    });
  }
  const jar = new Map<string, string>();
  async function request(
    path: string,
    init: RequestInit = {},
    browser = false,
    who = user,
  ) {
    const headers = new Headers(init.headers);
    headers.set("host", "etb.example");
    if (browser) {
      headers.set("cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
      if (who) headers.set("x-test-user", who);
      if (init.method === "POST") headers.set("origin", issuer);
    }
    const response = await rawFetch(base + path, {
      ...init,
      headers,
      redirect: "manual",
    });
    if (browser)
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";")[0];
        const i = pair.indexOf("=");
        jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
    return response;
  }
  const form = (values: Record<string, string>): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  async function register(
    redirect = "https://client.example/callback",
    extra = {},
  ) {
    return request("/api/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [redirect],
        client_name: "<script>alert(1)</script>",
        client_uri: "https://client.example",
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        ...extra,
      }),
    });
  }
  let clientId: string;
  async function authorize(overrides: Record<string, string> = {}) {
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: "https://client.example/callback",
      resource,
      scope: "etb:rooms",
      state: "client-state",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      ...overrides,
    });
    return {
      verifier,
      response: await request("/api/oauth/authorize?" + params, {}, true),
    };
  }
  async function flow(decision = "approve") {
    const { verifier, response } = await authorize();
    assert.equal(response.status, 303, await response.clone().text());
    const interaction = new URL(response.headers.get("location")!, issuer)
      .pathname;
    const page = await request(interaction, {}, true);
    assert.equal(page.status, 303, await page.clone().text());
    assert.equal(
      page.headers.get("location"),
      "/oauth/consent?uid=" + interaction.split("/").at(-1),
    );
    const dataResponse = await request(
      interaction, { headers: { Accept: "application/json" } }, true,
    );
    assert.equal(dataResponse.status, 200, await dataResponse.clone().text());
    assert.ok(dataResponse.headers.get("content-type")?.includes("application/json"));
    const details = await dataResponse.json();
    assert.equal(details.scope, "etb:rooms");
    assert.equal(details.client.name, "<script>alert(1)</script>");
    assert.equal(details.client.uri, "https://client.example");
    assert.equal(details.redirect_uri, "https://client.example/callback");
    const csrf = details.csrf;
    assert.ok(csrf);
    const approved = await request(interaction, form({ csrf, decision }), true);
    assert.equal(approved.status, 303, await approved.clone().text());
    const resume = new URL(approved.headers.get("location")!, issuer);
    const callback = await request(resume.pathname + resume.search, {}, true);
    assert.equal(callback.status, 303, await callback.clone().text());
    const location = callback.headers.get("location")!;
    const result = new URL(location);
    assert.equal(result.origin, "https://client.example");
    assert.equal(result.searchParams.get("state"), "client-state");
    return { verifier, result };
  }
  async function tokens() {
    const { verifier, result } = await flow();
    const values = {
      grant_type: "authorization_code",
      client_id: clientId,
      code: result.searchParams.get("code")!,
      code_verifier: verifier,
      redirect_uri: "https://client.example/callback",
      resource,
    };
    const response = await request("/api/oauth/token", form(values));
    assert.equal(response.status, 200, await response.clone().text());
    return { values, token: await response.json() };
  }
  try {
    await t.test(
      "DCR, discovery and public JWKS use the dedicated issuer",
      async () => {
        const registration = await register();
        assert.equal(
          registration.status,
          201,
          await registration.clone().text(),
        );
        const client = await registration.json();
        clientId = client.client_id;
        assert.ok(clientId);
        assert.equal(client.client_secret, undefined);
        const metadata = getAuthorizationServerMetadata();
        assert.equal(metadata.issuer, issuer);
        assert.equal(
          metadata.registration_endpoint,
          issuer + "/api/oauth/register",
        );
        const jwks = await (await request("/api/oauth/jwks")).json();
        assert.equal(jwks.keys[0].kid, "integration");
        assert.equal(jwks.keys[0].d, undefined);
      },
    );
    await t.test(
      "reject insecure/wildcard/fragment redirects and unsupported client authentication",
      async () => {
        for (const uri of [
          "http://client.example/callback",
          "https://*.example/cb",
          "https://client.example/cb#x",
          "https://u:p@client.example/cb",
          "https://client.example;upgrade-insecure-requests/cb",
          "javascript:alert(1)",
        ]) {
          assert.equal((await register(uri)).status, 400, uri);
        }
        assert.equal(
          (
            await register(undefined, {
              token_endpoint_auth_method: "private_key_jwt",
            })
          ).status,
          400,
        );
        assert.equal(
          (await register(undefined, { jwks_uri: "https://127.0.0.1/keys" }))
            .status,
          400,
        );
      },
    );
    await t.test(
      "consent JSON validates callback and excludes client-controlled CSP directives",
      async () => {
        const redirect =
          "https://other.example:8443/callback?x=;frame-src%20%2A";
        const registration = await register(redirect, {
          redirect_uris: [redirect, "https://unused.example/callback"],
        });
        assert.equal(
          registration.status,
          201,
          await registration.clone().text(),
        );
        const client = await registration.json();
        const { response } = await authorize({
          client_id: client.client_id,
          redirect_uri: redirect,
        });
        const path = new URL(response.headers.get("location")!, issuer)
          .pathname;
        const page = await request(
          path, { headers: { Accept: "application/json" } }, true,
        );
        assert.equal(page.status, 200, await page.clone().text());
        assert.equal(
          page.headers.get("content-security-policy"),
          "default-src 'none'; frame-ancestors 'none'",
        );
        const details = await page.json();
        assert.equal(details.redirect_uri, redirect);
        assert.ok(details.csrf);
      },
    );
    await t.test(
      "requires PKCE S256, exact redirect, requested scope and current-environment resource",
      async () => {
        for (const overrides of [
          { code_challenge: "", code_challenge_method: "" },
          { code_challenge_method: "plain" },
          { redirect_uri: "https://evil.example/callback" },
          { resource: "https://beta.example/api/mcp" },
          { resource: "" },
        ] as Record<string, string>[]) {
          const { response } = await authorize(overrides);
          assert.ok(
            !(response.headers.get("location") ?? "").includes("/interaction/"),
          );
          assert.ok(response.status === 400 || response.status === 303);
        }
      },
    );
    await t.test(
      "login return path, signed interaction cookie, CSRF, user binding and explicit deny",
      async () => {
        const { response } = await authorize();
        const path = new URL(response.headers.get("location")!, issuer)
          .pathname;
        const noLogin = await request(path, {}, true, "");
        assert.equal(noLogin.status, 303);
        assert.ok(
          noLogin.headers.get("location")!.startsWith("/sign-in?next="),
        );
        const noCookie = await request(path);
        assert.equal(noCookie.status, 303);
        assert.equal(
          (await request(path, { headers: { "x-test-user": user } })).status,
          400,
        );
        const originalCookies = new Map(jar);
        jar.set("etb-mcp-interaction.sig", "tampered");
        assert.equal((await request(path, {}, true)).status, 400);
        jar.clear();
        for (const [key, value] of originalCookies) jar.set(key, value);
        const details = await (await request(
          path, { headers: { Accept: "application/json" } }, true,
        )).json();
        const csrf = details.csrf;
        // Keep rejecting opaque/missing/foreign origins; fix the page's
        // referrer policy rather than weakening the form's Origin guard.
        for (const origin of ["null", "https://evil.example"]) {
          assert.equal(
            (
              await request(path, {
                ...form({ csrf, decision: "approve" }),
                headers: {
                  "content-type": "application/x-www-form-urlencoded",
                  origin,
                },
              })
            ).status,
            403,
          );
        }
        assert.equal(
          (await request(path, form({ csrf, decision: "approve" }))).status,
          403,
        );
        assert.equal(
          (
            await request(
              path,
              form({ csrf: "wrong", decision: "approve" }),
              true,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              path,
              form({ csrf, decision: "approve" }),
              true,
              otherUser,
            )
          ).status,
          403,
        );
        const { result } = await flow("deny");
        assert.equal(result.searchParams.get("error"), "access_denied");
      },
    );
    await t.test(
      "authorization-code exchange issues a resource-bound JWT accepted by MCP",
      async () => {
        const { token } = await tokens();
        assert.equal(token.token_type.toLowerCase(), "bearer");
        assert.ok(token.refresh_token);
        const payload = decodeJwt(token.access_token);
        assert.equal(payload.iss, issuer);
        assert.equal(payload.aud, resource);
        assert.equal(payload.sub, user);
        assert.equal(payload.scope, "etb:rooms");
        assert.equal(payload.client_id, clientId);
        assert.equal((await verifyMcpToken(token.access_token)).userId, user);
        assert.equal(
          (
            await authenticateMcpRequest(
              new Request(resource, {
                headers: { authorization: "Bearer " + token.access_token },
              }),
            )
          )?.userId,
          user,
        );
        const row = await db.query(
          "select payload from etb_mcp_oauth.models limit 1",
        );
        assert.ok(!row.rows[0].payload.includes(user));
        assert.equal(await authenticateMcpRequest(new Request(resource)), null);
      },
    );
    await t.test(
      "repeat approval reuses a grant and legacy duplicates are grouped and fully revoked",
      async () => {
        const first = await tokens();
        const second = await tokens();
        const firstGrantId = decodeJwt(first.token.access_token).grant_id as string;
        const secondGrantId = decodeJwt(second.token.access_token).grant_id as string;
        assert.equal(firstGrantId, secondGrantId);
        assert.equal((await verifyMcpToken(second.token.access_token)).grantId, firstGrantId);

        // Simulate historical duplicate grants from the same client. A second
        // account using that client must remain isolated when disconnecting.
        const provider = getMcpProvider();
        const legacy = new provider.Grant({ accountId: user, clientId });
        legacy.addResourceScope(resource, "etb:rooms");
        const legacyGrantId = await legacy.save();
        const anotherAccount = new provider.Grant({
          accountId: otherUser,
          clientId,
        });
        anotherAccount.addResourceScope(resource, "etb:rooms");
        const otherGrantId = await anotherAccount.save();

        const page = await request("/api/oauth/connections", {}, true);
        assert.equal(page.status, 200);
        const markup = await page.text();
        assert.equal((markup.match(/<li>/g) ?? []).length, 1);
        assert.ok(markup.includes("ChatGPT") === false); // This test client has its own name.
        const csrf = markup.match(/name="csrf" value="([^"]+)"/)![1];
        const disconnected = await request(
          "/api/oauth/connections",
          form({ csrf, grant_id: firstGrantId }),
          true,
        );
        assert.equal(disconnected.status, 303);
        await assert.rejects(verifyMcpToken(first.token.access_token));
        await assert.rejects(verifyMcpToken(second.token.access_token));
        assert.equal(await new OAuthStore("Grant").find(legacyGrantId), undefined);
        assert.ok(await new OAuthStore("Grant").find(otherGrantId));

        // Explicit approval after disconnect must issue a fresh grant.
        const third = await tokens();
        assert.notEqual(decodeJwt(third.token.access_token).grant_id, firstGrantId);
        assert.equal((await verifyMcpToken(third.token.access_token)).userId, user);
      },
    );
    await t.test(
      "wrong verifier, wrong redirect and code replay fail; concurrent redemption is single-use",
      async () => {
        const { verifier, result } = await flow();
        const values = {
          grant_type: "authorization_code",
          client_id: clientId,
          code: result.searchParams.get("code")!,
          code_verifier: verifier,
          redirect_uri: "https://client.example/callback",
          resource,
        };
        assert.equal(
          (
            await request(
              "/api/oauth/token",
              form({
                ...values,
                code_verifier: randomBytes(32).toString("base64url"),
              }),
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/api/oauth/token",
              form({
                ...values,
                redirect_uri: "https://evil.example/callback",
              }),
            )
          ).status,
          400,
        );
        const responses = await Promise.all([
          request("/api/oauth/token", form(values)),
          request("/api/oauth/token", form(values)),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
      },
    );
    await t.test(
      "refresh rotates, cannot change resource, and replay revokes the grant including JWTs",
      async () => {
        const { token } = await tokens();
        const values = {
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: token.refresh_token,
          resource,
        };
        const denied = await tokens();
        assert.equal(
          (
            await request(
              "/api/oauth/token",
              form({
                ...values,
                refresh_token: denied.token.refresh_token,
                resource: "https://other.example/api/mcp",
              }),
            )
          ).status,
          400,
        );
        const refreshed = await request("/api/oauth/token", form(values));
        assert.equal(refreshed.status, 200, await refreshed.clone().text());
        const next = await refreshed.json();
        assert.notEqual(next.refresh_token, token.refresh_token);
        assert.equal(decodeJwt(next.access_token).aud, resource);
        assert.equal(
          (await request("/api/oauth/token", form(values))).status,
          400,
        );
        await assert.rejects(verifyMcpToken(next.access_token));
        assert.equal(
          (
            await request(
              "/api/oauth/token",
              form({ ...values, refresh_token: next.refresh_token }),
            )
          ).status,
          400,
        );
      },
    );
    await t.test(
      "refresh revocation, JWT revocation and user disconnect invalidate grants immediately",
      async () => {
        for (const kind of ["refresh", "access"]) {
          const { token } = await tokens();
          const response = await request(
            "/api/oauth/revoke",
            form({
              client_id: clientId,
              token:
                kind === "refresh" ? token.refresh_token : token.access_token,
            }),
          );
          assert.equal(response.status, 200, await response.clone().text());
          await assert.rejects(verifyMcpToken(token.access_token));
        }
        const { token } = await tokens();
        const payload = decodeJwt(token.access_token);
        const page = await request("/api/oauth/connections", {}, true);
        assert.equal(page.headers.get("referrer-policy"), "strict-origin");
        assert.equal(
          page.headers.get("content-security-policy"),
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        );
        const markup = await page.text();
        const csrf = markup.match(/name="csrf" value="([^"]+)"/)![1];
        assert.equal(
          (
            await request(
              "/api/oauth/connections",
              form({ csrf, grant_id: payload.grant_id as string }),
              true,
              otherUser,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "/api/oauth/connections",
              form({ csrf, grant_id: payload.grant_id as string }),
              true,
            )
          ).status,
          303,
        );
        await assert.rejects(verifyMcpToken(token.access_token));
      },
    );
    await t.test(
      "reject normal Supabase Auth JWT, wrong issuer/audience/type/expiry/signature and revoked storage",
      async () => {
        const { token } = await tokens();
        const original = decodeJwt(token.access_token);
        for (const changes of [
          { iss: "https://supabase.example/auth/v1", aud: "authenticated" },
          { aud: "https://beta.example/api/mcp" },
          { iss: "https://attacker.example" },
          { exp: 1 },
          { scope: "openid" },
          { sub: "" },
        ]) {
          const jwt = await new SignJWT({ ...original, ...changes })
            .setProtectedHeader({
              alg: "ES256",
              kid: "integration",
              typ: "at+jwt",
            })
            .sign(privateKey);
          await assert.rejects(verifyMcpToken(jwt));
        }
        const badType = await new SignJWT(original)
          .setProtectedHeader({ alg: "ES256", kid: "integration", typ: "JWT" })
          .sign(privateKey);
        await assert.rejects(verifyMcpToken(badType));
        const alien = await generateKeyPair("ES256");
        const forged = await new SignJWT(original)
          .setProtectedHeader({
            alg: "ES256",
            kid: "integration",
            typ: "at+jwt",
          })
          .sign(alien.privateKey);
        await assert.rejects(verifyMcpToken(forged));
        await new OAuthStore("Grant").destroy(original.grant_id as string);
        await assert.rejects(verifyMcpToken(token.access_token));
      },
    );
    await t.test(
      "confidential DCR clients must authenticate at exchange, refresh and JWT revocation",
      async () => {
        const publicClientId = clientId;
        try {
          for (const method of ["client_secret_basic", "client_secret_post"]) {
            const registration = await register(undefined, {
              token_endpoint_auth_method: method,
            });
            assert.equal(
              registration.status,
              201,
              await registration.clone().text(),
            );
            const client = await registration.json();
            assert.ok(client.client_secret);
            clientId = client.client_id;
            const { verifier, result } = await flow();
            const values = {
              grant_type: "authorization_code",
              client_id: clientId,
              code: result.searchParams.get("code")!,
              code_verifier: verifier,
              redirect_uri: "https://client.example/callback",
              resource,
            };
            const authenticated = (
              values: Record<string, string>,
              secret = client.client_secret,
            ) => {
              const init = form(
                method === "client_secret_post"
                  ? { ...values, client_secret: secret }
                  : values,
              );
              if (method === "client_secret_basic")
                init.headers = {
                  ...init.headers,
                  Authorization:
                    "Basic " +
                    Buffer.from(clientId + ":" + secret).toString("base64"),
                };
              return init;
            };
            assert.equal(
              (await request("/api/oauth/token", form(values))).status,
              401,
            );
            assert.equal(
              (
                await request(
                  "/api/oauth/token",
                  authenticated(values, "wrong"),
                )
              ).status,
              401,
            );
            assert.equal(
              (
                await request(
                  "/api/oauth/token",
                  form({ ...values, client_id: publicClientId }),
                )
              ).status,
              400,
            );
            const exchange = await request(
              "/api/oauth/token",
              authenticated(values),
            );
            assert.equal(exchange.status, 200, await exchange.clone().text());
            const token = await exchange.json();
            const refresh = {
              grant_type: "refresh_token",
              client_id: clientId,
              refresh_token: token.refresh_token,
              resource,
            };
            assert.equal(
              (await request("/api/oauth/token", form(refresh))).status,
              401,
            );
            const next = await request(
              "/api/oauth/token",
              authenticated(refresh),
            );
            assert.equal(next.status, 200);
            const rotated = await next.json();
            const revoke = { client_id: clientId, token: rotated.access_token };
            assert.equal(
              (await request("/api/oauth/revoke", form(revoke))).status,
              401,
            );
            assert.equal(
              (await verifyMcpToken(rotated.access_token)).userId,
              user,
            );
            assert.equal(
              (
                await request(
                  "/api/oauth/revoke",
                  authenticated(revoke, "wrong"),
                )
              ).status,
              401,
            );
            assert.equal(
              (await request("/api/oauth/revoke", authenticated(revoke)))
                .status,
              200,
            );
            await assert.rejects(verifyMcpToken(rotated.access_token));
          }
        } finally {
          clientId = publicClientId;
        }
      },
    );
    await t.test(
      "concurrent refresh redemption revokes the chain after reuse",
      async () => {
        const { token } = await tokens();
        const values = {
          grant_type: "refresh_token",
          client_id: clientId,
          refresh_token: token.refresh_token,
          resource,
        };
        const responses = await Promise.all([
          request("/api/oauth/token", form(values)),
          request("/api/oauth/token", form(values)),
        ]);
        assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
        const next = await responses.find((r) => r.status === 200)!.json();
        await assert.rejects(verifyMcpToken(next.access_token));
      },
    );
    await t.test(
      "database commit failure cannot deliver a successful registration",
      async () => {
        await db.query(`create function etb_mcp_oauth.reject_test_commit() returns trigger language plpgsql as $$
                begin raise exception 'injected commit failure'; return new; end $$;
                create constraint trigger test_commit_failure after insert on etb_mcp_oauth.models
                deferrable initially deferred for each row when (new.model='Client')
                execute function etb_mcp_oauth.reject_test_commit()`);
        try {
          const response = await register();
          assert.equal(response.status, 503);
          assert.ok(!(await response.text()).includes("client_id"));
        } finally {
          await db.query(
            "drop trigger test_commit_failure on etb_mcp_oauth.models; drop function etb_mcp_oauth.reject_test_commit()",
          );
        }
      },
    );
    await t.test(
      "private storage has RLS and no public schema access",
      async () => {
        const result = await db.query(
          "select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='etb_mcp_oauth' and c.relkind='r'",
        );
        assert.equal(result.rows.length, 2);
        assert.ok(result.rows.every((r) => r.relrowsecurity));
        const acl = await db.query(
          "select a.* from pg_namespace n, lateral aclexplode(n.nspacl) a where n.nspname='etb_mcp_oauth' and a.grantee=0 and a.privilege_type='USAGE'",
        );
        assert.equal(acl.rows.length, 0);
      },
    );
    await t.test(
      "ETB account switch discards the stale MCP browser session before new approval",
      async () => {
        const { response } = await authorize();
        const path = new URL(response.headers.get("location")!, issuer)
          .pathname;
        const switched = await request(path, {}, true, otherUser);
        assert.equal(switched.status, 409);
        assert.ok((await switched.text()).includes("接続を再開する"));
      },
    );
    await t.test(
      "anonymous JWKS and registration floods cannot spend reserved OAuth capacity",
      async () => {
        const clear = () => db.query(
          "delete from etb_mcp_oauth.rate_limits where issuer=$1", [issuer],
        );
        const count = async (bucket: string) => {
          const { rows } = await db.query(
            "select count from etb_mcp_oauth.rate_limits where issuer=$1 and bucket=$2",
            [issuer, createHash("sha256").update(bucket).digest("hex")],
          );
          return Number(rows[0]?.count ?? 0);
        };
        const seed = (bucket: string, count: number) => db.query(
          `insert into etb_mcp_oauth.rate_limits (issuer,bucket,window_start,count)
           values ($1,$2,date_trunc('minute',now()),$3)
           on conflict (issuer,bucket) do update set
             window_start=excluded.window_start,count=excluded.count`,
          [issuer, createHash("sha256").update(bucket).digest("hex"), count],
        );
        const minute = async () => (await db.query(
          "select date_trunc('minute',now())::text as window",
        )).rows[0].window as string;
        // The budgets intentionally reset at a database minute boundary. Retry
        // only when that clock changes; stable-window assertion failures remain
        // failures, and a passing attempt must also stay within one window.
        for (let attempt = 0; attempt < 3; attempt++) {
          await clear();
          const { token } = await tokens();
          await clear();
          const started = await minute();
          try {
            // Seed the old shared budget too: a rolling deployment's previous
            // anonymous traffic must not poison the new reserved allowances.
            await seed("all", 600);
            await seed("v2:jwks", 90);
            await seed("v2:all", 90);
            for (let i = 0; i < 600; i++) {
              const denied = await request("/api/oauth/jwks");
              assert.equal(denied.status, 429);
              assert.equal(denied.headers.get("retry-after"), "60");
            }
            assert.equal(await count("v2:all"), 90,
              "rejected JWKS calls must not spend other endpoints' budgets");

            await seed("register", 30);
            assert.equal((await register()).status, 429);
            assert.equal(await count("v2:all"), 90);

            // Initial authorization and its resume use the reserved authorize
            // budget; a full real consent/code/PKCE/token flow still succeeds.
            await tokens();
            const refreshed = await request("/api/oauth/token", form({
              grant_type: "refresh_token", client_id: clientId,
              refresh_token: token.refresh_token, resource,
            }));
            assert.equal(refreshed.status, 200, await refreshed.clone().text());
            const refreshedToken = await refreshed.json();

            // Exhaust token admission too. Revocation has a distinct reservation.
            await seed("v2:token", 240);
            const before = await count("v2:all");
            assert.equal((await request("/api/oauth/token", form({}))).status, 429);
            assert.equal(await count("v2:all"), before);
            const revoked = await request("/api/oauth/revoke", form({
              client_id: clientId, token: refreshedToken.access_token,
              token_type_hint: "access_token",
            }));
            assert.equal(revoked.status, 200, await revoked.clone().text());
            await assert.rejects(verifyMcpToken(refreshedToken.access_token));

            // The overall ceiling remains enforced even for an available route.
            await clear();
            await seed("v2:all", 600);
            assert.equal((await request("/api/oauth/jwks")).status, 429);
            if (await minute() === started) return;
          } catch (error) {
            if (await minute() === started) throw error;
          } finally {
            await clear();
          }
        }
        assert.fail("Quota test could not finish within one database minute");
      },
    );
    await t.test(
      "host spoofing, cross-origin forms and registration abuse fail closed",
      async () => {
        const spoof = await rawFetch(base + "/api/oauth/jwks", {
          headers: { host: "attacker.example" },
        });
        assert.equal(spoof.status, 421);
        assert.equal(
          (
            await request("/api/oauth/connections", {
              ...form({}),
              headers: {
                "content-type": "application/x-www-form-urlencoded",
                origin: "https://evil.example",
              },
            })
          ).status,
          403,
        );
        await db.query(
          `insert into etb_mcp_oauth.rate_limits (issuer,bucket,window_start,count)
           values ($1,$2,date_trunc('minute',now()),31)
           on conflict (issuer,bucket) do update set
             window_start=excluded.window_start,count=excluded.count`,
          [issuer, createHash("sha256").update("register").digest("hex")],
        );
        assert.equal((await register()).status, 429);
        process.env.ETB_MCP_OAUTH_ENABLED = "false";
        assert.equal((await request("/api/oauth/jwks")).status, 503);
        await assert.rejects(verifyMcpToken("anything"));
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closeOAuthDatabase();
    await db.end();
  }
});
