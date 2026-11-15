# Upstash public-room list cache

The public room feed used to cache the Supabase `get_ei_typebomb_public_rooms`
RPC result only in the Vercel process's memory. Separate functions/instances
missed each other's cache and local invalidation did not propagate.

## Deployment

Set these **server-side** Vercel environment variables (do not use
`NEXT_PUBLIC_`, commit tokens, or expose them to a browser):

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN` (read/write: GET, SET, INCR)
- Optional `UPSTASH_CACHE_NAMESPACE` when multiple deployments share a
  Supabase database. **All writers and readers for the same Supabase database
  must use the same namespace** to share invalidations.
- Optional `ROOM_CACHE_LOGS=1` to log cache hit/miss state, cache read time,
  Supabase RPC time and result count in server logs, without room contents.

By default the cache separates `production`, preview branches and local
`development` deployments. This is convenient only when they use separate
Supabase databases. If they share one database, configure
`UPSTASH_CACHE_NAMESPACE` identically across those deployments.

The Redis database should be in the same region as the Next.js server
functions (Tokyo for the current ETB Vercel deployment).

## Scope / security

Only the shared **public room list** (used by recommended/latest and the
public portion of saved/search views) is cached. Its summaries never contain
question/answer items, room passwords, private/unlisted room contents or
owner-specific lists. Full room pages, editable rooms, user-owned rooms and
saved-room IDs continue to be read from Supabase with their existing
authorization checks. In particular, **do not cache the combined
`getRoomPageDataFromLink` result**, which includes private content and
viewer-specific authorization state.

- Redis stores one list per cache generation, with a 120-second TTL.
- Successful website create/update/delete and MCP create/update operations
  increment the Redis generation. In-flight reads writing to an earlier
  generation cannot overwrite the currently active list.
- Public recommendation stats can change through plays and saves. Their
  freshness is bounded by this same TTL, as with the previous 2-minute cache.
- If Redis is absent or times out (1 second), the read falls back to the
  existing Supabase RPC. Redis errors never block room changes.
- A failed invalidation can leave the **public summaries** stale until TTL
  expiry. This is why full room items and private data are excluded.
- The process-local optimization is now only in-flight request deduplication,
  not a second long-lived cache that other Vercel instances cannot invalidate.

## Verify

Run `cd frontend && npm run test:room-cache` to exercise hit/miss, isolated
namespaces, late writer fencing, malformed/private entries, and Redis failures.

After deployment, enable `ROOM_CACHE_LOGS=1` temporarily and compare:
- `status=miss`, `db_ms` and total request time on a cold navigation;
- `status=hit`, `cache_ms` and total request time on the same warm view;
- Upstash command counts and bandwidth; Supabase RPC counts.

Then turn debug logs off. The cache is an acceleration layer, not the source of
truth. Never rely on it to authorize access or to synchronously enforce a
privacy change to full room content.
