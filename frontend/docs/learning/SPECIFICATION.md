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

Retry turns, suspensions and long-term recall evidence are **independent**. A short-term confirmation
cannot falsely increase long-term stability; a correct early answer without sufficient elapsed time
does not advance the long-term memory anchor. For implementation details and current constants,
see `scheduler.ts` and `memory.ts`.

## Diagnostics and mastery

The beta-only settings action exports anonymized snapshots of the **actual** selection
at its execution time, a ranked candidate summary, previous answer evidence, scheduler before/after,
effective modes and mastery forecasts. Capturing the selection neither invokes the scheduler again
nor consumes additional random draws. Snapshots are versioned with
`SCHEDULER_VERSION` and `MEMORY_MODEL_VERSION`.
Simulation uses the same production modules, never a separate selection policy.

Each unique item contributes to the mastery chart once. Its effective input or selection
mode determines prediction at now / +3h / +24h against an inclusive threshold of 0.8.
The UI and export call `getMasteryGraph` and `masterySegments`. Graph segments are
24h (cyan), 3h-only (foreground), now-only (border), and below threshold (background).
Forecasts are estimates, not measured human memory performance.

## Scope

FSRS-7 remains experimental and is not silently substituted for the current model.
Diagnostic snapshots exclude questions, answers, account IDs and room IDs;
aliases are stable only inside the captured JSON. No diagnostic data is sent remotely.
