# #649 implementation and verification record

Baseline: `e5f84de498d27ea09c2ba42d79c685e6590ccee8`.
Verification date: 2026-11-21. Final runtime: Node.js 24.19.0.

## Changes delivered

- Current/legacy/experimental specification and architecture separated; conflicting all-held wording corrected.
- Optional in-selection decision observer; no second policy evaluation or extra random draws.
- Versioned, validated deterministic scenarios and replay snapshots; CLI JSON/text, graph timeline and baseline comparator.
- Beta-only anonymous diagnostic copy, actual effective modes, prior answer evidence and retry/hold state, current rendered graph.
- Shared forecast/segment implementation, focused test discovery and preserved CI compatibility entry point.
- Short, long and real-Client browser regressions; existing assertions retained.

## Red/green corrections

| Reproduction | Before | After | Scope |
| --- | --- | --- | --- |
| Unheld unfinished early-practice reload | current=null | exact question restored | cache reason allowlist |
| Held unfinished early-practice reload | current=null | exact question + hold restored | offline-only retained-hold exception |
| Infinity in stored stability | counted as mastered | zero prediction, invalid_memory detail | malformed-data aggregation only |

No new memory coefficients, due priorities, retry thresholds, DB formats or FSRS
conversion are introduced. The baseline comparator on the six-step mixed
fixture (seed 42, fixed initial state and virtual times) found zero differences
in selections, input updates and graph totals for valid data.

## Executed checks

| Check | Result |
| --- | --- |
| `npm run test:playground` | 180 passed, 0 failed |
| `npm run test:simulation:long` | 432 passed, 0 failed; 20 fixed seeds, 500-turn long patterns |
| `npm run test:selection-browser` | 40 passed across Chromium and WebKit |
| `npm run build` | passed including Next typecheck and existing prebuild suites |
| ESLint on changed production, CLI and new test files | passed |
| `git diff --check` | passed |
| `compare-learning.mts HEAD test/fixtures/learning/mixed.json` | zero selection/input/graph differences |

Next emitted a `LINE Seed JP` font override warning; the build succeeded.
Backend/shared server code was not changed; backend lifecycle/failover suites
were not run. Browser tests use the actual Client with stubbed auth/network,
not a deployed authenticated production environment.

## Remaining evidence / Phase 5 gate

The exact production sequences behind the two reported symptoms were not
provided. Current same-word retry-exit and due-before-unrelated-new-word cases
already pass on the starting implementation; do not describe them as newly
fixed historical regressions. The new export supplies the state needed to
reproduce a specific incident. A behavior-changing model redesign/FSRS migration
is deliberately a separate, evidence-gated phase, as requested by the issue.
No claim of improved long-term human retention is supported by these tests.

The simulator's reload flag round-trips its replay format. Real production
cache restoration and save rejection are tested separately using injected
storage and the existing Client/browser suites. Production diagnostic history
is not persisted across reload; resumption is labeled explicitly. Aggregate
metrics do not yet measure calibrated overdue latency or delayed human recall.
