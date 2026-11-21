import { getMasteryProgress, MASTERY_RETRIEVABILITY_THRESHOLD,
    MASTERY_THREE_HOUR_HORIZON_MS, MASTERY_FORECAST_HORIZON_MS,
    type MasteryProgress, type MasteryItemPrediction, type ItemMemoryState, type AnswerModeResult } from "./memory";

/** Shared by the rendered bar, diagnostics and simulation. */
export function masterySegments(progress: MasteryProgress) {
    const { total, masteredNow, masteredAfter3Hours, masteredAfter24Hours } = progress;
    const segments = { after24Hours: masteredAfter24Hours,
        after3HoursOnly: masteredAfter3Hours - masteredAfter24Hours,
        nowOnly: masteredNow - masteredAfter3Hours, belowThresholdNow: total - masteredNow };
    const percent = (count: number) => total ? count / total * 100 : 0;
    return { segments, percentages: { after24Hours: percent(segments.after24Hours),
        after3HoursOnly: percent(segments.after3HoursOnly), nowOnly: percent(segments.nowOnly),
        belowThresholdNow: percent(segments.belowThresholdNow) } };
}
export function getMasteryGraph(ids: readonly string[], memories: Readonly<Record<string, ItemMemoryState>>,
    now: number, mode: AnswerModeResult, modes?: Readonly<Record<string, AnswerModeResult>>, detail = false) {
    const items: MasteryItemPrediction[] = [];
    const totals = getMasteryProgress(ids, memories, now, MASTERY_RETRIEVABILITY_THRESHOLD,
        mode, modes, detail ? item => items.push(item) : undefined);
    return { calculatedAt: new Date(now).toISOString(), threshold: MASTERY_RETRIEVABILITY_THRESHOLD,
        forecastHorizonsMs: [0, MASTERY_THREE_HOUR_HORIZON_MS, MASTERY_FORECAST_HORIZON_MS],
        totals, ...masterySegments(totals), ...(detail ? { items } : {}) };
}
