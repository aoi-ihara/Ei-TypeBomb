import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import {
    getAuthorizationServerConfig,
    getMcpResource,
    MCP_SCOPE,
} from "./config";
import { getMcpProvider } from "./provider";
import {
    OAuthStore,
    rateLimit,
    revokeGrant,
    withOAuthLock,
    type OAuthTransactionPhase,
} from "./store";
import { verifyMcpToken, InvalidMcpTokenError } from "./verify";
import { errors as joseErrors } from "jose";
import { errors as oauthErrors } from "oidc-provider";
import {
    logOAuthProtocolFailure,
    logOAuthServerFailure,
    type OAuthFailureStage,
} from "./diagnostics";
import { getMcpAuthenticatedUser } from "./identity";

type CurrentUser = (req: NextApiRequest) => Promise<string | null>;

async function atomicResponse(
    res: NextApiResponse,
    run: () => Promise<void>,
    onPhase?: (phase: OAuthTransactionPhase) => void,
) {
    const original = res.end;
    let finish: (() => void) | undefined;
    res.end = ((...args: Parameters<typeof res.end>) => {
        finish = () => {
            original.apply(res, args);
        };
        return res;
    }) as typeof res.end;
    try {
        await withOAuthLock(run, onPhase);
    } finally {
        res.end = original;
    }
    finish?.();
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
function textError(res: NextApiResponse, status: number, message: string) {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(message);
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

function html(
    res: NextApiResponse,
    title: string,
    content: string,
    callbackOrigin?: string,
) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader(
        "Content-Security-Policy",
        `default-src 'none'; style-src 'unsafe-inline'; form-action 'self'${callbackOrigin ? " " + callbackOrigin : ""}; frame-ancestors 'none'; base-uri 'none'`,
    );
    res.setHeader("X-Frame-Options", "DENY");
    // no-referrer makes HTML form POSTs send Origin: null, which our strict
    // same-origin guard correctly rejects. strict-origin preserves Origin for
    // HTTPS form submissions while keeping interaction paths out of Referer.
    res.setHeader("Referrer-Policy", "strict-origin");
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
        textError(res, 400, "Invalid MCP authorization request");
        return;
    }
    const client = await provider.Client.find(String(details.params.client_id));
    if (!client) throw new Error("Client not found");
    const redirectUri = details.params.redirect_uri;
    if (
        typeof redirectUri !== "string" ||
        !client.redirectUriAllowed(redirectUri)
    ) {
        throw new oauthErrors.InvalidRequest("Invalid client redirect URI");
    }
    const redirectOrigin = new URL(redirectUri).origin;
    // Only a literal CSP host source is allowed, including loopback IPv6 for
    // registered native clients. Reject unusual URL host characters rather than
    // interpolating them as CSP syntax (also covers older registrations).
    if (
        !/^https?:\/\/(?:[a-z0-9.-]+|\[[0-9a-f:]+\])(?::[0-9]+)?$/i.test(
            redirectOrigin,
        )
    ) {
        throw new oauthErrors.InvalidRequest("Invalid client redirect origin");
    }
    if (
        req.method === "GET" &&
        details.session?.accountId &&
        details.session.accountId !== user
    ) {
        // ETB Supabase Auth is the source of identity. Discard a stale MCP browser
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
            textError(res, 403, "Invalid authorization form");
            return;
        }
        if (form.get("decision") === "deny") {
            await provider.interactionFinished(
                req,
                res,
                {
                    error: "access_denied",
                    error_description: "User denied MCP access",
                },
                { mergeWithLastSubmission: false },
            );
            return;
        }
        if (form.get("decision") !== "approve") {
            res.statusCode = 400;
            res.end();
            return;
        }
        // Consent remains explicit on every authorization, but an existing
        // unexpired grant for this verified user, registered client and resource
        // is reused. withOAuthLock serializes concurrent approvals across instances.
        // Never identify clients using their self-reported display name.
        const stored = await new OAuthStore("Grant").forAccount(user);
        let grantId: string | undefined;
        for (const entry of stored.sort(
            (a, b) => Number(b.iat ?? 0) - Number(a.iat ?? 0),
        )) {
            if (
                entry.accountId !== user ||
                entry.clientId !== client.clientId ||
                typeof entry.jti !== "string"
            )
                continue;
            const existing = await provider.Grant.find(entry.jti);
            if (
                existing &&
                existing.accountId === user &&
                existing.clientId === client.clientId &&
                existing
                    .getResourceScope(getMcpResource())
                    .split(" ")
                    .includes(MCP_SCOPE)
            ) {
                grantId = existing.jti;
                break;
            }
        }
        if (!grantId) {
            const grant = new provider.Grant({
                accountId: user,
                clientId: client.clientId,
            });
            grant.addResourceScope(getMcpResource(), MCP_SCOPE);
            grantId = await grant.save();
        }
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
    if (req.headers.accept?.includes("application/json")) {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; frame-ancestors 'none'",
        );
        res.end(
            JSON.stringify({
                client: {
                    name: client.clientName || "名称未設定のアプリ",
                    uri: client.clientUri || null,
                },
                redirect_uri: redirectUri,
                scope: details.params.scope,
                csrf: csrf(user, purpose),
            }),
        );
        return;
    }
    res.statusCode = 303;
    res.setHeader("Location", "/oauth/consent?uid=" + encodeURIComponent(uid));
    res.end();
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
        // Historical deployments issued a separate grant on every approval.
        // Disconnecting one displayed client revokes all its grants so the old
        // token chains cannot silently remain authorized after removal.
        const grants = await new OAuthStore("Grant").forAccount(user);
        for (const related of grants) {
            if (
                related.accountId === user &&
                related.clientId === grant.clientId &&
                typeof related.jti === "string"
            ) {
                await revokeGrant(related.jti);
            }
        }
        res.statusCode = 303;
        res.setHeader("Location", "/api/oauth/connections");
        res.end();
        return;
    }
    const grants = await new OAuthStore("Grant").forAccount(user);
    const uniqueClients = new Map<string, string>();
    for (const grant of grants) {
        if (
            grant.accountId === user &&
            typeof grant.clientId === "string" &&
            typeof grant.jti === "string" &&
            !uniqueClients.has(grant.clientId)
        ) {
            uniqueClients.set(grant.clientId, grant.jti);
        }
    }
    const items = await Promise.all(
        [...uniqueClients].map(async ([clientId, grantId]) => {
            const client = await getMcpProvider().Client.find(clientId);
            return `<li><p>${escape(client?.clientName || "名称未設定のアプリ")}</p><p>${escape(client?.clientUri || clientId)}</p>
            <form method="post"><input type="hidden" name="csrf" value="${escape(csrf(user, "connections"))}">
            <input type="hidden" name="grant_id" value="${escape(grantId)}"><button>接続を解除</button></form></li>`;
        }),
    );
    html(
        res,
        "MCP接続の管理",
        `<p>解除すると、この接続のアクセストークンと更新トークンが失効します。</p><ul>${items.join("")}</ul>${items.length ? "" : "<p>接続はありません。</p>"}<a href="/">Ei-TypeBombへ戻る</a>`,
    );
}

/** Collapse authorization resume paths to a fixed, non-sensitive label.
 * Never include a resume UID or other URL segment in diagnostics. */
export function oauthDiagnosticRoute(pathname: string) {
    if (
        pathname === "/api/oauth/authorize" ||
        /^\/api\/oauth\/authorize\/[A-Za-z0-9_-]+$/.test(pathname)
    )
        return "authorize";
    const route = pathname.startsWith("/api/oauth/")
        ? pathname.slice("/api/oauth/".length)
        : "";
    if (
        route === "token" ||
        route === "register" ||
        route === "revoke" ||
        route === "jwks"
    )
        return route;
    return null;
}

/** Current-user injection is for integration tests; production verifies the
 * ETB Supabase browser session through Auth getUser. */
export function createOAuthHandler(
    currentUser: CurrentUser = getMcpAuthenticatedUser,
) {
    return async (req: NextApiRequest, res: NextApiResponse) => {
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        let stage: OAuthFailureStage = "configuration";
        const onPhase = (phase: OAuthTransactionPhase) => {
            stage = phase;
        };
        try {
            const { issuer } = getAuthorizationServerConfig();
            stage = "request_validation";
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
                /^\/api\/oauth\/interaction\/[A-Za-z0-9_-]+$/.test(
                    url.pathname,
                );
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
                stage = "identity";
                const user = await currentUser(req);
                if (!user) {
                    res.statusCode = 303;
                    res.setHeader(
                        "Location",
                        "/sign-in?next=" + encodeURIComponent(url.pathname),
                    );
                    res.end();
                    return;
                }
                stage = "database_connect";
                await atomicResponse(
                    res,
                    () => {
                        stage = "interaction";
                        return url.pathname === "/api/oauth/connections"
                            ? connections(req, res, user)
                            : interaction(
                                  req,
                                  res,
                                  user,
                                  url.pathname.split("/").at(-1)!,
                              );
                    },
                    onPhase,
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
                res.setHeader(
                    "Access-Control-Allow-Methods",
                    "GET, POST, OPTIONS",
                );
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
                textError(res, 400, "Only query response mode is supported");
                return;
            }
            stage = "database_connect";
            await atomicResponse(
                res,
                async () => {
                    stage = "rate_limit";
                    // Fixed server-selected budgets sum to 600. No endpoint can
                    // spend another's reserved capacity, including authorize's
                    // resume URLs. Do not trust headers or claimed client IDs.
                    // Check the route first: rejected floods must not charge all.
                    const budget = isAuthorize
                        ? { name: "v2:authorize", limit: 180 }
                        : url.pathname === "/api/oauth/token"
                          ? { name: "v2:token", limit: 240 }
                          : url.pathname === "/api/oauth/revoke"
                            ? { name: "v2:revoke", limit: 60 }
                            : url.pathname === "/api/oauth/jwks"
                              ? { name: "v2:jwks", limit: 90 }
                              : { name: "register", limit: 30 };
                    if (
                        !(await rateLimit(budget.name, budget.limit)) ||
                        !(await rateLimit("v2:all", 600))
                    ) {
                        res.statusCode = 429;
                        res.setHeader("Retry-After", "60");
                        res.end();
                        return;
                    }
                    if (
                        url.pathname === "/api/oauth/revoke" &&
                        req.method === "POST"
                    ) {
                        stage = "revocation";
                        // The provider deliberately rejects JWTs at its revocation endpoint.
                        // Resolve our JWT to a short-lived opaque surrogate for the same
                        // grant, then let the provider authenticate the client and apply its
                        // native revocation policy. The surrogate is never returned to a
                        // client and is not accepted by MCP (which requires an at+jwt).
                        const form = await body(req);
                        const token = form.get("token") ?? "";
                        if (token.includes(".")) {
                            form.set(
                                "token",
                                "unknown-structured-access-token",
                            );
                            try {
                                const principal = await verifyMcpToken(token);
                                const provider = getMcpProvider();
                                const client = await provider.Client.find(
                                    principal.clientId,
                                );
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
                    stage = "provider";
                    await getMcpProvider().callback()(req, res);
                },
                onPhase,
            );
            // oidc-provider handles OAuth protocol errors without throwing.
            // Capture only a fixed route label and the final status.
            const route = oauthDiagnosticRoute(url.pathname);
            if (
                res.statusCode >= 400 &&
                (route === "authorize" ||
                    route === "token" ||
                    route === "register" ||
                    route === "revoke" ||
                    route === "jwks")
            )
                logOAuthProtocolFailure(route, res.statusCode);
        } catch (error) {
            const invalidRequest =
                error instanceof oauthErrors.SessionNotFound ||
                error instanceof oauthErrors.InvalidRequest;
            if (!invalidRequest) logOAuthServerFailure(error, stage);
            if (!res.headersSent) {
                for (const name of ["Location", "Content-Length", "Set-Cookie"])
                    res.removeHeader(name);
                res.statusCode = invalidRequest ? 400 : 503;
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                const route = oauthDiagnosticRoute(
                    new URL(req.url ?? "/", "https://invalid.example").pathname,
                );
                if (
                    route === "authorize" ||
                    route === "token" ||
                    route === "register" ||
                    route === "revoke" ||
                    route === "jwks"
                )
                    logOAuthProtocolFailure(route, res.statusCode);
                res.end(
                    invalidRequest
                        ? "Invalid or expired authorization request"
                        : "MCP authorization is temporarily unavailable",
                );
            } else if (!res.writableEnded) res.end();
        }
    };
}
