# Offline learning specification — 2026-11-21 audit (#649)

## Current production contract

`offline/Client.tsx → chooseNextUserItem(..., "adaptive") → chooseAdaptiveUserItem`
selects each solo question. `memory.ts` evaluates evidence and predicts retention.
The online caller uses the default legacy strategy. FSRS-7 is an experimental,
unconnected foundation (the only engine importer is its test).

Offline priority, in order:

1. Unheld retries whose earliest user turn has arrived, ordered by latest turn.
2. Expired holds, ordered by deadline, if fewer than four retries are pending.
3. Experienced, unheld words below 0.8 predicted recall with no exposure within
   two minutes. Sort by probability then forecast deadline; avoid the previous
   item when another due item exists. Stable input order breaks remaining ties.
4. Unseen words from the shuffled remaining cycle, then seeded random fallback,
   while fewer than eight introductions and four active retries exist.
5. Early practice: previously practiced/introduced words without retries;
   prefer unheld words, then nonrecent exposures, lower probability, earlier
   deadline and older exposure. Among recent words use oldest exposure. Avoid
   the previous word when possible. All held words can still be practiced.
6. Earliest pending retry if no filler exists; finally uncredited practice of
   a room item for an unusable old state. Empty rooms return no question.

These are existing priorities, not promises of uniform coverage. In particular
retry and hold work can outrank long-term review; recent exposure can postpone
an overdue word. A nonempty solo session does not stop for future review dates.

A wrong/full-reveal answer creates a short retry (gap min(2, room size)). Two
independent successes clear it, with a min(5, room size) confirmation gap. At
most four pending retries are retained. In a tiny room an early retry is allowed.
Failure holds start after four independent struggles over two minutes (10m),
then two struggles escalate through 30m, 3h, 12h, 24h. Successful independent
recall reduces a hold level. Early practice cannot clear a held word.

## Evidence and effective mode

Input evaluates final correctness, initial/final cue proportions, hint counts,
full reveal, first attempt, self-correction and latency. A corrected typo alone
does not require a retry. Independence uses the exposure gap at **presentation**,
not time spent answering; less than 3s is not independent. Spaced strengthening
also requires the existing memory's due interval (at least 2m). Successful early
practice never increases stability or moves the long-term review anchor.

Selection is one recognition observation per completed question. A wrong choice
before the correct one or answer reveal is not a clean success. Choice count
and foreground response time are recorded; >=30s response times are excluded
from speed statistics. Recognition has its own prediction and never grants typed
recall. Input falls back to selection when the answer/reading cannot be typed;
all predictions and priorities use `itemModes`, the effective mode of each word.

## Progress bar

This is a model forecast, not measured human retention. Each unique room ID is
counted once, including missing/unlearned memory (prediction zero). Threshold
is inclusive (`>=0.8`). At a shared `masteryNow`, forecast at now, +3h and +24h.
The rendered bar and diagnostics share `getMasteryGraph` and `masterySegments`.

| Segment | Count | Color |
| --- | --- | --- |
| after24Hours | masteredAfter24Hours | cyan-600 |
| after3HoursOnly | masteredAfter3Hours − masteredAfter24Hours | foreground |
| nowOnly | masteredNow − masteredAfter3Hours | border |
| belowThresholdNow | total − masteredNow | background |

Counts satisfy 0 ≤ 24h ≤ 3h ≤ now ≤ total. Widths are segment/total ×100;
empty rooms use zero. `aria-valuenow` is rounded current percentage;
`aria-valuetext` states all three counts. Invalid predictions are represented as
zero in the aggregation, never NaN. Diagnostics record the latest **rendered**
graph time, separately from the previous selection's timestamp.

## Persistence and exceptions

Memory rows/guest cache and scheduler cache remain format-compatible. Save
failure leaves the active session usable. Pending authenticated observations
are cached immediately, with existing serialized/debounced network writes.
Scheduler cache is user/room/mode scoped; invalid or >30-day state is ignored.
After six hours an unfinished question is released without grading and the
remaining queue is re-ranked. Short reload retains the current question,
including early practice and held early practice (fixed by #649 regression).
Mid-answer keystrokes are not completed evidence and are not persisted.

## Desired behavior and unresolved hypotheses

No new model coefficients or FSRS migration are introduced here. The eight-word
budget, turn gaps, holds, 0.8 threshold, two-minute cooldown, exponential curve,
and speed/choice weights remain uncalibrated hypotheses. Repetition frequency
alone is not a retention metric. Compare 24h/7d unaided recall at matched study
time before asserting learning gains. The reported infinite-focus and missed
review incidents have no captured production event history in #649; current
fixtures guard against their general forms, but do not establish a historical
root cause. Use beta diagnostics to obtain the exact selection state.
