# Vercel ISR for recommended and latest feeds

## Goal

Guest-facing ETB landing pages should not wait for a session lookup, Redis,
or Supabase on a successful Vercel ISR cache hit.

`/` (recommended) and `/latest` are forced-static **only for requests without Supabase Auth cookies**. The proxy rewrites requests bearing those cookies to dynamic `/viewer-feed-internal` routes that render their personalized data on the server and refresh their Supabase session. Cookie presence is only a routing hint, never an authorization check. The guest URLs are Node.js App Router
pages with `revalidate = 3600`. Both use the existing public room feed
`getPublicRooms({ failOnError: true })`; on a miss, the path remains
Upstash Redis → Supabase RPC. A failed database fetch throws rather than
caching an empty public feed for an hour. Next.js retains a previous good
ISR artifact if regeneration fails.

## Viewer-specific controls

The shared HTML/RSC data contains **only public room summaries** and no
authenticated viewer state. `RoomList` initializes in a neutral loading
state, then requests `GET /api/room-list-viewer` with credentials and
`cache: "no-store"`. Its response is `Cache-Control: private, no-store`
on **all** paths, including guest and error responses.

The viewer endpoint calls `getUserDetails()` to verify the user, then
reads **only** owned room IDs and saved room IDs (in parallel). Failure to
read either set returns HTTP 503, never a guest impersonation or partial
ownership state. On the client, a save control is rendered only when
`currentUser` is present; edit appears only for an owned room ID, and
the edit Server Action continues to independently check authorization.
Before the response arrives, these controls are hidden; a fixed header
placeholder avoids large visual shifts. Room creation is disabled until
viewer state has been checked.

For other pages such as `/mine` and `/saved`, existing dynamic
server-rendered authentication continues unchanged.

`proxy.ts` skips session refresh **only** on exactly `/` and
`/latest`; the viewer API and all privileged pages still go through
session refresh. Legacy query redirects on the home page are handled
before ISR by `next.config.ts` query-aware redirects.

## Invalidation and boundaries

The existing `revalidateRoomLists()` invalidates both `/` and
`/latest` after normal room changes. This is separate from the
existing Redis generations. Public feed statistics may be delayed up to
an hour. Direct manual Supabase changes bypassing ETB's mutation paths
also bypass active invalidation; use a cache purge or wait for TTL.

An ISR cache hit avoids Redis/Supabase for **public feed HTML**, not for
the subsequent authenticated viewer API. The viewer API intentionally
does not share CDN/ISR data and must not be placed inside the static
render tree.

Note: static generation may fetch the feed during `next build`, so
production/preview build environments need the same valid Supabase
connection as runtime. A failed Supabase fetch should fail generation
rather than caching the misleading "no rooms" state.

## Verification

Run from `frontend`:

- `npm run test:room-list`
- `npm run build`

In a Vercel Preview, inspect both anonymous and signed-in navigations:

1. `/` and `/latest` contain no personal data in View Source.
2. The browser downloads public HTML without awaiting the viewer endpoint.
3. Guest cards show no save/edit, signed-in cards show save, owners show
   edit, and non-owners do not.
4. The viewer endpoint response has `Cache-Control: private, no-store`
   and is never a CDN HIT.
5. Warm feed requests have Vercel's `x-vercel-cache: HIT` header.
   The first request can be MISS/STALE, and preview cache behavior can
   differ from production.
6. Create/edit/delete a public room, then verify both pages refresh;
   change visibility to private and verify no cached room page grants
   access to restricted content.
7. Check legacy `/?filter=mine`, `/?owner=me`, `/?filter=saved`
   links.
