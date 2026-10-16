# Ei-TypeBomb Cloudflare Worker

An independent Cloudflare Workers + Durable Objects transport for the existing
`backend/shared` game engine. The Node.js Socket.IO runtime remains unchanged.

## Architecture

- `src/index.ts`: routes `GET /ws/:roomId` upgrades to a room-specific Durable Object.
- `src/RoomDO.ts`: native WebSocket packets, verified room sessions, game events,
  durable state, deadline alarms and hibernation-aware connection attachments.
- `src/lib/auth.ts`: ES256 signature verification and shared room JWT policy.
- `src/lib/database.ts`: Supabase PostgREST room lookup using the signed room
  JWT with RLS and a publishable key; no service-role key or direct PostgreSQL credentials.
- `../shared/`: unchanged game rules, validation, snapshots, item selection and rate limits.

Each room gets its own Durable Object (SQLite-backed). The initial room document is
loaded from Supabase after successful room JWT verification. Only authenticated
sockets receive room/game broadcasts. The JWT room ID must match the WebSocket
URL. A session ID is assigned per connection, stored in its serialized WebSocket
attachment, and restored after hibernation.

For efficiency, `currentInput` broadcasts are ephemeral rather than a database
write per keystroke. Game/room changes and hint updates are persisted. Bomb and
countdown deadlines use a Durable Object Alarm, not `setTimeout`.

## Setup

From `backend/cloudflare`:

```sh
npm install
npm run typecheck
npm test
npx wrangler login
```

Set the following as Wrangler secrets:

```sh
npx wrangler secret put JWT_KEY_ID
npx wrangler secret put JWT_PUBLIC_KEY
npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
npx wrangler secret put NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Use the same ES256 verification public JWK (JSON) and key ID as the Node
backend. Set `ALLOWED_ORIGINS` as an optional comma-separated allowlist of
trusted browser origins, e.g. `https://ei-typebomb.com`. If set, other
browser origins are rejected at the upgrade boundary.

Deploy using `npm run deploy`. For local development, use `npm run dev`
with non-production secrets in `.dev.vars` (which must not be committed).

Set the secondary server URL on the frontend to
`https://<worker-host>/ws`. The existing `WorkerSocket` will translate it
to a native `wss://<worker-host>/ws/<roomId>` connection and send
`{ "event": "...", "data": ... }` packets.

Routes:
- `GET /health`: basic HTTP process health.
- `GET /ws/health`: WebSocket health session; `health:ping` / `health:pong`.
- `GET /ws/:roomId`: native WebSocket game session.

## Limitations

- This is an **independent** gameplay backend. No active-game migration,
  cross-runtime replication, stable player identity, or automatic failover
  is implemented here. Switching servers resets Socket.IO-scoped identities.
- Durable Object alarms guarantee wake-up, not an exact millisecond firing
  time. The shared core uses epoch deadlines, so late alarms apply current
  elapsed time rather than restarting timers.
- Current health endpoint checks transport RTT, not database readiness.
- Server-side game rules are currently the same as Node's: typed answers are
  validated by the client, and the server handles `word:success` events.
- `npm run typecheck` and `npm test` require dependencies to be installed;
  deployment also requires an authorized Cloudflare account and valid secrets.
