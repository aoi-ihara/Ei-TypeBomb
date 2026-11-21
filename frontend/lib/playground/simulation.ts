import { z } from "zod";
import { createScheduler, chooseNextUserItem, recordUserAnswer, recordRecognitionAnswer } from "./scheduler";
import { applyRecallObservation, recordAnswerModeResult, evaluateRecall, evaluateRecognition, getExposureGap,
    type ItemMemoryState, type RecallObservation } from "./memory";
import { replaySchema, snapshot } from "./replay";
import { getMasteryGraph } from "./mastery-graph";
import type { DecisionTrace } from "./decision-trace";

const nonnegative = z.number().nonnegative();
const observationSchema = z.object({ success: z.boolean().optional(), firstAttemptCorrect: z.boolean().optional(),
    answerLength: nonnegative.optional(), attemptCount: nonnegative.optional(), incorrectInputCount: nonnegative.optional(),
    hintCount: nonnegative.optional(), revealedHintChars: nonnegative.optional(), maxCorrectPrefixLength: nonnegative.optional(),
    recallLatencyMs: nonnegative.nullable().optional(), elapsedMs: nonnegative.optional(),
    initialCueRatio: z.number().min(0).max(1).optional(), finalCueRatio: z.number().min(0).max(1).optional(),
    additionalHintCount: nonnegative.optional(), answerWasFullyRevealed: z.boolean().optional(),
    expectedTypingMs: nonnegative.optional() }).strict();
export const scenarioSchema = z.object({ schemaVersion: z.literal(1), seed: z.number().int().min(0).max(0xffffffff),
    startAt: z.string().datetime(), items: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]+$/)
        .refine(value => !["__proto__", "constructor", "prototype"].includes(value)), mode: z.enum(["input", "selection"]) })).max(10000),
    snapshot: replaySchema.optional(), steps: z.array(z.object({ advanceMs: nonnegative.default(0),
        result: z.enum(["correct", "wrong", "hint", "reveal"]),
        resultsByItem: z.record(z.string(), z.enum(["correct", "wrong", "hint", "reveal"])).optional(),
        observation: observationSchema.optional(), choiceCount: z.number().int().min(2).max(4).default(4),
        responseMs: nonnegative.nullable().optional(), reload: z.boolean().optional() }).strict()).max(100000) }).strict();
export type Scenario = z.input<typeof scenarioSchema>;

export function simulate(input: unknown) {
    const scenario = scenarioSchema.parse(input);
    let rngState = scenario.snapshot?.rngState ?? scenario.seed;
    const random = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 0x100000000; };
    let now = scenario.snapshot?.now ?? Date.parse(scenario.startAt);
    let scheduler = scenario.snapshot ? structuredClone(scenario.snapshot.scheduler) : createScheduler(scenario.items.map(item => item.id), random);
    let memories: Record<string, ItemMemoryState> = structuredClone(scenario.snapshot?.memories ?? {});
    const modes = scenario.snapshot?.modes ?? Object.fromEntries(scenario.items.map(item => [item.id, item.mode]));
    const recordedDraws = [...(scenario.snapshot?.randomDraws ?? [])];
    const draw = () => recordedDraws.length ? recordedDraws.shift()! : random();
    const timeline = [];
    for (const [index, step] of scenario.steps.entries()) {
        now += step.advanceMs;
        const beforeSelection = snapshot(scheduler, memories, modes, now, rngState);
        let decision: DecisionTrace | undefined;
        const selected = chooseNextUserItem(scheduler, memories, draw, now, "input", modes, trace => { decision = trace; });
        if (!selected) { timeline.push({ index, at: now, decision, masteryGraph: getMasteryGraph(scheduler.itemIds, memories, now, "input", modes, true) }); continue; }
        const itemId = selected.itemId;
        const mode = modes[itemId] ?? "input";
        const result = step.resultsByItem?.[itemId] ?? step.result;
        const before = memories[itemId];
        const exposureGapMs = getExposureGap(before, mode, now);
        const observation: RecallObservation = {
            success: result !== "wrong" && result !== "reveal", firstAttemptCorrect: result === "correct",
            answerLength: 5, attemptCount: 1, hintCount: result === "hint" ? 1 : 0,
            revealedHintChars: result === "hint" ? 1 : result === "reveal" ? 5 : 0,
            maxCorrectPrefixLength: 5, recallLatencyMs: 500, elapsedMs: 1200,
            answerWasFullyRevealed: result === "reveal", ...step.observation,
            elapsedSincePresentationMs: exposureGapMs, schedulerReason: selected.reason,
        };
        const graphBefore = getMasteryGraph(scheduler.itemIds, memories, now, "input", modes, true);
        // Reload the in-flight state, without grading or selecting a different item.
        if (step.reload) {
            const restored = replaySchema.parse(JSON.parse(JSON.stringify(snapshot(scheduler, memories, modes, now, rngState))));
            scheduler = restored.scheduler; memories = restored.memories;
        }
        now += observation.elapsedMs;
        const identity = { memory: before, userId: "simulation", roomId: "local", itemId, now: new Date(now) };
        let evaluation;
        if (mode === "selection") {
            const success = observation.success && observation.firstAttemptCorrect && !observation.hintCount && !observation.answerWasFullyRevealed;
            recordRecognitionAnswer(scheduler, itemId, !success, now, exposureGapMs);
            memories[itemId] = recordAnswerModeResult({ ...identity, mode, success,
                usedHint: Boolean(observation.hintCount || observation.answerWasFullyRevealed),
                responseMs: step.responseMs === undefined ? observation.elapsedMs : step.responseMs,
                choiceCount: step.choiceCount, exposureGapMs });
            evaluation = evaluateRecognition(!success, exposureGapMs);
        } else {
            evaluation = evaluateRecall(observation);
            recordUserAnswer(scheduler, evaluation, now);
            memories[itemId] = applyRecallObservation({ ...identity, observation });
        }
        timeline.push({ index, presentedAt: beforeSelection.now, answeredAt: now, selection: selected, decision,
            replay: beforeSelection, observation, evaluation, before: before ?? null, after: memories[itemId],
            schedulerAfter: structuredClone(scheduler), graphBefore,
            masteryGraph: getMasteryGraph(scheduler.itemIds, memories, now, "input", modes, true) });
    }
    const finalSnapshot = snapshot(scheduler, memories, modes, now, rngState);
    const nextState = structuredClone(scheduler);
    let nextDecision: DecisionTrace | undefined;
    chooseNextUserItem(nextState, memories, draw, now, "input", modes, trace => { nextDecision = trace; });
    const selections = timeline.flatMap(turn => turn.selection ? [turn.selection] : []);
    const frequency: Record<string, number> = {};
    for (const selected of selections) frequency[selected.itemId] = (frequency[selected.itemId] ?? 0) + 1;
    return { schemaVersion: 1, seed: scenario.seed, timeline, nextDecision, finalSnapshot,
        metrics: { frequency, consecutiveRepeats: selections.filter((entry, i) => i > 0 && entry.itemId === selections[i - 1].itemId).length,
            earlyPractice: selections.filter(entry => entry.reason === "early_practice").length,
            introduced: Object.keys(scheduler.userAnswered).length } };
}
