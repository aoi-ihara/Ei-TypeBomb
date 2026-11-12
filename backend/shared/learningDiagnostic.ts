import type { Room } from "./types";

type RegisteredAttempt = { key: string; itemId: string } | null;
const allowedFields = new Set([
    "kind",
    "diagnosticVersion",
    "itemId",
    "schedulerTurn",
    "schedulerCycle",
    "schedulerReason",
    "cycleQueueRemaining",
    "pendingRetryCount",
    "suspendedWordCount",
    "lastUserItemId",
    "reconciled",
    "previousRecommendedItemId",
    "retryNeed",
    "memoryEvidence",
    "independentRecall",
    "retryCountBefore",
    "hintCount",
    "revealedHintChars",
    "answerLength",
    "finalCueRatio",
    "answerWasFullyRevealed",
    "elapsedMs",
    "elapsedSincePresentationMs",
    "answerCorrect",
    "attemptKey",
    "endReason",
    "hintEvidenceVersion",
    "displayedHintCount",
    "preHintCorrectChars",
    "assistedHintChars",
    "displayedFullAnswer",
    "attemptCount",
    "incorrectInputCount",
]);

// Client diagnostics are untrusted summaries, never gameplay commands. Only
// bounded scalar fields may be written; registration never produces a log.
export const processLearningDiagnostic = (
    payload: unknown,
    room: Room,
    playerId: string,
    registered: RegisteredAttempt,
    enabled: boolean,
) => {
    const result = {
        registered,
        fields: null as Record<string, string | number | boolean | null> | null,
    };
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return result;
    const source = payload as Record<string, unknown>;
    if (!enabled && source.reconciled !== true) return result;
    if (
        ![
            "recommendation",
            "recall",
            "selection",
            "recall_started",
            "unfinished",
        ].includes(String(source.kind)) ||
        typeof source.itemId !== "string" ||
        !room.items.some((item) => item.id === source.itemId)
    )
        return result;
    const participant = room.users.some((user) => user.id === playerId);
    if (source.kind === "recall_started") {
        if (
            enabled &&
            participant &&
            typeof source.attemptKey === "string" &&
            source.attemptKey.length > 0 &&
            source.attemptKey.length <= 100
        )
            result.registered = {
                key: source.attemptKey,
                itemId: source.itemId,
            };
        return result;
    }
    if (source.kind === "unfinished") {
        if (
            !enabled ||
            !registered ||
            registered.key !== source.attemptKey ||
            registered.itemId !== source.itemId
        )
            return result;
        result.registered = null;
    } else {
        if (!participant) return result;
        if (source.kind === "recall" && registered?.key === source.attemptKey)
            result.registered = null;
    }
    const fields: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(source)) {
        if (!allowedFields.has(key)) continue;
        if (
            value === null ||
            typeof value === "boolean" ||
            (typeof value === "string" && value.length <= 100) ||
            (typeof value === "number" &&
                Number.isFinite(value) &&
                Math.abs(value) <= 1_000_000_000)
        )
            fields[key] = value;
    }
    result.fields = fields;
    return result;
};
