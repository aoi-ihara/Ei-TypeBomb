# PostHog Audit Report

## Summary

The audit covered both browser and server PostHog runtimes. The SDKs are installed and stable browser identity is used, but cross-runtime identity, logout reset behavior, dynamic event naming, duplicate browser initialization risk, missing growth coverage, and six active PostHog health findings require attention.

**Counts**

- **Errors**: 5 (must fix)
- **Warnings**: 10 (should fix)
- **Suggestions**: 0 (nice to have)
- **Passes**: 3

**Problematic items**

| Severity | Area | Check | File | Details |
|----------|------|-------|------|---------|
| `error` | Identification | Same distinct_id across client and server | `lib/AI/generateWords.ts:54` | Server-side AI captures do not source the browser client's distinct_id. |
| `error` | Identification | reset() called on logout / account switch | `components/account/AccountDetails.tsx:50` | Account settings sign-out does not call `posthog.reset()`. |
| `error` | Event Capture | Event names are static and consistent | `app/(game)/[link]/offline/Client.tsx:920` | A capture event name uses a conditional expression rather than a static string literal. |
| `error` | Live Data | Web SDK out of date |  | Web SDK 1.438.7 still handled more than 20% of recent events. |
| `error` | Live Data | Node SDK out of date |  | posthog-node 5.52.1 still handled more than 10% of recent events. |
| `warning` | Installation | SDK version up to date | `package.json:29` | Several PostHog packages are more than one minor behind. |
| `warning` | Installation | Initialization is correct | `app/providers.tsx:13` | Browser init is non-canonical, the canonical token variable is unset, and server init can use an empty token. |
| `warning` | Installation | One initialization per runtime | `instrumentation-client.ts:12; app/providers.tsx:13` | Two browser init sites can execute together if both token variables are configured. |
| `warning` | Identification | identify() called before captures / flag evals | `app/(game)/RoomList.tsx:161` | Identification happens only when the room list mounts. |
| `warning` | Event Capture | Captures route through a reverse proxy | `app/providers.tsx:18` | One browser init can fall back to the default PostHog host. |
| `warning` | Event Capture | Key activation events captured | `lib/auth/account.ts:38` | Signup is not explicitly captured; purchase/subscription events are also absent. |
| `warning` | Live Data | No pageleave events |  | PostHog received pageviews but no pageleave events in 30 days. |
| `warning` | Live Data | Warehouse sync failed |  | A Supabase external-data sync is failing. |
| `warning` | Live Data | No reverse proxy detected |  | Live data indicates direct browser ingestion. |
| `warning` | Live Data | Second warehouse sync failed |  | A second Supabase external-data sync is failing. |

## Recommended actions

1. **Identification · Same distinct_id across client and server** — Server-side AI events are not correlated with the browser user's distinct ID. _Why it matters:_ Split identities corrupt person counts, funnels, retention, and per-user AI usage. _Fix:_ Pass the client distinct ID into server calls and use it at `lib/AI/generateWords.ts:54`. See [identifying users](https://posthog.com/docs/product-analytics/identify).
2. **Identification · reset() called on logout / account switch** — One account-settings logout path leaves PostHog identity state intact. _Why it matters:_ A later login on the same device can merge two accounts into one person. _Fix:_ Call `posthog.reset()` in the logout flow at `components/account/AccountDetails.tsx:50`. See [identifying users](https://posthog.com/docs/product-analytics/identify).
3. **Event Capture · Event names are static and consistent** — One capture call computes its event name dynamically. _Why it matters:_ Dynamic names fragment schemas and make funnels and trends brittle. _Fix:_ Replace the conditional event-name expression at `app/(game)/[link]/offline/Client.tsx:920` with explicit capture branches using static names. See [capturing events](https://posthog.com/docs/product-analytics/capture-events).
4. **Live Data · Web SDK out of date** — A substantial share of recent browser traffic still comes from posthog-js 1.438.7. _Why it matters:_ Old clients can omit fixes and produce behavior inconsistent with current analytics configuration. _Fix:_ Upgrade the web SDK dependency and redeploy all browser clients. See [JavaScript SDK installation](https://posthog.com/docs/libraries/js).
5. **Live Data · Node SDK out of date** — A substantial share of recent server traffic still comes from posthog-node 5.52.1. _Why it matters:_ Mixed server SDK behavior can make event delivery and properties inconsistent across deployments. _Fix:_ Upgrade posthog-node and redeploy all server runtimes. See [Node.js SDK installation](https://posthog.com/docs/libraries/node).
6. **Installation · SDK version up to date** — The manifest pins several PostHog packages well behind current published versions. _Why it matters:_ Stale packages miss bug fixes and can diverge from current SDK semantics. _Fix:_ Update the PostHog dependencies in `package.json:29` and refresh the lockfile. See [SDK documentation](https://posthog.com/docs/libraries).
7. **Installation · Initialization is correct** — Initialization is split between a non-canonical provider and an inactive canonical entrypoint, while the server can construct a client with an empty token. _Why it matters:_ Environment drift can silently disable capture or create runtime-specific behavior. _Fix:_ Consolidate browser init in `instrumentation-client.ts`, use one configured token variable, and guard server client construction instead of passing an empty token from `app/providers.tsx:13`. See [Next.js setup](https://posthog.com/docs/libraries/next-js).
8. **Installation · One initialization per runtime** — Two browser init sites can both execute when both token variables are configured. _Why it matters:_ Duplicate initialization can race `$set_once` attribution fields and distort initial referrer and pathname data. _Fix:_ Keep a single browser init and remove the duplicate across `instrumentation-client.ts:12` and `app/providers.tsx:13`. See [Next.js setup](https://posthog.com/docs/libraries/next-js).
9. **Identification · identify() called before captures / flag evals** — Identification waits for the room-list component instead of session startup. _Why it matters:_ Direct visits to other routes produce anonymous events and identity-dependent flag evaluations. _Fix:_ Identify authenticated users at session initialization before route captures, rather than only at `app/(game)/RoomList.tsx:161`. See [identifying users](https://posthog.com/docs/product-analytics/identify).
10. **Event Capture · Captures route through a reverse proxy** — One active browser init can fall back to direct PostHog ingestion. _Why it matters:_ Ad blockers can drop those events and bias funnels, experiments, and traffic metrics. _Fix:_ Make the configured first-party ingest path mandatory in `app/providers.tsx:18` and remove the direct-host fallback. See [reverse proxy documentation](https://posthog.com/docs/advanced/proxy).
11. **Event Capture · Key activation events captured** — Signup lacks explicit capture and no purchase/subscription event exists. _Why it matters:_ Growth funnels cannot reliably measure acquisition-to-activation conversion from autocapture alone. _Fix:_ Add a static signup event at `lib/auth/account.ts:38` and add purchase/subscription capture only when a billing flow exists. See [capturing events](https://posthog.com/docs/product-analytics/capture-events).
12. **Live Data · No pageleave events** — PostHog observed pageviews without pageleave events for 30 days. _Why it matters:_ Missing pageleave events weaken web analytics duration, bounce, and navigation measurements. _Fix:_ Enable pageview autocapture or emit matching `$pageleave` events for the manual router integration. See [web analytics](https://posthog.com/docs/web-analytics).
13. **Live Data · Warehouse sync failed** — One Supabase external-data sync remains failed. _Why it matters:_ Stale warehouse tables contaminate analyses, joins, dashboards, and downstream reporting. _Fix:_ Inspect the source job and logs, set a valid primary key or full-table replication, then rerun the sync. See [data warehouse sources](https://posthog.com/docs/data-warehouse/sources).
14. **Live Data · No reverse proxy detected** — PostHog's live health check sees browser traffic arriving without a proxy. _Why it matters:_ Blocked requests create systematic undercounting across web analytics and product funnels. _Fix:_ Verify the Next.js proxy routes both ingestion and asset paths, point `api_host` and `ui_host` at it, and redeploy. See [reverse proxy documentation](https://posthog.com/docs/advanced/proxy).
15. **Live Data · Second warehouse sync failed** — A second Supabase external-data sync remains failed. _Why it matters:_ A second stale source can independently produce incomplete warehouse analyses and misleading dashboards. _Fix:_ Inspect that source job and logs, set a valid primary key or full-table replication, then rerun the sync. See [data warehouse sources](https://posthog.com/docs/data-warehouse/sources).

## Full audit

### Installation

Whether the PostHog SDK is present, current, and initialized the way the framework expects. Everything downstream depends on this: a missing or stale SDK silently changes which events exist and which config options are honoured.

| Check | Status | File | Details |
|-------|--------|------|---------|
| PostHog SDK installed | `pass` | `package.json:29` | posthog-js@^1.438.7, posthog-node@^5.52.1, @posthog/react@^1.11.3, @posthog/ai@^8.13.4 |
| SDK version up to date | `warning` | `package.json:29` | posthog-js installed 1.438.7 latest 1.449.2; posthog-node installed 5.52.1 latest 5.73.1; @posthog/react installed/latest 1.11.3; @posthog/ai installed 8.13.4 latest 8.20.0 |
| Initialization is correct | `warning` | `app/providers.tsx:13` | Browser init uses a configured env token but is in a non-canonical provider; canonical instrumentation-client.ts uses unset NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN, and server init constructs a client with an empty token when missing. |
| One initialization per runtime | `warning` | `instrumentation-client.ts:12; app/providers.tsx:13` | Two browser-runtime init sites exist. Only the provider currently initializes because its env key is configured, but both can run on the same page if NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is later set. |

#### Assumptions and blind spots

The audit checked manifest declarations and discovered init sites but did not execute a production browser deployment. Static code cannot prove which environment variables and build-time branches are active in every deployment. A stale deployment could explain some version traffic independently of the current manifest. Verify the active SDK versions, custom API host, and initialization behavior in PostHog's SDK health and live events views after redeploying.

### Identification

Whether the same human maps to one stable `distinct_id` across sessions, runtimes, and logins. Identity defects are the most expensive kind to fix after the fact, because they corrupt person counts, funnels, and retention retroactively rather than going forward.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Stable distinct_id (not session UUID) | `pass` | `app/(game)/RoomList.tsx:161` | identify() uses currentUser.id from the authenticated user object, providing a stable user identifier. |
| identify() called before captures / flag evals | `warning` | `app/(game)/RoomList.tsx:161` | identify() runs only when the room-list component mounts, so authenticated users entering editor or game routes directly can emit events anonymously. |
| Same distinct_id across client and server | `error` | `lib/AI/generateWords.ts:54` | Both client and server initialize PostHog, but server-side AI captures do not receive or source the browser client's distinct_id. |
| reset() called on logout / account switch | `error` | `components/account/AccountDetails.tsx:50` | Account settings sign-out calls signOut() without posthog.reset(); the RoomList sign-out flow resets correctly. |

#### Assumptions and blind spots

The scan covered explicit identify, capture, logout, and initialization call sites, but indirect wrappers or runtime middleware may not match those patterns. Static code cannot prove the authenticated object always contains the same stable ID or that every route mounts the same session bridge. Server AI events might intentionally represent a non-user actor, but that would need an explicit identity contract. Confirm person merges, anonymous-to-identified transitions, and matching client/server distinct IDs in live events for a test account.

### Event Capture

Whether events are named consistently, reach PostHog reliably, and cover the moments the business actually reasons about. Gaps here don't break anything visibly; they just leave the questions you want to ask unanswerable.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Event names are static and consistent | `error` | `app/(game)/[link]/offline/Client.tsx:920` | A capture event name uses a conditional expression instead of a static string literal. |
| Captures route through a reverse proxy | `warning` | `app/providers.tsx:18` | Browser PostHog can initialize with the default PostHog host fallback, although instrumentation-client.ts:13 uses the same-origin /ingest proxy. |
| Key activation events captured | `warning` | `lib/auth/account.ts:38` | Signup exists without explicit capture; activation is captured as room_created, while signup and purchase/subscription events are missing and no billing paths were detected. |

#### Assumptions and blind spots

The event scan checked explicit `posthog.capture()` calls and likely growth surfaces, not events emitted through unrelated wrappers or backend ingestion services. Static inspection cannot prove proxy rewrites are deployed correctly or that browser blockers allow requests through. The absence of billing paths may be intentional for a free product, so purchase events should only be added when such a flow exists. Verify event names, proxy host properties, signup coverage, and delivery volume in live events after changes.

### Live Data

What PostHog itself has already flagged for this project, read from its recommendations and health checks. These come from ingested data rather than source code, so they catch problems no static scan can see — stack frames that never resolve, syncs that keep failing, alerts nobody wired up.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Open findings in PostHog | `pass` |  | 6 open findings from PostHog |
| Web SDK out of date | `error` |  | Web SDK 1.438.7 handled more than 20% of events in the last 7 days while 1.449.1 was latest. Update the web SDK dependency and redeploy. |
| Node SDK out of date | `error` |  | posthog-node 5.52.1 handled more than 10% of events in the last 7 days while 5.73.0 was latest. Update posthog-node and redeploy. |
| No pageleave events | `warning` |  | PostHog received $pageview but no $pageleave events in 30 days. Enable pageview autocapture or emit matching $pageleave events for manual routing. |
| Warehouse sync failed | `warning` |  | A Supabase external-data sync is failing. Inspect its source job and logs, fix the configuration or reconnect credentials, then rerun the sync. |
| No reverse proxy detected | `warning` |  | No reverse proxy was detected. Configure a first-party proxy, set api_host and ui_host to it, and redeploy. |
| Second warehouse sync failed | `warning` |  | A second Supabase external-data sync is failing. Inspect its source job and logs, fix the configuration or reconnect credentials, then rerun the sync. |

#### Assumptions and blind spots

These findings reflect what PostHog observed in the recent lookback window, so a project that has just started sending data, or one whose findings haven't been recomputed yet, can show a clean area without being clean. The health sweep did not independently re-derive thresholds or validate source-provided payload text. Old deployed clients may continue producing SDK warnings after the manifest is fixed. Recheck PostHog Health after fresh browser and server deployments and after warehouse syncs rerun.

### Write report

Whether the local markdown audit artifact was created successfully.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Create posthog-audit-report.md | `pending` |  | Report generation was in progress when the ledger snapshot was rendered. |

#### Assumptions and blind spots

This workflow row is resolved after the report exists, so it is necessarily pending in the report's source snapshot. Verify the local file exists and opens as valid markdown.

### Upload notebook

Whether the local report was mirrored into a shareable PostHog notebook.

| Check | Status | File | Details |
|-------|--------|------|---------|
| Write the report into a PostHog notebook | `pending` |  | Notebook upload begins after the local report is complete. |

#### Assumptions and blind spots

This workflow row is resolved only after every notebook section is uploaded and read back. Verify the final notebook contains Summary, Recommended actions, Full audit, and About this audit.

## About this audit

The PostHog wizard runs this audit in stages: SDK installation → init correctness → identification → event capture → live data → this report. The early stages resolve checks against the project's source tree. The live-data stage reads what PostHog already computed from your ingested data — things no source scan can see, like whether stack frames actually resolve. Every result, pass or otherwise, is recorded in the ledger this report was generated from.

- `error` items break correctness now (events lost, identity broken). Fix first.
- `warning` items work today but cause subtle data-quality bugs. Fix when convenient.
- `suggestion` items are best-practice improvements with measurable upside.

Re-run `posthog-wizard audit` after applying fixes to refresh the ledger.
