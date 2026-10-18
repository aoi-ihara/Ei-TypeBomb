# Shared backend core

`backend/shared/` contains runtime-independent TypeScript for the current
Node server and the Cloudflare Worker adapter. The runtime-specific code lives in
`backend/cloudflare/`.

## Shared code

- `types.ts`: serializable rooms, users, bombs and game state
- `game.ts`: pure `applyGameEvent` transitions and absolute game deadlines
- `protocol.ts`: client/server event contracts and safe public room snapshots
- `validation.ts`: payload checks, auth responses, recommendations and hints
- `room.ts`: database column projection and common `roomFromRow` mapping
- `rateLimits.ts`: protocol event budgets
- `keyedRateLimit.ts`: runtime-neutral per-key token bucket and bounded storage
- `addressRateLimit.ts`: per-address limiter policy (1,000 keys, 60s stale TTL)
- `roomJwt.ts`: validated room identity claims _after_ JWT signature verification

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

**Cloudflare Worker**: `backend/cloudflare/src/RoomDO.ts` uses native
WebSockets, PostgREST, ES256 JWT verification, Durable Object storage and
Alarm scheduling. It imports the shared core without bringing in
`node:perf_hooks`, Socket.IO, Express, PostgreSQL or process globals.

The game state stores absolute epoch-millisecond deadlines; transfers
between runtimes must preserve `gameId`, revisions and deadlines. Stable
player identity, ownership fencing, event deduplication and actual cross-server
failover are **not implemented**.

## Verification

- `npm test --prefix backend/server`: existing game/core/Socket.IO tests and
  shared utility tests
- `npm run typecheck --prefix backend/server`: Node and shared type checking
- `npm run build --prefix backend/server`: compiles Node plus shared sources
- `backend/shared/tsconfig.json`: dependency-free shared editor configuration

The Cloudflare build bundles shared imports directly from `backend/shared/`.
Run `npm install` and then `npm run typecheck && npm test` from
`backend/cloudflare/` to check the Cloudflare adapter.

## Reconnection foundation (phase 1)

Vercel signs a new, room-bound `client_session` JWT for each page instance.
Node and Worker verify it with the existing ES256 public key before using the
`sessionId` as the player ID. Transport socket IDs are disposable. A signed
session JWT is kept only in the page's memory; a reload creates a new player.

Network disconnects now get a 20s reconnection grace period before the room
processes `room:leave`. Deliberate `room:leave` remains immediate. This is
**same-server reconnection only**, not cross-server failover. Replication,
ownership epochs/fencing, server discovery and seamless transfer still require
a subsequent change. Do not route an active room to a different server yet.
