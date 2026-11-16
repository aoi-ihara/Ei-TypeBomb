# Upstash cache for public feeds and shared room content

ETB uses Upstash Redis to avoid repeated Supabase reads across Vercel instances.
Redis is optional: normal room-page and feed reads fall back to Supabase. Cache reads use one atomic Upstash EVAL request to fetch both generation and payload. On a miss, Next.js `after()` populates Redis after the response instead of blocking it; generation-based invalidation still prevents stale in-flight writes from becoming active.

## Configuration

Set server-only environment variables in Vercel:

- UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (GET, SET).
- PUBLIC_ROOM_CACHE_TTL_SECONDS: optional, default **3600** (60–86400).
- ROOM_DATA_CACHE_TTL_SECONDS: optional, default **86400** (60–86400).
- UPSTASH_CACHE_NAMESPACE: optional for deployments sharing one database.
  **Every writer and reader of one Supabase database must use the same
  namespace**, or a mutation in one deployment cannot invalidate another.
- ROOM_CACHE_LOGS=1: optional public-feed hit/miss timing logs.

Keep Redis near the Next.js server functions (Tokyo in ETB's setup).
Never expose credentials through NEXT_PUBLIC_ variables.

## Public room list

Recommended/latest/public saved listings share a generation-fenced Redis entry.
Cached list summaries exclude items, passwords, private and unlisted rooms.
Create/update/delete via website and MCP create/update invalidate the list.
Recommendation statistics from plays/saves can remain stale for up to one hour.

## Individual room pages

The shared part of getRoomPageDataFromLink is cached **by requested link**.
It includes a public or unlisted room's content (questions/answers) and display
fields. The cache is server-only, contains **no passwords**, and never stores
a private room or a per-viewer authorization decision.

The viewer's identity, room ownership, and password authorization are
computed on each request **outside** this cache. Editing routes
(getRoomForEditFromLink and getRoomFromId) always fetch the authoritative
record from Supabase with owner checks and edit_version. Server-side room
join/password validation continues to read Supabase directly. Socket.IO
communication and live gameplay state are unchanged.

A successful website or MCP edit invalidates the room ID, previous link and
new link. Deletion invalidates the room ID and deleted link. Generations fence
late in-flight cache writes; the cache entry's TTL is a backup expiry.

### Visibility and deletion security

Full question content requires stronger invalidation than public feed
summaries. Before an existing public/unlisted room is switched to **private**
or deleted, its cache generation is set to a special **blocked** value.
Readers seeing the block bypass Redis and read Supabase directly; they cannot
populate Redis while the block remains. After the database write succeeds,
invalidation replaces that block with a fresh unique generation.

**If Redis is configured but the pre-mutation block fails, the privacy
restriction/deletion fails rather than risking stale disclosure.**
All aliases are fenced in one atomic Redis EVAL (not one request per alias).
A lost response is rolled back by its unique token when Redis is reachable.
Otherwise, orphaned fences expire after the **maximum supported room-data
TTL (86400 seconds) plus 60 seconds**, regardless of the current configured
TTL. This protects payloads written by older deployments before the TTL was
lowered within a shared namespace. Cache writes also
check the active generation atomically and cannot populate an obsolete entry
while a block is active.

If post-mutation invalidation fails, the blocked generation remains, forcing
Supabase reads until explicit release or safe expiry. Deletion is conditional
on the edit_version read before fencing; a concurrent rename/edit aborts the
DELETE and releases only the original fences. Successful deletion invalidates
the old alias and defensively invalidates any differing returned alias.

Non-restrictive edits use best-effort invalidation and can temporarily serve
stale content if Redis invalidation fails. Edits made directly in Supabase
(bypassing ETB's mutation paths) do not invalidate Redis: operators should
invalidate the affected namespace after such edits.

## View-specific DB queries

- /mine: owned room summaries + user's saved IDs; **no public list RPC**.
- / and /latest: cached public list + minimal owned IDs for edit buttons
  and saved IDs; **no full owned room summaries**.
- /saved: public list + owned room summaries + saved IDs, so users still see
  saved private rooms they own.
- Ownership-only records are merged with public summaries to preserve titles
  and visibility.

Entering a game schedules play analytics from the authorized join Server
Action, eliminating the second client-to-server request that was awaited
before navigation.

## Validation

Run from frontend:

- npm run test:room-cache
- npm run test:room-list
- npm run test:editor
- npm run build

In staging, compare cold and warm /, /mine, /latest, /saved, and room pages,
including a room edited in another tab. Verify link renames, private visibility
transitions, deletions, editor freshness, and Redis outage behavior. Use
ROOM_CACHE_LOGS=1 temporarily and compare public-feed db_ms, cache_ms,
Supabase request counts, and Upstash REST request durations.
