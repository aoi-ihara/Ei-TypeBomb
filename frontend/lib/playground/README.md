# Playground: mastery-first scheduling

## Adaptive offline selection (incremental migration)

Offline practice now uses `chooseNextUserItem(..., "adaptive")`; online
play intentionally continues to use the existing cycle/retry policy.

The selection policy is isolated in `adaptive-scheduler.ts`:
- Respect due short retries and expired holds first.
- Among long-term due words, prefer the lowest predicted retrievability.
- Introduce no more than eight unseen words per user-initiated session and
  no new words while four retries are pending.
- Do not force a learned word back early just to fill an otherwise idle cycle.
  Return a future review timestamp so the UI can offer a later session.
- Preserve an unfinished question, pending retries, and the introduced set
  across reloads. Explicitly starting a new session resets only the introduction
  budget, not the learner's memory.

**Limitations:** The underlying memory model is still ETB's exponential
forgetting curve and retry gaps are still measured in turns. If no filler is
available, an early retry is allowed to avoid deadlock. This is an isolated
scheduler step toward FSRS-7, **not** an FSRS-7 migration or a validated
learning-outcome improvement. The old model and online policy are unchanged.

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

Eligible retries and returning holds take priority. Ordinary selection compares due words across the remaining cycle and previously answered words. A word outside the cycle can return after two minutes without exposure. Among cycle words, predictions below 80% precede unseen items, followed by retained items. Each item uses the mode actually shown. Recognition error rate and active response time refine priority within five-percentage-point retention bands.

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

A first independent typed recall seeds stability at 0.30 days. Later independent successes use the elapsed interval since exposure as evidence: the target stability places 80% retention at 1.25 times that interval, with a conservative decay-based gain and a threefold cap per success. Failure or full reveal weakens stability and records exposure while preserving the previous independent review date. Selection uses separate recognition history and discounts successful choices with fewer distractors. These coefficients are hypotheses for validation against delayed independent answers.

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

## Answer formats

Solo players choose `selection` or `input`. A saved `auto` mode opens in selection.
Selection questions use up to four unique answers from the same room, with the
correct answer and distractors shuffled for each presented turn. Duplicate
answers are excluded to avoid ambiguous options.

A completed selection turn records one recognition attempt: picking the right
option on the first try is a success; reaching it after eliminating wrong
options is a failed recognition. Incorrect turns use the **same** retry,
confirmation, and escalating-hold scheduler as typing, including the shared
two-question retry gap. In selection mode, previous recognition attempts
prioritize low-accuracy items ahead of easier ones, and recognized items can
participate in optional interleaved review. This ordering is a heuristic, not
a calibrated memory model.

Recognition never changes free-recall stability, difficulty, or review count.
Input mode continues to prioritize independent recall, even when switching
between modes. The online game also schedules a selection retry when a
non-typable item was answered incorrectly before the correct choice.

For **first-try correct** selection answers only, an optional exponential
average of foreground response time is saved in the existing recognition
JSON track (no migration). Time in the background tab or while paused does
not count. Answers taking **30 seconds or longer** are excluded entirely as
possibly idle. Within the eligible interval, a roughly 2-second or faster
answer reduces recognition priority by 0.30, 8 seconds is neutral, and a
nearly 30-second answer raises priority by at most 0.18. The EMA factor
remains 0.35 so recent clean answers matter without overreacting to one sample.

Selection ranking uses a smoothed error fraction
`(attempts - correct) / (attempts + 1)` instead of raw error rate. Thus a
single missed question contributes 0.5 rather than 1.0 to priority; repeated
misses keep increasing the score. An earlier fast response does not cancel
out a *more recent* mistake because speed adjustment is ignored until the
next clean correct turn. Scheduled short retries for mistakes still take
precedence over this ordinary ordering. Long waits alone never trigger a
retry, hold, or change typed recall memory. These weights and thresholds
are uncalibrated heuristics, not estimates of learning ability.

Typing uses the first stored kana reading when supported, then falls back to
the original answer. If neither can be typed, the game switches
that item to selection, even in input mode. If no item in a room is typable,
the room offers selection only. Answer text is no longer restricted to the
typing character set or the old 32-character limit; empty answers remain
invalid. Recognition and typed recall statistics are stored separately in
`ei_typebomb_item_memory.answer_mode_stats`.

## Offline recognition mastery and retention forecast

Offline selection (multiple-choice) responses now update their own recognition
stability inside `answer_mode_stats.recognition`, alongside the existing
accuracy and response-time statistics. The recognition stability is updated
using the same exponential forgetting model as typed recall, but the two modes
remain separate: recognizing an option never claims the learner can type the
answer unaided. A clean selection initializes/strengthens recognition memory;
a mistaken or manually revealed choice reduces its stability without resetting
the successful-recall timestamp, avoiding an artificial mastery increase.

The offline bar uses the active answer mode's predicted retrievability. It
counts words at or above 80% now, after three hours, and after 24 hours. Review order
also considers recognition retrievability, along with choice error rate and
active response speed, while retaining retries and suspension priorities.

Older answer-mode JSON without recognition stability is still readable; a
positive clean-recognition streak provides an initial prediction until the
next completed choice updates the new stability field. No schema migration is
needed.
