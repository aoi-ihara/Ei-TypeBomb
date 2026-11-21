# Learning tests and reproduction

Run from the repository root (`npm --prefix frontend run ...`):

| Command | Responsibility |
| --- | --- |
| test:learning | mode/memory, adaptive scheduler, diagnostics and reload units |
| test:simulation | short deterministic scenarios; CI-safe fixed seed |
| test:simulation:long | explicit 20-seed × 7-size × 3-pattern × 500-turn experiment |
| test:game | retained legacy online/offline integration and callback suites |
| test:fsrs | isolated experimental FSRS-7 engine |
| test:playground | compatibility entry point running all four groups |
| test:selection-browser | real Client and controls in Chromium and WebKit |
| simulate:learning -- test/fixtures/learning/mixed.json --json | detailed replay timeline |

The existing online-memory workflow keeps `test:playground` and therefore also
runs the new focused tests. Frontend-input CI runs the browser tests including
beta/production diagnostic checks. The long simulation is deliberately opt-in.
The runner discovers new `test/learning/*.test.mts` files automatically. Keep
new tests focused there; do not add another chain of filenames to package.json.

## Scenario JSON v1

The runtime schema is `scenarioSchema` in `simulation.ts` (unknown step/evidence
fields rejected). Required: schemaVersion=1, uint32 seed, ISO UTC startAt, items
(id + effective `input`/`selection` mode), steps. Duplicate item IDs are deduped
by production scheduler; use one effective mode per ID. An optional
`ReplaySnapshot` v1 overrides initial clock, RNG, modes, memory and scheduler.

Each step advances virtual time by `advanceMs` (default 0), selects the actual
next item, captures exposure gap at presentation, optionally JSON-round-trips
an in-flight snapshot (`reload:true`), then answers and advances by `elapsedMs`.
Results: `correct`, `wrong`, `hint`, `reveal`. Default observation: five-character
answer, one attempt, 500ms first-key latency, 1200ms duration, no hints for clean
answers; hint supplies one character; reveal supplies all five. Correct is
first-attempt correct; wrong/reveal are unsuccessful. `observation` overrides
first-attempt, correctness, hint count/proportions, full reveal, incorrect-input
count, latency, elapsed time and expected typing time. Exposure gap and scheduler
reason always come from the actual prompt. `choiceCount` defaults to 4 (2–4);
`responseMs` defaults to answer duration. Effective mode is supplied by the
fixture; the browser test exercises the UI's effective-mode resolution.

Every timeline row includes chosen ID/reason, pre-selection replay, actual
candidate trace, memory before/after, evidence/evaluation, retry/hold state after
answer, and before/after graph. The final `nextDecision` previews the next
question without altering the saved final state. CLI text shows three forecast
counts and four percentages; JSON includes full detail. Metrics currently cover
frequency, consecutive repeats, early practice and introduction count, not human
learning efficacy or calibrated overdue-latency measurement.

`npm --prefix frontend run simulate:learning -- /path/to/copied.json --json`
also accepts beta diagnostic exports. This replays their exact selected decision,
then uses one default clean answer (not a reconstruction of the user's next
answer). For custom continuation, place `replay` into a scenario's `snapshot`
and specify subsequent steps. Browser random fallback draws are recorded for
the captured decision only. Snapshot model/version mismatches fail explicitly.
CLI output includes current git HEAD; dirty working-tree changes are not a
separate commit, so record `git diff` alongside a comparison artifact.

## Regression evidence and limits

`reload.test.mts` failed before the correction: both held and unheld unfinished
`early_practice` restored as null; both pass after allowing this reason and the
offline-held exception. Other priorities and persistent formats are preserved.
The 31 initial new unit/scenario cases passed after normalizing optional fields
in JSON replay snapshots (absent and undefined are equivalent on disk).

The current code already passes general retry-exit and due-before-new scenarios.
They are retained regression guards, **not** fabricated red/green reproductions
of the two anecdotal production incidents in #649. Exact production histories
are still required to attribute those incidents. Do not weaken assertions or
change thresholds merely to force an incident match. Production failover and
human retention are not tested by any local learning fixture.

Browser diagnostics tests mount the real offline Client with network/auth
adapters stubbed; they compare copied graph counts/widths/ARIA to its actual DOM,
check anonymous payloads, clipboard rejection, and production button absence.
They are not authenticated deployment E2E tests. Existing source-extracted
callback tests remain valuable but do not replace these browser tests.

## Audit and retention decisions

No existing assertions or files are deleted. Existing flat files remain at their
paths because their source-extraction loaders and CI commands depend on them.
Move/split one responsibility at a time once an equivalent guarantee is tested;
new work uses `test/learning` and `test/browser`. Deprecate a test only when the
spec explicitly removes its guarantee or another test proves the same behavior.

| Existing suite | Class / responsibility | Decision |
| --- | --- | --- |
| playground.test.cjs | Unit + scenario + extracted Client/Input callbacks; legacy selection, memory, holds, storage, save failure | Maintain; mixed historical suite explicitly in game group; inject disabled diagnostic flag into its VM |
| scheduler-policy.test.mts / practice-policy.test.mts | Unit / current offline priorities and early-practice credit | Maintain in learning |
| answer-mode.test.mts | Unit / mode resolution, recognition, mixed mastery | Maintain in learning |
| online-memory.test.cjs | Integration / online timing, sync, history | Maintain in game |
| retry-gap.test.cjs | Unit / shared retry spacing | Maintain in game; guards online compatibility |
| automatic-hint-evidence.test.cjs | Unit / hint evidence and retry | Maintain in game |
| fsrs7-engine.test.mts | Unit / experimental independent engine | Maintain separately |
| browser/selection.spec.ts | Browser integration / choice keyboard, Client, pause, guest reload | Maintain unchanged |
| learning/*.test.mts | Unit/scenario / new replay, graph, privacy, reload | Added |
| browser/learning-diagnostics.spec.ts | Browser integration / graph-copy consistency and gating | Added |

Other test domains are not silently folded into learning. The inventory below
records every existing non-learning suite's ownership and preservation decision.

| Other suite | Domain / class | Decision |
| --- | --- | --- |
| account-auth.test.cjs | auth/MCP; unit/integration | Maintain existing command and assertions |
| backfill-readings.sh | room/editor; unit/integration | Maintain existing command and assertions |
| beta-access.test.cjs | room/editor; unit/integration | Maintain existing command and assertions |
| bot-typing.test.mjs | input/content; unit/integration | Maintain existing command and assertions |
| editor-rebase.test.mts | room/editor; unit/integration | Maintain existing command and assertions |
| generate-words.test.mjs | input/content; unit/integration | Maintain existing command and assertions |
| import-words.test.mjs | input/content; unit/integration | Maintain existing command and assertions |
| json-export-duplicates.test.mjs | input/content; unit/integration | Maintain existing command and assertions |
| mcp-authorization-server.test.mts | auth/MCP; unit/integration | Maintain existing command and assertions |
| mcp-database-tls.test.mts | auth/MCP; unit/integration | Maintain existing command and assertions |
| mcp-etb-auth.test.cjs | auth/MCP; unit/integration | Maintain existing command and assertions |
| mcp-oauth-diagnostics.test.mts | auth/MCP; unit/integration | Maintain existing command and assertions |
| mcp-oauth-discovery.test.mjs | auth/MCP; unit/integration | Maintain existing command and assertions |
| partial-update.test.mts | room/editor; unit/integration | Maintain existing command and assertions |
| posthog-identity.test.cjs | auth/MCP; unit/integration | Maintain existing command and assertions |
| public-feed-isr.test.cjs | room/editor; unit/integration | Maintain existing command and assertions |
| public-room-cache.test.cjs | room/editor; unit/integration | Maintain existing command and assertions |
| romaji-input.test.mjs | input/content; unit/integration | Maintain existing command and assertions |
| room-data-cache.test.cjs | room/editor; unit/integration | Maintain existing command and assertions |
| room-delete-security.test.cjs | room/editor; unit/integration | Maintain existing command and assertions |
| room-edit-version.sh | room/editor; unit/integration | Maintain existing command and assertions |
| room-list.test.mts | room/editor; unit/integration | Maintain existing command and assertions |
| room-readings.test.mts | room/editor; unit/integration | Maintain existing command and assertions |
| room-update-security.test.cjs | room/editor; unit/integration | Maintain existing command and assertions |

Case-level names and parameterized size/seed labels are emitted by Node test.
Use `node --import tsx --test --test-reporter=spec <file>` from frontend to inspect
a suite; assertion failures print the fixture size/seed. Preserve failure output
when filing an incident, plus the scenario JSON and simulator `--json` timeline.

The [case inventory](TEST_INVENTORY.md) lists source-level case titles, including
parameterized declarations, with retention decisions. It does not imply every
non-learning suite was rewritten or belongs to the learning CI entry point.

A second red/green regression covers non-finite stored stability: Infinity
previously produced 100% predicted mastery; aggregation now treats that invalid
track as zero and marks `invalid_memory`. Valid-memory forecasts are unchanged.

For a persistently difficult item, a step may include
`"resultsByItem": {"A":"wrong"}` with `"result":"correct"` as its default.
The override is applied only **after** the actual scheduler selects its item.
It cannot force the selected word. Short scenarios cover this for all seven sizes.

For a read-only same-state comparison against committed code, from `frontend`:
`npx tsx scripts/compare-learning.mts <baseline-commit> test/fixtures/learning/mixed.json`.
The comparator executes the baseline production scheduler/memory modules and
checks every selection, input update, input retry transition, and graph against
the current run at identical virtual times. Recognition memory behavior is
covered by its existing regression suite; this comparator does not compare its
update function separately. The mixed six-step fixture initially showed zero
selection, input-update and graph differences from the starting HEAD.

Final executed results and remaining evidence gates: [validation record](VALIDATION.md).


## Merge note (#648 → #650)

The unified scheduler supersedes the separate adaptive module. `test:learning`
uses `scheduler-policy.test.mts` and `practice-policy.test.mts` along with
new diagnostics/reload tests. For the current selection contract, see [SPECIFICATION.md](SPECIFICATION.md).
