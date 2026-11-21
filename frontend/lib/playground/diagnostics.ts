import type { DecisionTrace } from "./decision-trace";
import { anonymousMemory, anonymizeReplay, snapshot } from "./replay";
import type { ItemMemoryState, AttemptEvaluation, AnswerModeResult } from "./memory";
import type { SchedulerState } from "./scheduler";
import type { getMasteryGraph } from "./mastery-graph";

export const LEARNING_DIAGNOSTICS_ENABLED = process.env.NEXT_PUBLIC_BETA_ENVIRONMENT === "true";
export type AnswerEvent = {
    at: number; itemId: string; mode: AnswerModeResult;
    evidence?: { success: boolean; firstAttemptCorrect?: boolean; hintCount?: number;
        answerWasFullyRevealed?: boolean; incorrectInputCount?: number; elapsedMs?: number;
        exposureGapMs?: number | null; choiceCount?: number; initialCueRatio?: number;
        finalCueRatio?: number; recallLatencyMs?: number | null; expectedTypingMs?: number };
    evaluation: AttemptEvaluation; before: ItemMemoryState | undefined; after: ItemMemoryState;
    schedulerAfter: SchedulerState | null;
};
export function captureDecision(trace: DecisionTrace, memories: Record<string, ItemMemoryState>,
    modes: Record<string, AnswerModeResult>, previousAnswer?: AnswerEvent | null) {
    const original = snapshot(trace.schedulerBefore, memories, modes, trace.selectedAt, 0);
    original.randomDraws = trace.randomDraws;
    const { replay, map } = anonymizeReplay(original);
    const selected = trace.selection;
    const decision = { ...trace, schedulerBefore: replay.scheduler,
        selection: selected ? { ...selected, itemId: map(selected.itemId),
            ...(selected.retry ? { retry: { ...selected.retry, itemId: map(selected.retry.itemId) } } : {}) } : null,
        candidates: trace.candidates.map(candidate => ({ ...candidate, itemId: map(candidate.itemId) })) };
    const answer = previousAnswer && trace.schedulerBefore.itemIds.includes(previousAnswer.itemId)
        ? { at: previousAnswer.at, itemId: map(previousAnswer.itemId), mode: previousAnswer.mode,
            evaluation: previousAnswer.evaluation, evidence: previousAnswer.evidence,
            before: anonymousMemory(previousAnswer.before, map(previousAnswer.itemId)),
            after: anonymousMemory(previousAnswer.after, map(previousAnswer.itemId)),
            schedulerAfter: previousAnswer.schedulerAfter ? anonymizeReplay(snapshot(previousAnswer.schedulerAfter,
                {}, modes, previousAnswer.at, 0)).replay.scheduler : null } : null;
    return { schemaVersion: 1, decision, replay, previousAnswer: answer };
}
export type CapturedDecision = ReturnType<typeof captureDecision>;
export function diagnosticJSON(captured: CapturedDecision | null,
    graph: ReturnType<typeof getMasteryGraph>, ids: readonly string[]) {
    if (!captured) return null;
    const aliases = new Map([...new Set(ids)].map((id, index) => [id, `item-${index + 1}`]));
    const value = { ...captured, masteryGraph: { ...graph,
        items: graph.items?.map(item => ({ ...item, itemId: aliases.get(item.itemId) })) } };
    const json = JSON.stringify(value, null, 2);
    if (json.length > 2_000_000) throw new Error("診断データが大きすぎます（上限2MB）。");
    return json;
}
