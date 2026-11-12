import assert from "node:assert/strict";
import test from "node:test";
import { processLearningDiagnostic } from "../../shared/learningDiagnostic";
import type { Room } from "../../shared/types";

const room = {
    id: "room",
    users: [{ id: "player" }],
    items: [{ id: "word" }],
} as Room;
const start = {
    kind: "recall_started",
    itemId: "word",
    attemptKey: "game:bomb:1",
};
const finish = { ...start, kind: "unfinished", endReason: "exploded" };

test("routine diagnostics are disabled by default; authenticated mismatches remain visible", () => {
    assert.equal(
        processLearningDiagnostic(start, room, "player", null, false)
            .registered,
        null,
    );
    assert.equal(
        processLearningDiagnostic(
            { kind: "recall", itemId: "word" },
            room,
            "player",
            null,
            false,
        ).fields,
        null,
    );
    const mismatch = processLearningDiagnostic(
        { kind: "recall", itemId: "word", reconciled: true },
        room,
        "player",
        null,
        false,
    );
    assert.equal(mismatch.fields?.reconciled, true);
    assert.equal(
        processLearningDiagnostic(
            { kind: "recall", itemId: "word", reconciled: true },
            room,
            "spectator",
            null,
            false,
        ).fields,
        null,
    );
});

test("an authenticated attempt may finish once after the server clears all game seats", () => {
    const registered = processLearningDiagnostic(
        start,
        room,
        "player",
        null,
        true,
    );
    assert.equal(registered.fields, null);
    assert.ok(registered.registered);
    const ended = { ...room, users: [] };
    const result = processLearningDiagnostic(
        finish,
        ended,
        "player",
        registered.registered,
        true,
    );
    assert.equal(result.fields?.endReason, "exploded");
    assert.equal(result.registered, null);
    assert.equal(
        processLearningDiagnostic(
            finish,
            ended,
            "player",
            result.registered,
            true,
        ).fields,
        null,
    );
});

test("spectators, mismatched attempt keys and unknown items cannot submit terminal summaries", () => {
    assert.equal(
        processLearningDiagnostic(start, room, "spectator", null, true)
            .registered,
        null,
    );
    const registered = processLearningDiagnostic(
        start,
        room,
        "player",
        null,
        true,
    ).registered;
    assert.equal(
        processLearningDiagnostic(
            { ...finish, attemptKey: "other" },
            room,
            "player",
            registered,
            true,
        ).fields,
        null,
    );
    assert.equal(
        processLearningDiagnostic(
            { ...finish, itemId: "other" },
            room,
            "player",
            registered,
            true,
        ).fields,
        null,
    );
    assert.equal(
        processLearningDiagnostic(
            { ...start, attemptKey: "x".repeat(101) },
            room,
            "player",
            null,
            true,
        ).registered,
        null,
    );
});

test("successful recall clears registration and keeps only bounded diagnostic scalar fields", () => {
    const registered = processLearningDiagnostic(
        start,
        room,
        "player",
        null,
        true,
    ).registered;
    const result = processLearningDiagnostic(
        {
            ...start,
            kind: "recall",
            diagnosticVersion: "online-learning-v2",
            hintEvidenceVersion: "auto-hint-input-v1",
            displayedHintCount: 2,
            preHintCorrectChars: 9,
            assistedHintChars: 1,
            displayedFullAnswer: true,
            finalCueRatio: 0.1,
            answer: "never log answer text",
            input: "private",
            assistedPositions: [9],
            elapsedMs: Infinity,
            memoryEvidence: "x".repeat(101),
        },
        room,
        "player",
        registered,
        true,
    );
    assert.equal(result.registered, null);
    assert.equal(result.fields?.assistedHintChars, 1);
    assert.equal(result.fields?.displayedHintCount, 2);
    for (const key of [
        "answer",
        "input",
        "assistedPositions",
        "elapsedMs",
        "memoryEvidence",
    ])
        assert.ok(!(key in result.fields!));
});
