# Practice, retention and session scheduling


See [specification](../../docs/learning/SPECIFICATION.md), [architecture](../../docs/learning/ARCHITECTURE.md), and [testing](../../docs/learning/TESTING.md). The unified scheduler from #648 is the production policy for offline and online prompts. The beta diagnostic observer is read-only and optional.

## Responsibilities

- `memory.ts` evaluates answers, stores separate typed-recall and recognition
  histories, and owns the retention model and its evidence interval.
- `scheduler.ts` owns short-term retries/holds and the session's remaining
  round, current question and presentation counters. Offline and online learning
  prompts use **one** selection policy. Online transport and game rules do not
  change; BOT exposure protection remains in the online adapter's helpers.
- `offline/Client.tsx` captures the exposure gap when a prompt starts and saves
  completed observations. Time spent answering or pausing cannot become spacing.

The inactive FSRS-7 foundation in `lib/learning` is not called by either game.
This change does not reinterpret existing stability values as FSRS values.

## Why the previous policy repeated recovered mistakes

The adaptive fallback ranked low predicted retention repeatedly, including
words already correctly practiced. Early practice was forbidden from updating
long-term memory, and every exposure restarted the time needed for genuine
retention evidence. The selection cooldown was only two minutes even when the
memory model required hours. These rules formed a feedback loop. The independent
cycle scheduler used a different policy, and a lifetime budget of eight new
words further reduced available alternatives.

The regression simulation (20 words, one initial error, then correct answers)
reproduced 33 presentations of the failed word versus 8–9 of each other word in
200 subsequent turns, in both answer modes.

## One selection policy

1. Serve eligible short-term retries, then expired holds when a retry slot opens.
2. Genuinely spaced reviews are eligible across the entire room, including
   words already consumed in the current round. They precede new words, then
   remaining-round rehearsal. Memory risk orders due reviews; last exposure
   orders rehearsal. A due review outside the round does not consume another
   round entry. Recent exposures postpone its next eligible long-term review,
   so repeatedly practicing the same word cannot inflate retention or starve
   other words indefinitely. Retry presentations consume their round entry.
3. While four retries are active, stop introducing new words. Previously answered
   words fill retry gaps. Resume introductions as retries are resolved; there is
   no fixed eight-word session ceiling or reset button required to keep learning.
4. If no filler exists, permit the earliest retry. If all words are held, allow
   rehearsal without cancelling their holds. Nonempty rooms never wait on a timer.

A failure/full reveal schedules a retry after two user turns, followed by a
five-turn confirmation after the first unaided success. Two such
successes finish the retry. A confident, independently recovered single typo
starts halfway through confirmation and gets the longer confirmation gap.
A later independent single-typo correction can advance that confirmation instead
of resetting it. Multiple errors, hints and failures never earn this credit.
Tiny rooms shorten gaps. BOT presentations do not advance user turns. Holds retain the existing escalating deadlines for persistent
struggle and remain protected while early rehearsal fills an otherwise empty game.

Even a rapid clean answer resolves a short-term task; requiring independent
retention evidence here previously trapped fast learners in endless retries.
Short-term success updates this retry state even when it cannot establish
long-term retention. It does not require a particular scheduler reason label.
`nextMemoryReviewAt` is informational and never pauses an active game.

## Retention evidence

Both modes share one minimum interval calculation: at least two minutes for
an encountered word without a memory anchor, otherwise the time corresponding
to the model's 80% target retention. Eligibility requires that entire interval
**without an intervening answer exposure**, and the existing memory anchor
must also be due. A first unexposed clean answer seeds the existing conservative
initial estimate. Subsequent correctly spaced answers increase stability;
spaced failures reduce it. Rehearsal successes and failures affect short-term
practice, not long-term stability or its review timestamp.

`lastPresentedAt` records actual exposure across both modes; `lastReviewedAt`
records independent retention evidence for that mode. They must not be merged
or selectively ignored to manufacture a long interval. In a small room with
continuous rehearsal, no long-term gain is expected until there is a real break.
The game remains playable, and the next properly spaced review can strengthen
memory regardless of the scheduler's diagnostic label.

Recognition has its own stability and anchor. A two- or three-option success is
weaker evidence than a four-option success. A single option is only exposure,
never a correct-recognition observation. Switching to typing does not turn
recognition into free-recall mastery. Corrected typing errors and response speed
alone are not recall failures. Hints, assistance and complete reveals retain
separate evidence classifications; recent exposure cannot prove independent recall.

The exponential forgetting curve, gains, intervals and retry thresholds remain
uncalibrated product hypotheses. Passing simulations is not evidence of improved
human retention. Validate with delayed unaided recall at matched learning time.

## Saved data and migration

Existing memory rows, counters, timestamps, stability values and unsent writes
remain readable; no destructive database migration or aggregate-history conversion
is performed. Old recognition JSON without stability uses the same conservative
fallback for prediction, scheduling and its next update.

The existing per-user/per-room/per-context `playground-scheduler:v1` cache is
read in place. Pending retries, holds, round order, counters and unfinished questions
survive. Removed `introduced`, `initialPriorityApplied` and `priorityAnswerMode`
fields are ignored: they are policy bookkeeping, not learning evidence. Old
`spaced_review` reasons remain readable; `early_practice` now also survives reload,
including an unfinished held-word rehearsal. New words join the remaining round;
deleted words and malformed entries are discarded individually. An interrupted
question older than six hours returns to the pool ungraded. Caches older than
30 days are discarded without deleting memory rows.

Answer-mode changes do not reshuffle the saved round or clear retries; priority
is evaluated using each item's effective mode at selection time. Short-term
retry tasks represent item familiarity and are shared across modes; long-term
recognition and recall remain separate. The existing immediate local cache,
serialized/debounced database synchronization and offline retry queue are retained.

## Verification

`npm run test:playground --prefix frontend` covers the regression, fair continuing
practice in 1/2/8/100-word rooms in both modes, reloads, mode changes, tiny-room
fallbacks, holds, failed writes, actual Client callbacks and memory evidence.
`npm run test:selection-browser --prefix frontend` exercises real selection UI
interactions; these component fixtures do not constitute authenticated production
end-to-end testing. Also run the frontend typecheck, relevant lint and Next build.


## Continuous early practice (v12)

Clean, unaided answers now receive a small continuous stability increase even
before the next full spaced review. The increment is linear in the interval
since the last exposure and bounded by elapsed time, so many rapid rehearsals
cannot multiply long-term retention. Recognition and free recall are still
separate tracks, and a sub-due rehearsal never moves the spaced-review anchor.
Incorrect or hinted answers do not receive this extra credit. The coefficient
is an uncalibrated product hypothesis; validate it against real longitudinal
retention before treating the predicted days as calibrated.
