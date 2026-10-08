# Shared game core

## Boundaries

`shared/` contains no transport, database, storage, clock, UUID, or timer API.
It defines room/player/item types, the wire protocol, common validation and rate
limit settings, and pure game transitions.

The runtime supplies the current time, randomness, and a game ID. A transition
returns the next `GameState` and typed wire effects. Each adapter sends the effects
and broadcasts a room snapshot; the snapshot retains legacy `words: {jp, en}[]`
for current clients and does not expose room passwords.

| Responsibility | Node.js | Cloudflare |
| --- | --- | --- |
| Transport | Socket.IO rooms and sockets | Native WebSocket and attachments |
| Room lookup | PostgreSQL | Supabase API |
| Authentication | Existing Node JWT verification | Existing Workers JWT verification |
| Scheduling | `setTimeout`, runtime-owned handles | Durable Object Alarm |
| State lifecycle | In-memory rooms | Durable Object Storage |
| Concurrency | Pending room loads and post-fetch checks | Durable Object input gate |
| Observability | Console/file logging and PostHog | Workers logging and PostHog |

DB reads remain ordinary runtime functions: there is no repository interface
because the core only needs the loaded room, not a way to fetch it.

## State and deadlines

The core handles joining, capacity checks, leaving, starting, holder-only typing
and passing, word selection, bomb stages, cancellation, and game completion.
Game end and leaving an active game reset the room and remove participating
players, matching the existing game lifecycle.

`GameState` stores `wordAt` and `bombAt` as absolute epoch milliseconds outside
the room wire payload. Start schedules the first word after three seconds. Each
bomb stage uses the configured duration plus a random zero-to-ten-second offset.
An overdue stage advances once and schedules its next stage from the supplied
current time, preserving the previous behavior instead of replaying many stages
after a delayed callback.

The Node timer adapter owns timer handles; they are not serialized game state.
Cloudflare combines game deadlines with connection-expiry deadlines into its
single Durable Object Alarm. Connection expiry remains a runtime concern.

## Existing behavior differences

The old servers differed in two rules. Node allowed an authenticated spectator to
start a game and allowed the current holder to pass during the initial countdown.
Cloudflare required the starter to be a participating player and ignored passes
during that countdown. The core makes these compatibility choices explicit through
`allowSpectatorStart` and `allowCountdownPass`; Node enables both and Cloudflare
uses the strict defaults. This refactor does not silently change either UX.

Transport-specific `ping` / `pong` / `connect` remain native-WebSocket lifecycle
events. Socket.IO continues using its own lifecycle and heartbeat.

## Future extensions

The core treats player IDs as opaque strings. To introduce `playerSessionId`,
change the runtime authentication/session mapping and pass that stable ID into
the core rather than a transport connection ID. Map effect recipients or holder
IDs back to active connections at the runtime boundary.

Sticky ownership or state handoff belongs outside the core: transfer
`GameState` (including deadlines and game generation), establish ownership,
then let the new runtime schedule its native timer from those deadlines.
Distributed ownership, transport reconnection, and cross-server synchronization
are not implemented by this change.

## Verification

From `server/`, run `npm test` and `npm run build`. The test command includes
shared pure-core unit tests as well as Node tests.

Node's build includes the shared source, so its emitted entry point is
`server/dist/server/src/index.js` (relative to the repository root), rather than
`server/dist/index.js`. `npm start` still runs `tsx src/index.ts` unchanged.
The default listener remains port 3001; `PORT=0` gives integration tests an
isolated ephemeral port.

From `cloudflare/`, run `npm test`, `npm run typecheck`, and `npm run build`
(a Wrangler dry run, not a deployment). Workers integration tests exercise actual
WebSockets, storage, hibernation, and Alarm callbacks.

No database credentials are needed for the unit tests; Workers tests mock outbound
Supabase requests. The Node integration test starts the real Socket.IO server
with PostgreSQL mocked. Shared unit tests cover game rules and a wiring guard
checks both runtimes import and call the same reducer. An end-to-end comparison
of both adapters' final state in a single scenario is not included.
Live PostgreSQL/Supabase and production deployment should be
verified separately in the deployment environment.
