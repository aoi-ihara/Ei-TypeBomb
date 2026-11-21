# Offline learning specification — unified policy after #648

## Production selection

`offline/Client.tsx → chooseNextUserItem` uses the **unified** scheduler in `lib/playground/scheduler.ts`.
The `adaptive-scheduler.ts` module was removed by #648. The same scheduling policy is used
for offline study and online interactions; online mode additionally interleaves bot prompts.

In order: eligible retries (earliest deadline first); expired suspensions when capacity allows;
due long-term reviews within the remaining cycle; unseen cycle items; previously seen cycle items;
early-practice fillers during retry gaps; pending retry fallback; a nonempty room's uncredited
held-word practice as a last resort. The queue is fair and bounded, not an unbounded repetition loop.
Low predicted retention alone does not create extra retries.

A previously exposed word with a corrected/clean rehearsal but no confirmed
spaced-review timestamp is held out of ordinary cycle/filler selection until
its first genuinely spaced review is due. Otherwise every quick rehearsal resets
the required interval and difficult words can indefinitely remain unconfirmed.
Words that are still in an unresolved failure streak keep their normal
short-term relearning priority. Due unconfirmed items return with the usual
high-priority review group; if all cards are waiting, a fair fallback keeps play
available but never claims spaced evidence.

Corrected typing errors (without a hint) still count as successful unaided
retrieval for memory estimation, but explicitly schedule bounded short-term
confirmation. They do not count as failed recalls for suspension/difficulty.
Multiple consecutive clean confirmations clear that retry queue.

Retry turns, suspensions and long-term recall evidence are **independent**. A clean,
unaided early answer now gives a small continuous stability gain proportional to
the answer-free interval (0.25 days of stability per full day of elapsed intervals).
This contribution is deliberately bounded by elapsed time, not number of answers;
assisted or incorrect answers do not receive it. An early answer **never advances
the long-term memory anchor**: only properly spaced independent evidence can do that.
These coefficients are uncalibrated product hypotheses, not empirical retention guarantees.
For implementation details and current constants, see `scheduler.ts` and `memory.ts`.

## Diagnostics and mastery

The beta-only settings action exports anonymized snapshots of the **actual** selection
at its execution time, a ranked candidate summary, previous answer evidence, scheduler before/after,
effective modes and mastery forecasts. Capturing the selection neither invokes the scheduler again
nor consumes additional random draws. Snapshots are versioned with
`SCHEDULER_VERSION` and `MEMORY_MODEL_VERSION`.
Simulation uses the same production modules, never a separate selection policy.

Each unique item contributes to the mastery chart once. Its effective input or selection
mode determines prediction at now / +3h / +24h against an inclusive threshold of 0.8.
The UI and export call `getMasteryGraph` and `masterySegments`.
The stability bar uses a continuous 96-sample gradient from background-secondary to
cyan-600, ordered by each item's recall or recognition stability; the separate
forecast totals are based on 0 / +3h / +24h retrievability.
Forecasts are estimates, not measured human memory performance.

## Scope

FSRS-7 remains experimental and is not silently substituted for the current model.
Diagnostic snapshots exclude questions, answers, account IDs and room IDs;
aliases are stable only inside the captured JSON. No diagnostic data is sent remotely.
