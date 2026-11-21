# Learning architecture

## Production data flow

Room items + chosen answer mode → `getEffectiveAnswerMode` per item → scheduler
selection → prompt (capture exposure gap) → answer observations → evaluator →
retry/hold update + memory update → local cache/pending sync → next selection.
The scheduler mutates only its session state. Memory update functions return new
memory objects. Transport, localStorage and React timers live in the Client or
storage adapters, not the simulator's prediction logic.

`memory.ts`: evidence evaluation, exponential recall/recognition models, mastery
aggregation. `scheduler.ts`: shared retry/hold transitions, legacy online
selection, cache validation. `adaptive-scheduler.ts`: offline policy only.
`mastery-graph.ts`: shared segments and forecast snapshot. `simulation.ts`:
virtual-clock orchestration using those same exported production functions.

## Observation and replay

`DecisionObserver` is optional. It records evaluated stages and rankings during
the actual adaptive selection; skipped stages are absent, not fabricated.
`decision.schedulerBefore` is cloned before any mutation. The chosen selection
and actual fallback random draws are captured without a second selection run.
Candidates describe retry/hold, below-threshold/cooldown exclusions, introduction
budget, due rank and early practice rank. Ties preserve the scheduler input
order; the replay preserves that order. `previousAnswer` holds the immediately
preceding memory transition, evaluation and scheduler state after its answer.
Only one decision and one answer event are retained (bounded by room size).

`ReplaySnapshot` v1 carries algorithm/memory versions, clock, RNG state, effective
modes, scheduler state and allowlisted memory fields. Scenario snapshots reject
unknown versions, unsafe IDs and invalid typed values. This is a new debugging
format, not a replacement for either persistent production cache.

The beta Client (`NEXT_PUBLIC_BETA_ENVIRONMENT === "true"`) alone supplies the
observer and creates detailed graph entries. Production creates only the small
shared graph aggregate for its UI. The flag is not a security boundary. Copying
is a user click; JSON contains room-order `item-N` aliases and allowlisted numeric/
date/enum state, never account identity, question/answer text or typed strings.
Memory identities are replaced with `anonymous`/`local`. A copied payload is
limited to 2,000,000 UTF-16 code units; large/invalid diagnostics fail visibly
without interrupting practice. No upload or telemetry of this payload occurs.
The complete anonymized replay is intentionally included: it is needed to replay
all competing candidates. Only current-room learning statistics are included.
It may still be sensitive learning-performance data; keep exports local unless
the learner chooses to share them. No original-ID mapping is exported. Aliases are deterministic for a given room
order; they are not a cryptographic anonymity guarantee.

The latest UI graph uses its existing render clock, not the older decision clock.
On copy it is joined to the stored decision; `calculatedAt` disambiguates them.
A copied selection can be replayed exactly with recorded random draws; subsequent
new randomness uses the simulator seed because the browser's Math.random state
is unavailable. Do not claim an exact future browser sequence from that export.

## Compatibility and staged change

The first stage preserves valid-data selection, learning update and DB formats.
The cache restoration correction explicitly admits `early_practice` (and permits
its retained hold in offline mode only). No online selection policy is changed.
Diagnostics do not change model values or normalize existing memory into FSRS.
The FSRS engine remains unused by production. A future migration requires new
storage and trustworthy individual review logs or an explicit new learning
state; never copy legacy stability/difficulty into an FSRS card unchanged.

Phase 5 redesign is evidence-gated: collect a reproducible failing scenario,
compare same clock/seed/state/events before and after, document learning rationale
and tradeoffs, then propose a separate behavior-changing change. The newly found
reload defect has red/green evidence in `test/learning/reload.test.mts`; no claim
is made that it explains every user-reported repetition problem.

A question restored from the existing scheduler cache is marked `resume` in the
trace. Its original pre-reload decision history was not persisted and is not
reconstructed by rerunning selection; the trace describes resumption at the
recorded time. This keeps the existing cache format unchanged.
