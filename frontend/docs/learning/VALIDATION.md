# #650 integration record

PR #650 originally targeted scheduler revision `e5f84de`. PR #648 subsequently merged
a unified scheduling model and removed `adaptive-scheduler.ts`.

The merge resolution retains #648's scheduler and memory behavior and ports the #650
observer, sanitized replay, simulation, progress graph, beta copy UI and test suites.
`SCHEDULER_VERSION` was updated to distinguish snapshots from the removed adaptive policy.

## Verification

Run from the repository root:

```sh
npm --prefix frontend run test:learning
npm --prefix frontend run test:simulation
npm --prefix frontend run test:game
npm --prefix frontend run test:fsrs
npm --prefix frontend run test:selection-browser
cd frontend && npx tsc --noEmit
```

Browser tests require the project's Playwright setup. These checks should be run on the
merged revision; passing results must be established by CI, not inferred from mergeability.
