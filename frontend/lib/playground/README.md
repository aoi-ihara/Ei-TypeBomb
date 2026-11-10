# Playground: mastery-first scheduling

`memory.ts` evaluates recall observations. `scheduler.ts` now prioritizes
relearning instead of maximizing new-word coverage.

## New selection policy

- A failed or fully revealed answer schedules a retry after two user questions
  (or sooner only when a tiny room has no safe filler).
- The first independent, unaided retry success schedules another confirmation
  after five user questions. A second independent success clears the retry.
- Eligible retries take precedence over ordinary cycle questions.
- At most four words may be awaiting relearning at once. When this pool is full,
  new words are paused. Previously answered words can fill the spacing gap.
- In very small rooms where every word is waiting, the oldest pending word
  can be practiced early instead of deadlocking.
- The usual first-session shuffle and the returning-session ordering by
  predicted retrievability are preserved for words that are introduced.
- BOT turns do not advance the user's question counter and pending retries
  remain protected from BOT previews.

The active pool bounds **pending retries**, not all previously encountered
items. Newly introduced words that succeed unaided do not occupy a slot.
These numeric thresholds are hypotheses and should be validated through
next-day and seven-day unaided recall, not only session completion metrics.

## Historical context

The earlier scheduler reserved alternate user turns for complete room coverage
and could introduce new words while many failed words awaited retry. That
behavior was intentionally removed because it could overwhelm learners.
Old retry reservation fields remain for compatibility and observability,
but they no longer dictate new-word coverage.

## Evidence and memory

Observations retain final correctness, first-attempt correctness, incorrect-character count, initial/final cue ratios, additional hints, full-answer reveal, latency to first key, elapsed answer time, and time since the previous answer exposure **at prompt presentation**. A long answer duration cannot retrospectively erase a BOT preview.

| Observation                                         | Memory evidence                   | Session retry                       |
| --------------------------------------------------- | --------------------------------- | ----------------------------------- |
| Fast, correct, unaided, no errors                   | strong recall                     | none                                |
| Correct, unaided answer after more thought or self-correction | recall                  | none                                |
| Light hints                                           | weak recall                       | confirmation                        |
| Cue ratio ≥ 0.4                                     | weak recall                       | short                               |
| Incorrect final answer / full answer revealed       | insufficient evidence             | short                               |
| Answer exposed less than 3 seconds before prompt    | insufficient independent evidence | confirmation; never a retry success |

The fast label uses first key within 2.5 seconds and total time ≤ 2 seconds + 1.5 × expected typing time. A correct, independent, unaided answer remains recall even when it takes longer or includes self-corrected input errors; latency and incorrect-input count are performance signals, not standalone reasons for a forced retry. Expected typing time uses answer length and the user's sampled character interval (220 ms initially). Learning probes start without letter hints. After a 6-second stall, a suggestion appears without revealing any answer. Learners can request one unresolved non-space character at a time; the last unresolved character is never automatically revealed. The first hint pauses bomb pressure for the remainder of the question. Full reveal shows the answer and meaning, with a confirmation button instead of mandatory copying. These thresholds and cue ratios are product hypotheses.

The long-term model is **not FSRS**. First independent clear recall seeds stability at 0.30 days (weak recall: 0.18 days) instead of leaving it at 0.15; recent-exposure successes receive no gain. These values and the existing 0.5 retention-gain coefficient are uncalibrated hypotheses requiring delayed-recall experiments.  `R = exp(-elapsedDays / S)` makes S the days until predicted retrievability is approximately 36.8%. Fast and ordinary clear recalls use the same conservative stability gain. Retrieval latency and incorrect-input counts are retained for analysis but do not independently reduce stability or schedule a forced retry. A corrected typo receives no failure penalty. An unsuccessful final answer or full reveal uses `S × 0.8`, bounded below by 0.12. Recent-exposure successes do not increase S or shift the last independently evaluated review date. Coefficients are not fitted to human retention data.

## BOT and saving

BOT candidates must have been answered by the user this session. Pending retries and the next three cycle targets are excluded. Candidates with fewer BOT presentations are preferred, with random ties and avoidance of the previous BOT item when possible. If none is safe, skip the BOT turn. BOT start/completion update `lastPresentedAt` through the normal save queue; they do not increment review count, user-answer counters, cycle progress, retry successes, or the user question index.

The existing 300 ms debounced save, serialized writes, 5-second retry, online/page-hide handling, and authenticated-user/room local unsent queue remain. No database migration is required. `playground_item_recalled` includes incorrect input count, first-attempt correctness, cue evidence, timing, exposure gap, selection reason/turn/cycle, retry window, memory evidence, retry need, independence, and model version. Keystroke strings are not stored.

## Validation and limits

Run `npm --prefix client run test:playground` from the repository root. Simulations cover 20/100 fast-correct words across 20 seeds, one failing word, simultaneous permanent failures in 1/2/3/4/8/20/100-item rooms, 30 mixed 500-question runs, all-graduated sets across repeated cycles, BOT invariants, confirmation/re-failure, corrected typos, real Client callbacks, real InputView Backspace callbacks, and concurrent/failed saving. The actual callback tests run source-extracted functions with state/clock/network mocks; they are not an authenticated full-browser E2E test.

A browser reload resumes the saved per-user, per-room scheduler (separately for Playground and online play): cycle order, pending retries, and the unfinished question survive. After six hours, an unfinished question returns to the candidate pool without being graded and the remaining cycle is re-ranked using current memory retrievability. Newly added room words are appended; removed words are discarded. Invalid or older-than-30-day local snapshots start a fresh scheduler. Completed observations are cached immediately before any asynchronous database sync, so a quick reload does not lose the corresponding memory. Mid-answer typing itself is not a completed observation. Game restarts in the same mounted session retain the scheduler.

Passing software tests establishes these implementation invariants, **not improved human retention**. Validate learning effects with delayed unaided recall (for example at 24 hours and seven days), matched learning time, and calibrated recall predictions. Turn gaps, retry windows, speed thresholds, and the memory coefficients remain product hypotheses.

## Manual hints (2026-10-07)

The playground uses manual hints; multiplayer retains the existing timed prefix hints. A hint preserves all typed characters and moves the cursor to the supplied position. On an incorrect completed learning answer, input is retained and the cursor moves to the first mismatch. Correcting that mismatch can complete the answer even before the final character position.

`assistedPositions` counts only letters actually supplied by the app, not a prefix that the learner already typed. `hintEvents` records manual letter/answer requests, elapsed time, supplied position, and the count of correct unaided non-space characters immediately before the request. These are included in progress, completion, and recall analytics, without keystroke strings. Any partial hint prevents an unaided success classification and requests a later confirmation. Full reveal followed by confirmation is recorded as `success: false`, `outcome: relearned`, and requires a short retry; confirming twice cannot create duplicate observations. Each later probe starts without letter hints.

This is the first implementation of the hint proposal, not a validated retention improvement. Optional timed assistance, semantic cues, cross-session cue fading, and memory-model calibration remain future experiments. The six-second suggestion and paused pressure are product hypotheses. Compare next-day/seven-day recall without letter hints at matched study time, along with practice throughput and abandonment.

Research: [Qu et al. (2026), diminishing cues](https://pubmed.ncbi.nlm.nih.gov/42322471/) supports testing reduced support across practice, but its abstract does not establish an optimal timer. [van den Broek et al. (2019)](https://doi.org/10.1037/xap0000212) cautions that elaborate hints can consume repetition time without improving later unaided recall. The implementation therefore offers short, optional assistance and direct answer feedback rather than a mandatory long hint ladder.
