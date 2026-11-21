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
type Practice = Due & { lastExposure: number; heldUntil: number | null };

const RECENT_EXPOSURE_MS = 120_000;

/**
 * Outside the due window, practice the weakest available memory rather than
 * stopping the game. Recent exposures are deprioritized when alternatives
 * exist; these selections never count as spaced-memory evidence.
 */
function selectEarlyPractice(
    state: SchedulerState,
    memories: Readonly<Record<string, ItemMemoryState>>,
    now: number,
    mode: AnswerMode,
    modes?: Modes,
): string | null {
    const candidates: Practice[] = [];
    for (const id of state.itemIds) {
        if (state.retries[id]) continue;
        const memory = memories[id];
        const itemMode = modeFor(id, mode, modes);
        // Respect the eight-new-words budget: only previously practiced words
        // are candidates after normal due/new selection is exhausted.
        if (
            !history(memory, itemMode) &&
            (state.userAnswered[id] ?? 0) === 0 &&
            !state.introduced?.includes(id)
        ) continue;

        const exposure = Date.parse(memory?.lastPresentedAt ?? "");
        candidates.push({
            id,
            retention: retention(memory, itemMode, now),
            dueAt: forecastDue(memory, itemMode) ?? Infinity,
            lastExposure: Number.isFinite(exposure) ? exposure : -Infinity,
            heldUntil: state.struggles[id]?.suspendedUntil ?? null,
        });
    }

    if (!candidates.length) return null;

    // Held words stay protected unless every otherwise available word is held.
    const unheld = candidates.filter((entry) => entry.heldUntil === null);
    const pool = unheld.length ? unheld : candidates;
    pool.sort((a, b) => {
        const recentA = now - a.lastExposure < RECENT_EXPOSURE_MS;
        const recentB = now - b.lastExposure < RECENT_EXPOSURE_MS;
        if (recentA !== recentB) return Number(recentA) - Number(recentB);
        // When all candidates are recently exposed, distribute practice by
        // least recent exposure rather than drilling one difficult word.
        if (recentA) return a.lastExposure - b.lastExposure;
        return a.retention - b.retention ||
            a.dueAt - b.dueAt ||
            a.lastExposure - b.lastExposure;
    });
    return (pool.find((entry) => entry.id !== state.lastUserItem) ?? pool[0]).id;
}

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
                    now - exposedAt < RECENT_EXPOSURE_MS
                ) return exposedAt + RECENT_EXPOSURE_MS;
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
            if (Number.isFinite(lastExposure) && now - lastExposure < RECENT_EXPOSURE_MS)
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
    if (!itemId) {
        itemId = selectEarlyPractice(state, memories, now, mode, modes) ?? undefined;
        if (itemId) reason = "early_practice";
    }
    // Nonempty sessions with a previously answered word can always continue.
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
