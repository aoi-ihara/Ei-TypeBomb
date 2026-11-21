import type { SchedulerState, Selection } from "./scheduler";

export const SCHEDULER_VERSION = "adaptive-v1";
export type CandidateDecision = {
    itemId: string;
    mode?: "input" | "selection";
    introduced?: boolean;
    stage: string;
    status: string;
    score?: number | null;
    rank?: number;
    dueAt?: number | null;
    exposureGapMs?: number | null;
};
/** Created only by an explicitly enabled observer, during the real selection. */
export type DecisionTrace = {
    schemaVersion: 1;
    algorithmVersion: string;
    selectedAt: number;
    schedulerBefore: SchedulerState;
    candidates: CandidateDecision[];
    randomDraws: number[];
    selection: Selection | null;
};
export type DecisionObserver = (trace: DecisionTrace) => void;
