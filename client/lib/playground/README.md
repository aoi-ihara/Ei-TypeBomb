# Playground v5 hints: coverage, bounded retries, and recall evidence

`memory.ts` evaluates an observation and updates the custom long-term model. `scheduler.ts` independently chooses questions. `InputView.tsx` records incorrect characters when entered, so Backspace and input reset cannot erase that evidence. The scheduler never reads legacy graduation/phase fields.

## Coverage and selection

A session starts with a Fisher–Yates shuffle of **every** room item, including all previously learned or graduated items. BOT turns do not consume this queue or increment user question indices. Every first-cycle item is selected once unless its own answer calls for a retry. Fast unaided answers produce no retry; 20 and 100 such words therefore take 20 and 100 user answers to cover.

Selection applies constraints before preferences:

1. Serve a retry whose reserved deadline is now.
2. On odd user turns, advance the cycle. A pending retry item cannot be selected before its earliest turn, even through the cycle.
3. On even turns, serve the eligible retry with the earliest deadline.
4. If no retry is eligible, advance the cycle on that turn as well.
5. When the queue empties, start another full shuffle. Due words (`R < 0.8`) and then high-difficulty words move toward the front; no word is excluded. A retry that is also in the current cycle satisfies both obligations.

There is no active-four gate, graduation prerequisite, fixed sequence of cue successes, additive priority lottery, or 12-presentation history used for fairness. Previously serialized `learning_state` is accepted for compatibility, ignored for selection, and cleared on the next user observation.

## Retry windows and feasibility

All constants below are **product hypotheses**, not experimentally established optimal intervals:

| Constant                   | Value | Meaning                                                           |
| -------------------------- | ----: | ----------------------------------------------------------------- |
| `SHORT_RETRY_GAP`          |     3 | Earliest retry after failure/heavy support/uncertainty            |
| `CONFIRM_RETRY_GAP`        |     6 | Earliest next confirmation after successful retry                 |
| `RETRY_WINDOW_WIDTH`       |     3 | Minimum width before reservation/collision handling               |
| `CYCLE_STRIDE`             |     2 | Odd turns reserved for coverage; even turns available for retries |
| `REQUIRED_RETRY_SUCCESSES` |     2 | Independent, sufficiently clear successes to finish a retry       |
| `BOT_LOOKAHEAD`            |     3 | Near-future cycle targets protected from BOT exposure             |

At answered turn `q`, earliest is `q + min(gap, N)`, where N is the number of distinct room items. Thus gap 3 means two intervening user questions. Capping the gap at N avoids deadlock in one- and two-item rooms. Success extends the gap from 3 to 6; renewed failure resets the success count and uses the short gap again. Repeated failures do not multiply the interval.

Each entry reserves a distinct even `latestTurn`, starting at or after `earliestTurn + RETRY_WINDOW_WIDTH`. Collisions move the reservation to the next free even slot. Earlier service is allowed only at/after earliest. Selected entries are removed; the next answer either completes or creates a new retry obligation. Deadlines of waiting entries are never silently extended.

This reservation is necessary: arbitrarily many permanently failing words cannot all have a fixed 3–7-question maximum wait while also guaranteeing new cycle questions. At most N entries exist. The hard maximum from the triggering answer is:

`min(gap, N) + RETRY_WINDOW_WIDTH + CYCLE_STRIDE × N` user questions.

For one failure in a 20-word room at Q1, the initial window is Q4–Q8 (Q7 rounds to an even reservation). Queue congestion can widen the maximum, but a finite bound is assigned immediately, and each odd turn remains available for coverage. In the first cycle, every word is reached within at most `2 × N` user questions even with failures; all-fast success needs exactly N. The tests check every outstanding deadline on every simulated turn, not merely eventual completion.

## Evidence and memory

Observations retain final correctness, first-attempt correctness, incorrect-character count, initial/final cue ratios, additional hints, full-answer reveal, latency to first key, elapsed answer time, and time since the previous answer exposure **at prompt presentation**. A long answer duration cannot retrospectively erase a BOT preview.

| Observation                                         | Memory evidence                   | Session retry                       |
| --------------------------------------------------- | --------------------------------- | ----------------------------------- |
| Fast, correct, unaided, no errors                   | strong recall                     | none                                |
| One promptly corrected typo / ordinary clear answer | recall                            | none                                |
| Slow or multiple errors / light hints               | weak recall                       | confirmation                        |
| Cue ratio ≥ 0.4                                     | weak recall                       | short                               |
| Incorrect final answer / full answer revealed       | insufficient evidence             | short                               |
| Answer exposed less than 3 seconds before prompt    | insufficient independent evidence | confirmation; never a retry success |

The fast threshold is first key within 2.5 seconds and total time ≤ 2 seconds + 1.5 × expected typing time. Ordinary recall allows ≤ 1 incorrect input and ≤ 6 seconds + 2 × expected typing time. Expected typing time uses answer length and the user's sampled character interval (220 ms initially). Learning probes start without letter hints. After a 6-second stall, a suggestion appears without revealing any answer. Learners can request one unresolved non-space character at a time; the last unresolved character is never automatically revealed. The first hint pauses bomb pressure for the remainder of the question. Full reveal shows the answer and meaning, with a confirmation button instead of mandatory copying. These thresholds and cue ratios are product hypotheses.

The long-term model is **not FSRS**. `R = exp(-elapsedDays / S)` makes S the days until predicted retrievability is approximately 36.8%. Fast and ordinary clear recalls use the same conservative stability gain; speed primarily reduces session repetition. A corrected typo receives no failure penalty. An unsuccessful final answer or full reveal uses `S × 0.8`, bounded below by 0.12. Recent-exposure successes do not increase S or shift the last independently evaluated review date. Coefficients are not fitted to human retention data.

## BOT and saving

BOT candidates must have been answered by the user this session. Pending retries and the next three cycle targets are excluded. Candidates with fewer BOT presentations are preferred, with random ties and avoidance of the previous BOT item when possible. If none is safe, skip the BOT turn. BOT start/completion update `lastPresentedAt` through the normal save queue; they do not increment review count, user-answer counters, cycle progress, retry successes, or the user question index.

The existing 300 ms debounced save, serialized writes, 5-second retry, online/page-hide handling, and authenticated-user/room local unsent queue remain. No database migration is required. `playground_item_recalled` includes incorrect input count, first-attempt correctness, cue evidence, timing, exposure gap, selection reason/turn/cycle, retry window, memory evidence, retry need, independence, and model version. Keystroke strings are not stored.

## Validation and limits

Run `npm --prefix client run test:playground` from the repository root. Simulations cover 20/100 fast-correct words across 20 seeds, one failing word, simultaneous permanent failures in 1/2/3/4/8/20/100-item rooms, 30 mixed 500-question runs, all-graduated sets across repeated cycles, BOT invariants, confirmation/re-failure, corrected typos, real Client callbacks, real InputView Backspace callbacks, and concurrent/failed saving. The actual callback tests run source-extracted functions with state/clock/network mocks; they are not an authenticated full-browser E2E test.

A browser reload starts a new shuffle cycle; long-term memory and queued unsent writes persist, but the session retry queue does not. Mid-answer typing is not a completed observation. Game restarts in the same mounted session retain the scheduler.

Passing software tests establishes these implementation invariants, **not improved human retention**. Validate learning effects with delayed unaided recall (for example at 24 hours and seven days), matched learning time, and calibrated recall predictions. Turn gaps, retry windows, speed thresholds, and the memory coefficients remain product hypotheses.

## Manual hints (2026-10-07)

The playground uses manual hints; multiplayer retains the existing timed prefix hints. A hint preserves all typed characters and moves the cursor to the supplied position. On an incorrect completed learning answer, input is retained and the cursor moves to the first mismatch. Correcting that mismatch can complete the answer even before the final character position.

`assistedPositions` counts only letters actually supplied by the app, not a prefix that the learner already typed. `hintEvents` records manual letter/answer requests, elapsed time, supplied position, and the count of correct unaided non-space characters immediately before the request. These are included in progress, completion, and recall analytics, without keystroke strings. Any partial hint prevents an unaided success classification and requests a later confirmation. Full reveal followed by confirmation is recorded as `success: false`, `outcome: relearned`, and requires a short retry; confirming twice cannot create duplicate observations. Each later probe starts without letter hints.

This is the first implementation of the hint proposal, not a validated retention improvement. Optional timed assistance, semantic cues, cross-session cue fading, and memory-model calibration remain future experiments. The six-second suggestion and paused pressure are product hypotheses. Compare next-day/seven-day recall without letter hints at matched study time, along with practice throughput and abandonment.

Research: [Qu et al. (2026), diminishing cues](https://pubmed.ncbi.nlm.nih.gov/42322471/) supports testing reduced support across practice, but its abstract does not establish an optimal timer. [van den Broek et al. (2019)](https://doi.org/10.1037/xap0000212) cautions that elaborate hints can consume repetition time without improving later unaided recall. The implementation therefore offers short, optional assistance and direct answer feedback rather than a mandatory long hint ladder.
