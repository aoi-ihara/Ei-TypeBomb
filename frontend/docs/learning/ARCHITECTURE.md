# Learning architecture — unified scheduler

The production path is `offline/Client.tsx` → `chooseNextUserItem` → prompt →
`evaluateRecall` or `evaluateRecognition` → `recordUserAnswer` →
`applyRecallObservation` or `recordAnswerModeResult` → local cache / sync.
The online caller shares `scheduler.ts` but retains its own bot presentation flow.

- `scheduler.ts`: fair cycle selection, bounded short-term retries, suspension and
  long-term review scheduling. A supplied optional `DecisionObserver` runs only
  after the real choice has been made.
- `memory.ts`: eligibility and quality of retrieval evidence; separate recognition
  and free-recall retention models. Memory updates do not depend on chart display.
- `decision-trace.ts`: versioned read-only explanation schema.
- `replay.ts`: versioned, sanitized snapshots, validation and anonymous ID remapping.
- `diagnostics.ts`: links previous answer evidence with the actual captured selection.
- `mastery-graph.ts`: single chart calculation shared by UI, exports and simulations.
- `simulation.ts`: invokes the production scheduler and memory evaluator using a
  deterministic pseudo-random stream, supporting reload and delayed checks.

The observer must not cause new policy evaluations or modify game state. Diagnostics
are gated by `NEXT_PUBLIC_BETA_ENVIRONMENT` and do not include content or user identity.
Do not reintroduce `adaptive-scheduler.ts`: it was removed in #648.

See [specification](SPECIFICATION.md), [testing](TESTING.md) and [test inventory](TEST_INVENTORY.md).
