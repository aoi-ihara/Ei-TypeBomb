# Shared backend core

`backend/shared/` contains runtime-independent TypeScript for the current
Node server and the planned Cloudflare Worker adapter. There is no Worker
runtime implementation in this change.

## Shared code

- `types.ts`: serializable rooms, users, bombs and game state
- `game.ts`: pure `applyGameEvent` transitions and absolute game deadlines
- `protocol.ts`: client/server event contracts and safe public room snapshots
- `validation.ts`: payload checks, auth responses, recommendations and hints
- `room.ts`: database column projection and common `roomFromRow` mapping
- `rateLimits.ts`: protocol event budgets
- `keyedRateLimit.ts`: runtime-neutral per-key token bucket and bounded storage
- `addressRateLimit.ts`: per-address limiter policy (1,000 keys, 60s stale TTL)
- `roomJwt.ts`: validated room identity claims *after* JWT signature verification

The shared limiter takes a clock supplied by its caller. The runtime chooses
whether keys represent sockets, clients, remote IPs or Durable Object sessions
and owns the lifetime of the limiter. It should never use untrusted proxy
headers to derive an address without validating their trust boundary.

`getAuthenticatedRoomId` checks `kid`, `role` and the room UUID. It **does
not** verify JWT signatures, algorithms, expiry, audience, or issuer. Each
runtime must perform cryptographic token verification first.

## Runtime boundaries

**Node**: `backend/server/src/index.ts` implements Socket.IO, in-memory
room ownership, authentication, event routing, logging and analytics.
`lib/gameAdapter.ts` owns the Node timer. `lib/get.ts` reads room data.
Socket and probe rate-limit adapters supply the clock and selected budgets.

**Future Worker**: a Worker / Durable Object adapter must implement Native
WebSocket handling, its own database client, authentication/secret loading,
DO Storage and Alarm scheduling. It can reuse these shared modules without
bringing in `node:perf_hooks`, Socket.IO, Express, PostgreSQL or process
globals.

The game state stores absolute epoch-millisecond deadlines; transfers
between runtimes must preserve `gameId`, revisions and deadlines. Stable
player identity, ownership fencing, event deduplication and actual cross-server
failover are **not implemented** by this refactor.

## Verification

- `npm test --prefix backend/server`: existing game/core/Socket.IO tests and
  shared utility tests
- `npm run typecheck --prefix backend/server`: Node and shared type checking
- `npm run build --prefix backend/server`: compiles Node plus shared sources
- `backend/shared/tsconfig.json`: dependency-free shared editor configuration

When building a Worker later, keep `shared/` adjacent to its runtime directory
and bundle the shared imports into the Worker build.
