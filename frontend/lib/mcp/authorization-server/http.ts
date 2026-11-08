import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  getAuthorizationServerConfig,
  getMcpResource,
  MCP_SCOPE,
} from "./config";
import { getMcpProvider } from "./provider";
import { OAuthStore, rateLimit, revokeGrant, withOAuthLock } from "./store";
import { verifyMcpToken, InvalidMcpTokenError } from "./verify";
import { errors as joseErrors } from "jose";
import { errors as oauthErrors } from "oidc-provider";
import { oauthCookieNames } from "../../auth/oauth-config";
import { verifyOAuthAccessToken } from "../../auth/oauth-tokens";

type CurrentUser = (req: NextApiRequest) => Promise<string | null>;

/** Koa and this UI use res.end for finite JSON/HTML responses. Keep that final
 * write until the durable transaction has committed, so failed commits never
 * deliver authorization codes or tokens. Streaming endpoints are not exposed. */
async function atomicResponse(res: NextApiResponse, run: () => Promise<void>) {
  const original = res.end;
  let finish: (() => void) | undefined;
  res.end = ((...args: Parameters<typeof res.end>) => {
    finish = () => {
      original.apply(res, args);
    };
    return res;
  }) as typeof res.end;
  try {
    await withOAuthLock(run);
  } finally {
    res.end = original;
  }
  finish?.();
}
async function rcAccountUser(req: NextApiRequest) {
  const token = req.cookies[oauthCookieNames().access];
  if (!token) return null;
  try {
    await verifyOAuthAccessToken(token);
    const response = await fetch(
      process.env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/user",
      {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: "Bearer " + token,
        },
      },
    );
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user.id === "string" && user.is_anonymous !== true
      ? user.id
      : null;
  } catch {
    return null;
  }
}

function csrf(user: string, purpose: string) {
  const { issuer, cookieKeys } = getAuthorizationServerConfig();
  return createHmac("sha256", cookieKeys[0])
    .update(JSON.stringify([issuer, user, purpose]))
    .digest("base64url");
}
function equal(a: string | null, b: string) {
  const aa = Buffer.from(a ?? ""),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c]!,
  );

function html(res: NextApiResponse, title: string, content: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.end(
    `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | Ei-TypeBomb</title><style>body{font:16px/1.8 system-ui;background:#f5f5f5;color:#171717;margin:0}main{max-width:560px;margin:6vh auto;padding:28px;background:white;border-radius:20px}h1{font-size:24px}p,dd{overflow-wrap:anywhere}dt{font-weight:bold}dd{margin:0 0 16px}button{font:inherit;padding:10px 24px;margin:12px 12px 0 0;border-radius:24px;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #2255dd}small{color:#555}</style><main><p>Ei-TypeBomb · MCP</p><h1>${escape(title)}</h1>${content}</main></html>`,
  );
}

async function body(req: NextApiRequest) {
  if (
    !(req.headers["content-type"] ?? "").startsWith(
      "application/x-www-form-urlencoded",
    )
  ) {
    throw new oauthErrors.InvalidRequest("Invalid form content type");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new oauthErrors.InvalidRequest("Form too large");
    chunks.push(Buffer.from(chunk));
  }
  const params = new URLSearchParams(Buffer.concat(chunks).toString());
  for (const key of params.keys())
    if (params.getAll(key).length !== 1)
      throw new oauthErrors.InvalidRequest("Duplicate parameter");
  return params;
}

async function interaction(
  req: NextApiRequest,
  res: NextApiResponse,
  user: string,
  uid: string,
) {
  const provider = getMcpProvider();
  // Signed, HttpOnly provider cookie must select the same interaction as URL.
  const details = await provider.interactionDetails(req, res);
  if (
    details.uid !== uid ||
    details.params.resource !== getMcpResource() ||
    details.params.scope !== MCP_SCOPE
  ) {
    res.statusCode = 400;
    res.end("Invalid MCP authorization request");
    return;
  }
  const client = await provider.Client.find(String(details.params.client_id));
  if (!client) throw new Error("Client not found");
  if (
    req.method === "GET" &&
    details.session?.accountId &&
    details.session.accountId !== user
  ) {
    // rcAccount is the source of identity. Discard a stale provider browser
    // session before re-running the validated request for the new account.
    // Existing grants remain with their original owner.
    const session = await provider.Session.findByUid(details.session.uid);
    await session?.destroy();
    await details.destroy();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(details.params)) {
      if (typeof value === "string") params.set(key, value);
    }
    res.statusCode = 409;
    html(
      res,
      "アカウントが切り替わりました",
      `<p>現在ログイン中のアカウントで接続を再開してください。</p><a href="${escape("/api/oauth/authorize?" + params)}">接続を再開する</a>`,
    );
    return;
  }
  const purpose = `${uid}:${details.exp}`;
  if (req.method === "POST") {
    const form = await body(req);
    if (!equal(form.get("csrf"), csrf(user, purpose))) {
      res.statusCode = 403;
      res.end("Invalid authorization form");
      return;
    }
    if (form.get("decision") === "deny") {
      await provider.interactionFinished(
        req,
        res,
        { error: "access_denied", error_description: "User denied MCP access" },
        { mergeWithLastSubmission: false },
      );
      return;
    }
    if (form.get("decision") !== "approve") {
      res.statusCode = 400;
      res.end();
      return;
    }
    // Each approval creates its own grant, never silently reusing a grant
    // from another rcAccount user or a previously approved application.
    const grant = new provider.Grant({
      accountId: user,
      clientId: client.clientId,
    });
    grant.addResourceScope(getMcpResource(), MCP_SCOPE);
    const grantId = await grant.save();
    await provider.interactionFinished(
      req,
      res,
      {
        login: { accountId: user },
        consent: { grantId },
      },
      { mergeWithLastSubmission: false },
    );
    return;
  }
  html(
    res,
    "ルームへのアクセスを許可しますか？",
    `
        <p>次のアプリに、あなたが所有するEi-TypeBombルームの<strong>作成・閲覧・変更</strong>を許可します。</p>
        <dl><dt>アプリ名（登録者による申告）</dt><dd>${escape(client.clientName || "名称未設定のアプリ")}</dd>
        <dt>アプリのウェブサイト（登録者による申告）</dt><dd>${escape(client.clientUri || "未登録")}</dd>
        <dt>接続先</dt><dd>${escape(details.params.redirect_uri)}</dd>
        <dt>対象のETB環境</dt><dd>${escape(getMcpResource())}</dd>
        <dt>ログイン中のアカウントID</dt><dd>${escape(user)}</dd></dl>
        <p>アプリ名だけで信頼せず、接続を開始したアプリと接続先を確認してください。</p>
        <form method="post"><input type="hidden" name="csrf" value="${escape(csrf(user, purpose))}">
        <button name="decision" value="deny">拒否</button><button name="decision" value="approve">許可する</button></form>
        <p><small>許可は30日間有効です。<a href="/api/oauth/connections">MCP接続の管理</a>からいつでも解除できます。</small></p>`,
  );
}

async function connections(
  req: NextApiRequest,
  res: NextApiResponse,
  user: string,
) {
  if (req.method === "POST") {
    const form = await body(req);
    if (!equal(form.get("csrf"), csrf(user, "connections"))) {
      res.statusCode = 403;
      res.end();
      return;
    }
    const id = form.get("grant_id") ?? "";
    const grant = await new OAuthStore("Grant").find(id);
    if (!grant || grant.accountId !== user) {
      res.statusCode = 404;
      res.end();
      return;
    }
    await revokeGrant(id);
    res.statusCode = 303;
    res.setHeader("Location", "/api/oauth/connections");
    res.end();
    return;
  }
  const grants = await new OAuthStore("Grant").forAccount(user);
  const items = await Promise.all(
    grants.map(async (grant) => {
      const client = await getMcpProvider().Client.find(String(grant.clientId));
      return `<li><p>${escape(client?.clientName || "名称未設定のアプリ")}</p><p>${escape(client?.clientUri || grant.clientId)}</p>
            <form method="post"><input type="hidden" name="csrf" value="${escape(csrf(user, "connections"))}">
            <input type="hidden" name="grant_id" value="${escape(grant.jti)}"><button>接続を解除</button></form></li>`;
    }),
  );
  html(
    res,
    "MCP接続の管理",
    `<p>解除すると、この接続のアクセストークンと更新トークンが失効します。</p><ul>${items.join("")}</ul>${items.length ? "" : "<p>接続はありません。</p>"}<a href="/">Ei-TypeBombへ戻る</a>`,
  );
}

/** Current-user injection is for integration tests; production always uses the
 * existing rcAccount web access cookie, JWKS validation and Auth getUser API. */
export function createOAuthHandler(currentUser: CurrentUser = rcAccountUser) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const { issuer } = getAuthorizationServerConfig();
      const url = new URL(req.url ?? "/", issuer);
      if (req.headers.host !== new URL(issuer).host) {
        res.statusCode = 421;
        res.end();
        return;
      }
      // Vercel terminates TLS. Set canonical proxy headers ourselves;
      // incoming forwarded host/proto values never select issuer/URLs.
      req.headers["x-forwarded-proto"] = "https";
      req.headers["x-forwarded-host"] = new URL(issuer).host;
      const isUI =
        url.pathname === "/api/oauth/connections" ||
        /^\/api\/oauth\/interaction\/[A-Za-z0-9_-]+$/.test(url.pathname);
      if (isUI) {
        res.setHeader("Vary", "Cookie");
        if (!["GET", "POST"].includes(req.method ?? "")) {
          res.statusCode = 405;
          res.end();
          return;
        }
        if (req.method === "POST" && req.headers.origin !== issuer) {
          res.statusCode = 403;
          res.end();
          return;
        }
        const user = await currentUser(req);
        if (!user) {
          res.statusCode = 303;
          res.setHeader(
            "Location",
            "/auth/sign-in?next=" + encodeURIComponent(url.pathname),
          );
          res.end();
          return;
        }
        await atomicResponse(res, () =>
          url.pathname === "/api/oauth/connections"
            ? connections(req, res, user)
            : interaction(req, res, user, url.pathname.split("/").at(-1)!),
        );
        return;
      }
      const paths = new Set([
        "/api/oauth/authorize",
        "/api/oauth/token",
        "/api/oauth/register",
        "/api/oauth/revoke",
        "/api/oauth/jwks",
      ]);
      // Include the library's authorization resume URL, but expose no
      // unrelated provider endpoints (userinfo, password or implicit).
      if (
        !paths.has(url.pathname) &&
        !/^\/api\/oauth\/authorize\/[A-Za-z0-9_-]+$/.test(url.pathname)
      ) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (req.method === "OPTIONS") {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization",
        );
        res.statusCode = 204;
        res.end();
        return;
      }
      const isAuthorize = url.pathname.startsWith("/api/oauth/authorize");
      const expectedMethod =
        isAuthorize || url.pathname.endsWith("/jwks") ? "GET" : "POST";
      if (req.method !== expectedMethod) {
        res.statusCode = 405;
        res.setHeader("Allow", expectedMethod + ", OPTIONS");
        res.end();
        return;
      }
      if (
        isAuthorize &&
        url.searchParams.has("response_mode") &&
        url.searchParams.get("response_mode") !== "query"
      ) {
        res.statusCode = 400;
        res.end("Only query response mode is supported");
        return;
      }
      await atomicResponse(res, async () => {
        if (
          !(await rateLimit("all", 600)) ||
          (url.pathname === "/api/oauth/register" &&
            !(await rateLimit("register", 30)))
        ) {
          res.statusCode = 429;
          res.setHeader("Retry-After", "60");
          res.end();
          return;
        }
        if (url.pathname === "/api/oauth/revoke" && req.method === "POST") {
          // The provider deliberately rejects JWTs at its revocation endpoint.
          // Resolve our JWT to a short-lived opaque surrogate for the same
          // grant, then let the provider authenticate the client and apply its
          // native revocation policy. The surrogate is never returned to a
          // client and is not accepted by MCP (which requires an at+jwt).
          const form = await body(req);
          const token = form.get("token") ?? "";
          if (token.includes(".")) {
            form.set("token", "unknown-structured-access-token");
            try {
              const principal = await verifyMcpToken(token);
              const provider = getMcpProvider();
              const client = await provider.Client.find(principal.clientId);
              if (client) {
                const surrogate = new provider.AccessToken({
                  accountId: principal.userId,
                  client,
                  gty: "revocation",
                  grantId: principal.grantId,
                  scope: MCP_SCOPE,
                });
                form.set("token", await surrogate.save());
                form.set("token_type_hint", "access_token");
              }
            } catch (error) {
              // Unknown/invalid JWTs still go through client authentication;
              // infrastructure failures must not claim a successful revoke.
              if (
                !(error instanceof InvalidMcpTokenError) &&
                !(error instanceof joseErrors.JOSEError)
              )
                throw error;
            }
          }
          // The provider supports an upstream parsed body when its
          // stream has ended; preserve duplicate rejection above.
          req.body = Object.fromEntries(form);
        }
        await getMcpProvider().callback()(req, res);
      });
    } catch (error) {
      const invalidRequest =
        error instanceof oauthErrors.SessionNotFound ||
        error instanceof oauthErrors.InvalidRequest;
      if (!invalidRequest)
        console.error("[MCP OAuth] request could not be completed");
      if (!res.headersSent) {
        for (const name of ["Location", "Content-Length", "Set-Cookie"])
          res.removeHeader(name);
        res.statusCode = invalidRequest ? 400 : 503;
        res.end(
          invalidRequest
            ? "Invalid or expired authorization request"
            : "MCP authorization is temporarily unavailable",
        );
      } else if (!res.writableEnded) res.end();
    }
  };
}
