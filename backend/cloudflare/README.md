# Ei-TypeBomb Cloudflare Worker

Cloudflare Workers + Durable Objects adapters for the existing `backend/shared`
game engine and authenticated peer WebSocket confirmation protocol.

## Architecture

- `src/index.ts`: routes `GET /ws/:roomId` upgrades to a room-specific Durable Object.
- `src/ClusterDO.ts`: authenticated peer connections, registry and per-room ReplicaDO vote storage.
- `src/RoomDO.ts`: native WebSocket packets, verified room sessions, game events,
  durable state, deadline alarms and hibernation-aware connection attachments.
- `src/lib/auth.ts`: ES256 signature verification and shared room JWT policy.
- `src/lib/database.ts`: Supabase PostgREST room lookup using the signed room
  JWT with RLS and a publishable key; no service-role key or direct PostgreSQL credentials.
- `../shared/`: unchanged game rules, validation, snapshots, item selection and rate limits.

Each room gets its own Durable Object (SQLite-backed). In standalone mode the initial room document is
loaded from Supabase after successful room JWT verification. Distributed recovery
never reloads it; only the primary creating a fresh instance may load settings. Only authenticated
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


## Cloudflare Worker Previews

Cloudflare Workers Builds uses `npx wrangler preview` for preview branches.
Preview deployments require a `previews` block in `wrangler.jsonc`; settings
in production are **not automatically inherited**.

The configuration includes a separate `ROOMS` binding in the `previews`
block. Cloudflare creates a separate Durable Object namespace and storage
for each Preview while keeping the `RoomDO` class migration at the top level.

The preview variables are **public configuration values** used by the Worker,
including the JWT **public** verification key and the Supabase publishable
key. Do not add a JWT private signing key, Supabase service-role key, or other
secret to `previews.vars` or to version control. If the JWT signing key
rotates, update the Preview public JWK and its key ID at the same time.

```sh
cd backend/cloudflare
npx wrangler preview
```

**Important:** The Preview's Durable Object storage is isolated, but the
preview Supabase endpoint is currently the shared rcAccount production project.
A Preview can still read or write data through the application's normal
Supabase permissions. Avoid destructive test data and restrict public Preview
URLs (for example with Cloudflare Access) before using real accounts.
The CORS allowlist accepts both the legacy subdomain and `ei-typebomb.com`.
Production bindings and dashboard-managed production secrets are unchanged.

## Limitations

- Standalone deployments remain independent. Configured distributed deployments
  share stable tab identities and fenced durable checkpoints with Node.
  [Distributed setup and limitations](../DISTRIBUTED.md) describe the required migration/secrets.
- Durable Object alarms guarantee wake-up, not an exact millisecond firing
  time. The shared core uses epoch deadlines, so late alarms apply current
  elapsed time rather than restarting timers.
- Current health endpoint checks transport RTT, not database readiness.
- Server-side game rules are currently the same as Node's: typed answers are
  validated by the client, and the server handles `word:success` events.
- `npm run typecheck` and `npm test` require dependencies to be installed;
  deployment also requires an authorized Cloudflare account and valid secrets.

## Reconnection

Clients can resume their tab-specific, signed player identity on the **same**
Durable Object during a 20s disconnect grace period. Pending leaves are
persisted and scheduled using Durable Object alarms. In distributed mode,
the shared runtime migrates games from Node using the signed local checkpoints and best-effort voting replicas;
replicas never advance a game before acquiring its fenced ownership.

Workers also understands the optional topology variables
`PRIMARY_SERVER_URL`, `PARENT_SERVER_URL`, `SERVER_PUBLIC_URL`
plus the server-specific `CLUSTER_SERVER_TOKEN`. See [distributed setup](../DISTRIBUTED.md).
