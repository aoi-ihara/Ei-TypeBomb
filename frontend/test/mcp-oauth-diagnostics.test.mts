import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { NextApiRequest, NextApiResponse } from "next";
import { getAuthorizationServerConfig } from "../lib/mcp/authorization-server/config";
import {
    logOAuthProtocolFailure,
    logOAuthServerFailure,
} from "../lib/mcp/authorization-server/diagnostics";
import {
    createOAuthHandler,
    oauthDiagnosticRoute,
} from "../lib/mcp/authorization-server/http";

test("OAuth protocol diagnostics contain only fixed route and HTTP status", () => {
    const messages: unknown[][] = [];
    const previous = console.warn;
    console.warn = (...args: unknown[]) => { messages.push(args); };
    try {
        logOAuthProtocolFailure("token", 400);
        logOAuthProtocolFailure("authorize", 401);
        logOAuthProtocolFailure("token", 200);
        logOAuthProtocolFailure("token", 303);
    } finally {
        console.warn = previous;
    }
    assert.deepEqual(messages, [
        ["[MCP OAuth] endpoint returned an error", { route: "token", status: 400 }],
        ["[MCP OAuth] endpoint returned an error", { route: "authorize", status: 401 }],
    ]);
});

test("authorization resume URLs use a fixed label and never log the UID", () => {
    assert.equal(oauthDiagnosticRoute("/api/oauth/authorize"), "authorize");
    assert.equal(oauthDiagnosticRoute("/api/oauth/authorize/abc_123-xyz"), "authorize");
    assert.equal(oauthDiagnosticRoute("/api/oauth/token"), "token");
    assert.equal(oauthDiagnosticRoute("/api/oauth/register"), "register");
    assert.equal(oauthDiagnosticRoute("/api/oauth/connections"), null);
    assert.equal(oauthDiagnosticRoute("/api/oauth/authorize/uid/other"), null);
});

test("OAuth server failures log only a fixed phase and allowlisted code", () => {
    const messages: unknown[][] = [];
    const previous = console.error;
    console.error = (...args: unknown[]) => { messages.push(args); };
    try {
        const sensitive = Object.assign(
            new Error("secret=should-not-appear"),
            { code: "unrecognized_private_code" },
        );
        logOAuthServerFailure(sensitive, "database_connect");
    } finally {
        console.error = previous;
    }
    assert.deepEqual(messages, [
        ["[MCP OAuth] request could not be completed", {
            code: "operation_failed",
            stage: "database_connect",
        }],
    ]);
});

test("authorization 503 errors display as plain text, not downloads", async () => {
    const original = process.env.ETB_MCP_OAUTH_ENABLED;
    process.env.ETB_MCP_OAUTH_ENABLED = "false";
    const handler = createOAuthHandler();
    const server = createServer((req, res) => {
        void handler(req as NextApiRequest, res as NextApiResponse);
    });
    try {
        await new Promise<void>((resolve) =>
            server.listen(0, "127.0.0.1", resolve),
        );
        const { port } = server.address() as AddressInfo;
        const response = await fetch(
            `http://127.0.0.1:${port}/api/oauth/authorize`,
            { redirect: "manual" },
        );
        assert.equal(response.status, 503);
        assert.match(response.headers.get("content-type") ?? "", /^text\/plain; charset=utf-8/i);
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(response.headers.get("content-disposition"), null);
        assert.equal(
            await response.text(),
            "MCP authorization is temporarily unavailable",
        );
    } finally {
        await new Promise<void>((resolve, reject) =>
            server.close((error) => error ? reject(error) : resolve()),
        );
        if (original === undefined) delete process.env.ETB_MCP_OAUTH_ENABLED;
        else process.env.ETB_MCP_OAUTH_ENABLED = original;
    }
});

test("MCP OAuth configuration errors are classified without revealing secrets", () => {
    const keys = [
        "ETB_MCP_OAUTH_ENABLED",
        "NEXT_PUBLIC_ETB_OAUTH_ENABLED",
        "ETB_MCP_DATABASE_URL",
        "ETB_MCP_STORAGE_KEY",
        "ETB_MCP_COOKIE_KEYS",
        "ETB_MCP_SIGNING_JWKS",
    ] as const;
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
        process.env.ETB_MCP_OAUTH_ENABLED = "false";
        assert.throws(() => getAuthorizationServerConfig(), { code: "MCP_OAUTH_DISABLED" });
        process.env.ETB_MCP_OAUTH_ENABLED = "true";
        process.env.NEXT_PUBLIC_ETB_OAUTH_ENABLED = "false";
        assert.throws(() => getAuthorizationServerConfig(), { code: "MCP_OAUTH_WEB_LOGIN_DISABLED" });
        process.env.NEXT_PUBLIC_ETB_OAUTH_ENABLED = "true";
        delete process.env.ETB_MCP_DATABASE_URL;
        assert.throws(() => getAuthorizationServerConfig(), { code: "MCP_OAUTH_STORAGE_CONFIG_INVALID" });
        process.env.ETB_MCP_DATABASE_URL = "postgresql://localhost/test";
        process.env.ETB_MCP_STORAGE_KEY = Buffer.alloc(32, 1).toString("base64url");
        process.env.ETB_MCP_COOKIE_KEYS = "a".repeat(32);
        process.env.ETB_MCP_SIGNING_JWKS = "{invalid";
        assert.throws(() => getAuthorizationServerConfig(), { code: "MCP_OAUTH_SIGNING_KEYS_INVALID" });
    } finally {
        for (const key of keys) {
            const value = previous[key];
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    }
});
