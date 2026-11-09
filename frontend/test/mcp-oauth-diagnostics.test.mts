import assert from "node:assert/strict";
import { test } from "node:test";
import { logOAuthProtocolFailure } from "../lib/mcp/authorization-server/diagnostics";
import { oauthDiagnosticRoute } from "../lib/mcp/authorization-server/http";

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
