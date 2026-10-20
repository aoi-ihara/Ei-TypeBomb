# Server lifecycle changes

Read `docs/architecture/server-lifecycle.md` and `backend/DISTRIBUTED.md`
before changing room routing, connection cleanup, replication or ownership.

- Mac mini and Render run the same Node implementation. Keep rules in
  `backend/shared/game.ts`, session/deletion policy in `shared/session.ts`, and
  version ordering in `shared/distributed/version.ts`. Keep platform timers,
  WebSockets, SQLite and Durable Object storage inside their adapters.
- `sessionId` from a verified, room-bound JWT identifies a tab. Socket IDs
  identify replaceable transports. Fence delayed close/beacon events by
  connection ID inside the serialized mutation.
- Explicit room leave is immediate. Transport loss during a match retains the
  existing 20-second reconnect grace. Duplicate close/error callbacks cannot
  renew the deadline. Lobby disconnect is immediate. Connected spectators
  retain an empty room; remove it only after all sessions/reservations end.
- An eliminated player's immutable game seat is a game-rule exception, not a
  connected session. Do not change holder indices or cancel a surviving match
  when that eliminated player disconnects; game completion clears the seats.
- ACK exit only after a successful authoritative change. A halted runtime
  cannot claim successful exit. Do not acknowledge a failed commit.
- Instance/epoch/revision fences and deletion tombstones must survive recovery.
  A new incarnation needs a greater epoch. Never reconstruct a missing live
  match from database room settings or delete persistent votes to pass tests.
- The current availability-first protocol allows solo commits and split-brain
  during partitions. Do not claim strict single-owner/zero-loss guarantees.
  Peer declarations are public configuration checks, not authentication.

For shared/backend changes run both backend typechecks and test suites, the
Node build, Worker dry-run bundle, and the real Socket.IO/workerd integration
suite. Run `ETB_RACE_REPEATS=20 npm run test:race --prefix backend/server` for
ordering changes. Keep failing assertions; record execution gaps explicitly.
Frontend shared imports also require the Next build and relevant lint checks.
Local fixtures are not evidence of successful production failover.
