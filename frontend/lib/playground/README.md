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
- Solo play gives the learner the next scheduled question immediately after
  an answer; there are no interleaved BOT turns or BOT previews.

The active pool bounds **pending retries**, not all previously encountered
items. Newly introduced words that succeed unaided do not occupy a slot.
These numeric thresholds are hypotheses and should be validated through
next-day and seven-day unaided recall, not only session completion metrics.

## Escalating holds for repeatedly difficult words

To avoid blocking all new introductions behind a few words that cannot yet be
recalled, each word has a persistent, per-user/per-room struggle record in the
scheduler cache. An assisted recall (including a full hint) or an incorrect
answer counts as a struggling attempt **only when the attempt is independent
of recent answer exposure**. Unaided correct recalls, even with typing mistakes,
do not count as failures.

- First hold: 4 struggling attempts over at least 2 minutes → 10 minutes.
- After returning, 2 more struggling attempts → 30 minutes, then 3 hours,
  12 hours, and 24 hours; further holds are capped at 24 hours.
- A held word is removed from active retries, excluded from cycle fillers and
  other practice questions, and does not consume one of the four relearning slots.
- Once its deadline passes, the word is eligible ahead of newly introduced
  material (but after an already-due active retry). A successful independent,
  unaided answer reduces the retained hold level by one, rather than
  immediately wiping all evidence of prior difficulty.
- If every word is held, the Playground pauses and displays the earliest
  next review time. It never breaks a multi-hour hold to fill a question.
- Hold timestamps are absolute and survive reload, but stale/invalid entries
  and words removed from the room are discarded during cache recovery.
- `playground_item_suspended` records the hold level and deadline for
  calibration; no new DB table is needed.

These times and failure thresholds are **uncalibrated product hypotheses**.
Compare delayed unaided recall and overall practice throughput before deciding
whether the feature actually improves retention.

## Interleaved reviews of previously learned words

After at least five user questions, each normal (non-retry) selection gets a
15% chance to revisit an earlier answered word when a suitable candidate exists.
This does not override a due retry, a returning suspension, or the four-word
active relearning limit. Candidates must have a valid recall history, have
already been answered during the session and removed from the current cycle,
and have had no answer/BOT exposure in the last two minutes. The last user
question is excluded. Among eligible candidates the lowest predicted
retrievability wins (with difficulty as a tie-breaker, then random ties).
The interleaved review does not advance or remove items from the main cycle.
When no candidate exists or the random check fails, normal cycle selection
continues. The same scheduler is shared by Playground and online play.

The 15% probability and two-minute exposure cooldown are **uncalibrated
hypotheses**, not validated retention thresholds. Compare delayed recall,
repetitions per session, and time to first complete room coverage. No new
Supabase columns or migration are needed; existing per-item memory and the
local scheduler snapshot are sufficient.

## Historical context

The earlier scheduler reserved alternate user turns for complete room coverage
and could introduce new words while many failed words awaited retry. That
behavior was intentionally removed because it could overwhelm learners.
Old retry reservation fields remain for compatibility and observability,
but they no longer dictate new-word coverage.

## Evidence and memory

Observations retain final correctness, first-attempt correctness, incorrect-character count, initial/final cue ratios, additional hints, full-answer reveal, latency to first key, elapsed answer time, and time since the previous answer exposure **at prompt presentation**, independent of the time spent completing that answer.

| Observation                                         | Memory evidence                   | Session retry                       |
| --------------------------------------------------- | --------------------------------- | ----------------------------------- |
| Fast, correct, unaided, no errors                   | strong recall                     | none                                |
| Correct, unaided answer after more thought or self-correction | recall                  | none                                |
| Light hints                                           | weak recall                       | confirmation                        |
| Cue ratio ≥ 0.4                                     | weak recall                       | short                               |
| Incorrect final answer / full answer revealed       | insufficient evidence             | short                               |
| Answer exposed less than 3 seconds before prompt    | insufficient independent evidence | confirmation; never a retry success |

The fast label uses first key within 2.5 seconds and total time ≤ 2 seconds + 1.5 × expected typing time. A correct, independent, unaided answer remains recall even when it takes longer or includes self-corrected input errors; latency and incorrect-input count are performance signals, not standalone reasons for a forced retry. Expected typing time uses answer length and the user's sampled character interval (220 ms initially). Learning probes start without letter hints. After a 6-second stall, a suggestion appears without revealing any answer. Learners can request one unresolved non-space character at a time; the last unresolved character is never automatically revealed. Solo play has no bomb countdown or win/loss state. Full reveal shows the answer and meaning, with a confirmation button instead of mandatory copying. These thresholds and cue ratios are product hypotheses.

The long-term model is **not FSRS**. First independent clear recall seeds stability at 0.30 days (weak recall: 0.18 days) instead of leaving it at 0.15; recent-exposure successes receive no gain. These values and the existing 0.5 retention-gain coefficient are uncalibrated hypotheses requiring delayed-recall experiments.  `R = exp(-elapsedDays / S)` makes S the days until predicted retrievability is approximately 36.8%. Fast and ordinary clear recalls use the same conservative stability gain. Retrieval latency and incorrect-input counts are retained for analysis but do not independently reduce stability or schedule a forced retry. A corrected typo receives no failure penalty. An unsuccessful final answer or full reveal uses `S × 0.8`, bounded below by 0.12. Recent-exposure successes do not increase S or shift the last independently evaluated review date. Coefficients are not fitted to human retention data.

## Solo practice and saving

Solo play only uses `chooseNextUserItem`: every completed answer is followed
immediately by another question for the same learner. There is no practice
opponent, bomb countdown, or win/loss state. The pause overlay leaves the current
question mounted for resumption, while replay selects a new question without
discarding saved learning progress. The scheduler still protects pending retries
and applies escalating holds.

The existing 300 ms debounced save, serialized writes, 5-second retry, online/page-hide handling, and authenticated-user/room local unsent queue remain. No database migration is required. `playground_item_recalled` includes incorrect input count, first-attempt correctness, cue evidence, timing, exposure gap, selection reason/turn/cycle, retry window, memory evidence, retry need, independence, and model version. Keystroke strings are not stored.

## Validation and limits

Run `npm --prefix client run test:playground` from the repository root. Simulations cover 20/100 fast-correct words across 20 seeds, one failing word, simultaneous permanent failures in 1/2/3/4/8/20/100-item rooms, 30 mixed 500-question runs, all-graduated sets across repeated cycles, legacy BOT helper invariants, confirmation/re-failure, corrected typos, real Client callbacks, real InputView Backspace callbacks, and concurrent/failed saving. The actual callback tests run source-extracted functions with state/clock/network mocks; they are not an authenticated full-browser E2E test.

A browser reload resumes the saved per-user, per-room scheduler (separately for Playground and online play): cycle order, pending retries, and the unfinished question survive. After six hours, an unfinished question returns to the candidate pool without being graded and the remaining cycle is re-ranked using current memory retrievability. Newly added room words are appended; removed words are discarded. Invalid or older-than-30-day local snapshots start a fresh scheduler. Completed observations are cached immediately before any asynchronous database sync, so a quick reload does not lose the corresponding memory. Mid-answer typing itself is not a completed observation. Game restarts in the same mounted session retain the scheduler.

Passing software tests establishes these implementation invariants, **not improved human retention**. Validate learning effects with delayed unaided recall (for example at 24 hours and seven days), matched learning time, and calibrated recall predictions. Turn gaps, retry windows, speed thresholds, and the memory coefficients remain product hypotheses.

## Manual hints (2026-10-07)

The playground uses manual hints; multiplayer retains the existing timed prefix hints. A hint preserves all typed characters and moves the cursor to the supplied position. On an incorrect completed learning answer, input is retained and the cursor moves to the first mismatch. Correcting that mismatch can complete the answer even before the final character position.

`assistedPositions` counts only letters actually supplied by the app, not a prefix that the learner already typed. `hintEvents` records manual letter/answer requests, elapsed time, supplied position, and the count of correct unaided non-space characters immediately before the request. These are included in progress, completion, and recall analytics, without keystroke strings. Any partial hint prevents an unaided success classification and requests a later confirmation. Full reveal followed by confirmation is recorded as `success: false`, `outcome: relearned`, and requires a short retry; confirming twice cannot create duplicate observations. Each later probe starts without letter hints.

This is the first implementation of the hint proposal, not a validated retention improvement. Optional timed assistance, semantic cues, cross-session cue fading, and memory-model calibration remain future experiments. The six-second suggestion and cue thresholds are product hypotheses. Compare next-day/seven-day recall without letter hints at matched study time, along with practice throughput and abandonment.

Research: [Qu et al. (2026), diminishing cues](https://pubmed.ncbi.nlm.nih.gov/42322471/) supports testing reduced support across practice, but its abstract does not establish an optimal timer. [van den Broek et al. (2019)](https://doi.org/10.1037/xap0000212) cautions that elaborate hints can consume repetition time without improving later unaided recall. The implementation therefore offers short, optional assistance and direct answer feedback rather than a mandatory long hint ladder.
