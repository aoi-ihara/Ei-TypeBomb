import assert from "node:assert/strict";
import { test } from "node:test";
import { logOAuthProtocolFailure } from "../lib/mcp/authorization-server/diagnostics";

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
