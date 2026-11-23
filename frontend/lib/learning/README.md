# FSRS-7 foundation (not yet activated)

`engine.ts` is a standalone, opt-in implementation of the memory model.
Playground and online play **still use** the existing `playground/memory.ts`
and their existing schedulers. No database schema, memory rows, game UI,
or user review history is changed by this stage.

## Public interface

- `createMemoryCard(identity, now)`: create an FSRS-7 New card. Identity is
  stable and contains room ID, item ID and mode; recall and recognition have
  independent cards.
- `evaluateAnswer(observation)`: Grade Again for first-attempt failures and
  any hint; Hard only for explicit retrieval difficulty; Good for independent
  recall. Do not infer Easy from typing speed.
- `reviewMemoryCard(card, observation, now)`: return a **new** card and
  `revlog` from the upstream `DefaultScheduler`; the caller must persist
  both atomically when wiring the database.
- `predictRetention(card, at)`: return `null` for an unreviewed card or
  an FSRS-7 probability for a reviewed card. No legacy exponential function.

## Runtime and migration

The versioned configuration uses `ts-fsrs@6.0.0` with FSRS-7 default
weights, a target retention of 0.9, 1m/10m learning steps and 10m
relearning. It requires Node.js 24; only frontend CI builds change runtimes.

Do **not** copy existing Playground `stability`, `difficulty` or
recognition metrics into an FSRS-7 card, infer `stabilityFast`, or treat
existing aggregate counters as complete review logs. A future migration
needs a separate storage schema and complete, trustworthy review history
or an explicitly new FSRS-7 learning state. Keep all old rows intact.

Run `npm run test:fsrs` from `frontend` to verify the standalone engine.

Production integration and migration policy: [architecture](../../docs/learning/ARCHITECTURE.md).
Experimental tests stay in the separate `test:fsrs` group.
