import {
    authenticationFailure,
    transientRecoveryFailure,
} from "../../shared/distributed/recovery";
import { ClientError } from "../../shared/validation";
import assert from "node:assert/strict";
import test from "node:test";
import {
    connectionError,
    connectionErrorDetails,
    connectionLog,
    isTerminalConnectionError,
} from "../../../frontend/lib/room/connectionLogger";

test("connection logs keep stable tags and structured public metadata", () => {
    const original = console.log;
    const entries: unknown[][] = [];
    console.log = (...args: unknown[]) => { entries.push(args); };
    try {
        connectionLog("CONNECTED", "Connected to primary server", {
            server: "https://primary.example",
            tier: "primary",
            durationMs: 42,
            // An accidental secret in caller metadata must never be logged.
            jwtToken: "private-room-token",
            sessionToken: "private-page-token",
            displayName: "private-player",
        });
    } finally {
        console.log = original;
    }
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], "[CONNECTED] Connected to primary server");
    assert.deepEqual(entries[0][1], {
        server: "https://primary.example",
        tier: "primary",
        durationMs: 42,
    });
    assert.doesNotMatch(JSON.stringify(entries), /private-/);
});

test("connection errors use console.error without forwarding raw error text or credentials", () => {
    const original = console.error;
    const entries: unknown[][] = [];
    console.error = (...args: unknown[]) => { entries.push(args); };
    try {
        connectionError("FALLBACK", "Ownership verification rejected", {
            server: "https://secondary.example",
            previousOwner: "https://primary.example",
            httpStatus: 409,
            ...connectionErrorDetails({
                code: "CHECKPOINT_UNAVAILABLE",
                retryable: false,
                message: "Bearer private-jwt",
                jwtToken: "private-jwt",
            }),
        });
    } finally {
        console.error = original;
    }
    assert.equal(entries.length, 1);
    assert.equal(entries[0][0], "[FALLBACK] Ownership verification rejected");
    assert.deepEqual(entries[0][1], {
        server: "https://secondary.example",
        previousOwner: "https://primary.example",
        httpStatus: 409,
        code: "CHECKPOINT_UNAVAILABLE",
        retryable: false,
    });
    assert.doesNotMatch(JSON.stringify(entries), /private-jwt/);
});

test("known network failures retain actionable reason but unexpected messages stay private", () => {
    assert.deepEqual(connectionErrorDetails(new Error("Routing endpoint unavailable")), {
        errorType: "Error",
        reason: "Routing endpoint unavailable",
    });
    const details = connectionErrorDetails({
        code: "VOTER_STATE_LOST",
        retryable: false,
        message: "https://example.com/route?jwtToken=private-secret",
    });
    assert.equal(details.code, "VOTER_STATE_LOST");
    assert.equal(details.retryable, false);
    assert.equal(details.reason, undefined);
    assert.doesNotMatch(JSON.stringify(details), /private-secret/);
});

test("only known transfer refusals expose a retryable diagnostic code", () => {
    assert.deepEqual(transientRecoveryFailure(new Error("Owner has not approved transfer")), {
        code: "OWNER_TRANSFER_NOT_APPROVED",
        retryable: true,
    });
    assert.equal(transientRecoveryFailure(new Error("credential=secret")), undefined);
});

test("invalid and expired room JWTs produce an unrecoverable authentication error", () => {
    for (const message of [
        "認証トークンが無効または有効期限切れです。ルームに入り直してください。",
        "認証情報が不正です。ルームに入り直してください。",
    ]) {
        const packet = { message, ...authenticationFailure(new ClientError(message)) };
        assert.equal(packet.code, "AUTH_FAILED");
        assert.equal(packet.retryable, false);
        assert.equal(isTerminalConnectionError(packet), true);
        assert.equal(connectionErrorDetails(packet).code, "AUTH_FAILED");
    }
});

test("auth failures are terminal even when the retryable flag is absent", () => {
    // Prior behavior incorrectly showed Connecting forever on a live socket.
    assert.equal(isTerminalConnectionError({ code: "AUTH_FAILED" }), true);
    assert.equal(isTerminalConnectionError({ message: "認証失敗" }), false);
    assert.equal(isTerminalConnectionError({ retryable: true }), false);
    assert.equal(isTerminalConnectionError(null), false);
});

test("connection errors stay retryable while certified checkpoint loss remains terminal", () => {
    assert.equal(isTerminalConnectionError({ code: "NETWORK_UNAVAILABLE" }), false);
    assert.equal(isTerminalConnectionError({ retryable: true }), false);
    const checkpoint = authenticationFailure(new Error("Expected checkpoint is unavailable"));
    assert.equal(checkpoint.code, "CHECKPOINT_UNAVAILABLE");
    assert.equal(checkpoint.retryable, false);
    assert.equal(isTerminalConnectionError(checkpoint), true);
});
