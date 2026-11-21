import {
    getRecognitionRetrievability,
    getRetrievability,
    MASTERY_RETRIEVABILITY_THRESHOLD,
    type ItemMemoryState,
} from "./memory";
import type { SchedulerState, Selection, RetryEntry } from "./scheduler";

// This is the offline selection policy. Review-state updates remain in memory.ts;
// online games keep their existing turn/hand-off policy.
export const MAX_NEW_PER_SESSION = 8;
const DAY_MS = 86_400_000;
type AnswerMode = "input" | "selection";
type Modes = Readonly<Record<string, AnswerMode>>;

const modeFor = (id: string, mode: AnswerMode, modes?: Modes) =>
    modes?.[id] ?? mode;

const history = (memory: ItemMemoryState | undefined, mode: AnswerMode) =>
    mode === "selection"
        ? (memory?.answerModeStats?.recognition.attempts ?? 0) > 0
        : (memory?.reviewCount ?? 0) > 0;

const retention = (memory: ItemMemoryState | undefined, mode: AnswerMode, now: number) =>
    mode === "selection"
        ? getRecognitionRetrievability(memory, now)
        : getRetrievability(memory, now);

type Due = { id: string; retention: number; dueAt: number };

function forecastDue(memory: ItemMemoryState | undefined, mode: AnswerMode): number | null {
    if (!memory) return null;
    const track = memory.answerModeStats?.recognition;
    const reviewed = mode === "selection" ? track?.lastReviewedAt : memory.lastReviewedAt;
    const stability = mode === "selection" ? track?.stability : memory.stability;
    if (!reviewed || !stability || !Number.isFinite(stability)) return null;
    const at = Date.parse(reviewed);
    return Number.isFinite(at)
        ? at - stability * Math.log(MASTERY_RETRIEVABILITY_THRESHOLD) * DAY_MS
        : null;
}

export function nextAdaptiveReviewAt(
    state: SchedulerState,
    memories: Readonly<Record<string, ItemMemoryState>>,
    now: number,
    mode: AnswerMode,
    modes?: Modes,
): number | null {
    const future = [
        ...Object.values(state.struggles)
            .map((entry) => entry.suspendedUntil)
            .filter((time): time is number => time !== null && time > now),
        ...state.itemIds
            .map((id) => {
                const memory = memories[id];
                const itemMode = modeFor(id, mode, modes);
                if (!history(memory, itemMode)) return null;
                // If a due word is still in the recent-exposure cooldown,
                // its next available time is the end of that cooldown.
                const exposedAt = Date.parse(memory?.lastPresentedAt ?? "");
                if (
                    retention(memory, itemMode, now) <
                        MASTERY_RETRIEVABILITY_THRESHOLD &&
                    Number.isFinite(exposedAt) &&
                    now - exposedAt < 120_000
                ) return exposedAt + 120_000;
                return forecastDue(memory, itemMode);
            })
            .filter((time): time is number => time !== null && time > now),
    ];
    return future.length ? Math.min(...future) : null;
}

export function chooseAdaptiveUserItem(
    state: SchedulerState,
    memories: Readonly<Record<string, ItemMemoryState>>,
    random: () => number,
    now: number,
    mode: AnswerMode,
    modes?: Modes,
): Selection | null {
    if (!state.itemIds.length) return null;
    if (state.current) return state.current;

    const turn = state.turn + 1;
    const pending = Object.values(state.retries).filter(
        (entry) => state.struggles[entry.itemId]?.suspendedUntil == null,
    );
    const eligible = pending
        .filter((entry) => entry.earliestTurn <= turn)
        .sort((a, b) => a.latestTurn - b.latestTurn);

    let itemId: string | undefined = eligible[0]?.itemId;
    let reason: Selection["reason"] = "retry";

    // A completed hold is eligible again; do not interrupt an already due retry.
    if (!itemId && pending.length < 4) {
        const dueHold = Object.entries(state.struggles)
            .filter(([id, entry]) =>
                state.itemIds.includes(id) &&
                entry.suspendedUntil !== null &&
                entry.suspendedUntil <= now,
            )
            .sort((a, b) => a[1].suspendedUntil! - b[1].suspendedUntil!)[0];
        if (dueHold) {
            itemId = dueHold[0];
            state.struggles[itemId].suspendedUntil = null;
            reason = "suspension_due";
        }
    }

    if (!itemId) {
        const due: Due[] = [];
        const unseen: string[] = [];
        for (const id of state.itemIds) {
            if (state.retries[id] || state.struggles[id]?.suspendedUntil != null) continue;
            const itemMode = modeFor(id, mode, modes);
            const memory = memories[id];
            if (!history(memory, itemMode)) {
                // The shared answer counter can include another answer mode.
                // A recognized word is still new to independent typed recall.
                unseen.push(id);
                continue;
            }
            const r = retention(memory, itemMode, now);
            if (r >= MASTERY_RETRIEVABILITY_THRESHOLD) continue;
            // A completed turn already creates its own retry. Don't immediately
            // reshow the same word just because its prediction is still low.
            const lastExposure = Date.parse(memory?.lastPresentedAt ?? "");
            if (Number.isFinite(lastExposure) && now - lastExposure < 120_000)
                continue;
            due.push({
                id,
                retention: r,
                dueAt: forecastDue(memory, itemMode) ?? -Infinity,
            });
        }
        due.sort((a, b) => a.retention - b.retention || a.dueAt - b.dueAt);
        const distinct = due.filter((candidate) => candidate.id !== state.lastUserItem);
        if (distinct.length || due.length) {
            itemId = (distinct.length ? distinct : due)[0].id;
            reason = "long_term_due";
        } else if (
            pending.length < 4 &&
            (state.introduced?.length ?? 0) < MAX_NEW_PER_SESSION &&
            unseen.length > 0
        ) {
            // The queue already starts shuffled, so avoid another random draw
            // each turn that would make reload order unpredictable.
            itemId = state.cycleQueue.find((id) => unseen.includes(id)) ??
                unseen[Math.floor(random() * unseen.length)];
            state.introduced ??= [];
            state.introduced.push(itemId);
            reason = "cycle";
        }
    }

    // Legacy retries are measured in turns rather than timestamps. In a room
    // too small to supply filler questions, choose the oldest pending retry
    // instead of leaving the learner in a permanent deadlock.
    if (!itemId && pending.length) {
        itemId = [...pending].sort((a, b) => a.earliestTurn - b.earliestTurn)[0].itemId;
        reason = "retry";
    }
    if (!itemId) return null;

    const retry: RetryEntry | undefined = state.retries[itemId];
    const advancesCycle = state.cycleQueue.includes(itemId);
    if (advancesCycle) {
        state.cycleQueue = state.cycleQueue.filter((id) => id !== itemId);
        if (state.cycleQueue.length === 0) state.completedCycles++;
    }
    delete state.retries[itemId];
    state.turn = turn;
    state.lastUserItem = itemId;
    state.current = {
        itemId,
        turn,
        cycle: state.cycle,
        advancesCycle,
        ...(retry ? { retry } : {}),
        reason,
    };
    return state.current;
}
