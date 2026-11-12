import type { RecallProgress } from "../playground/memory";
import {
    onlineRecallDiagnosticFields,
    onlineSchedulerDiagnostic,
    type OnlineMemorySession,
    type OnlineLearningDiagnostic,
} from "./memory-session";

type Attempt = {
    key: string;
    itemId: string;
    answerLength: number;
    progress: RecallProgress;
};
export type RecallDiagnosticTracker = {
    active: Attempt | null;
    finishedKey: string | null;
};
export const createRecallDiagnosticTracker = (): RecallDiagnosticTracker => ({
    active: null,
    finishedKey: null,
});
export const recallAttemptKey = (
    gameId: string,
    bomb: { id: string; turn: number },
) => `${gameId}:${bomb.id}:${bomb.turn}`;

export const trackRecallDiagnostic = (
    tracker: RecallDiagnosticTracker,
    attempt: Attempt,
    session: OnlineMemorySession,
): OnlineLearningDiagnostic | null => {
    if (tracker.finishedKey === attempt.key) return null;
    const started = tracker.active?.key !== attempt.key;
    tracker.active = attempt;
    return started ? recallStartedDiagnostic(tracker, session) : null;
};

// Registration is sent once per turn (and after reconnect), never per keypress.
// It lets the server authenticate a terminal summary after seats have cleared.
export const recallStartedDiagnostic = (
    tracker: RecallDiagnosticTracker,
    session: OnlineMemorySession,
): OnlineLearningDiagnostic | null =>
    tracker.active
        ? {
              ...onlineSchedulerDiagnostic(
                  session,
                  "recall_started",
                  tracker.active.itemId,
              ),
              attemptKey: tracker.active.key,
          }
        : null;

export const completeRecallDiagnostic = (tracker: RecallDiagnosticTracker) => {
    const key = tracker.active?.key;
    if (key) tracker.finishedKey = key;
    tracker.active = null;
    return key;
};

export const finishRecallDiagnostic = (
    tracker: RecallDiagnosticTracker,
    session: OnlineMemorySession | null,
    reason: string,
): OnlineLearningDiagnostic | null => {
    const attempt = tracker.active;
    if (!attempt || !session) return null;
    completeRecallDiagnostic(tracker);
    return {
        ...onlineSchedulerDiagnostic(session, "unfinished", attempt.itemId),
        ...onlineRecallDiagnosticFields(attempt.progress, attempt.answerLength),
        attemptKey: attempt.key,
        endReason: reason,
        answerLength: attempt.answerLength,
        finalCueRatio:
            (attempt.progress.assistedPositions?.length ?? 0) /
            Math.max(1, attempt.answerLength),
        answerWasFullyRevealed: attempt.progress.answerWasFullyRevealed,
        answerCorrect: false,
    };
};

export const finishRecallDiagnosticForSnapshot = (
    tracker: RecallDiagnosticTracker,
    session: OnlineMemorySession | null,
    room: {
        gameId?: string;
        isStart: boolean;
        users: { id: string }[];
        bombs?: {
            id: string;
            turn: number;
            holder: number;
            wordIndex?: number;
        }[];
        losers?: { id: string }[];
    },
    userId: string | null,
) => {
    if (!tracker.active) return null;
    const bomb = room.bombs?.find((b) => room.users[b.holder]?.id === userId);
    if (
        room.isStart &&
        bomb &&
        room.gameId &&
        recallAttemptKey(room.gameId, bomb) === tracker.active.key
    )
        return null;
    const reason = room.losers?.some((loser) => loser.id === userId)
        ? "exploded"
        : room.isStart
          ? "turn_changed"
          : "game_ended";
    return finishRecallDiagnostic(tracker, session, reason);
};
