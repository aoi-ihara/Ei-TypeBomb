# Guest ISR and authenticated SSR for public room feeds

## Goal

Render the correct account controls **on the first paint** for signed-in
visitors, without sacrificing guest-facing CDN speed or exposing private
viewer state through a shared cache.

## Anonymous feed: ISR

`/` (recommended) and `/latest` remain `dynamic = "force-static"`
with `revalidate = 3600`. Both pages render with `currentUser = null`
and use only `getPublicRooms({ failOnError: true })`.

A warm ISR response needs neither Redis nor Supabase. A regeneration miss
uses Upstash Redis → Supabase RPC and fails rather than caching a false
"no rooms" result on a temporary Supabase outage.

**No client-side auth lookup** runs on guest feeds. There are no placeholder
buttons or delayed account controls to cause layout shifts.

## Authenticated feed: server-rendered

When the original request for `/` or `/latest` contains a Supabase SSR
session cookie (`sb-*-auth-token`, including chunked variants),
`proxy.ts` internally rewrites GET/HEAD and Server Action POST requests while retaining the
browser-visible URL:

| Browser URL | Internal SSR route |
|---|---|
| `/` | `/feed-session` |
| `/latest` | `/feed-session/latest` |

Both internal pages use `dynamic = "force-dynamic"` and
`getRoomListData(view)`. This calls `getUserDetails()` to verify the
user server-side and reads their owned room IDs and saved room IDs.
A cookie is **only a routing hint, not proof of authentication**. Expired
or invalid sessions still receive a guest view. The personalized response
must not enter the shared ISR/CDN cache.

`getPublicRooms()` continues to use the same Redis cache. There is no
need for a duplicate public-room cache implementation.

The existing Supabase `getClaims()` refresh in `proxy.ts` still runs on
requests with session cookies and other non-feed requests. Refresh-set
cookies are forwarded on the rewrite response. Server Action POSTs use the **same** rewrite target so revalidation renders
stay authenticated; query-aware legacy redirects remain in `next.config.ts`.

Direct requests to the internal SSR routes cannot bypass authentication:
they also invoke `getRoomListData`, which checks the active user.
The routes are marked `robots: noindex`.

## UI and compatibility

`RoomList` now receives the correct user state from its server-rendered
route. It never initially renders guest controls and then upgrades them
to account controls. The post-hydration viewer provider and placeholders
are removed. The actual Header, Shell, Button and navigation appearance
are unchanged.

The old `GET /api/room-list-viewer` endpoint remains present for
compatibility, with `Cache-Control: private, no-store`, but the feeds no
longer request it. `/mine` and `/saved` still use authenticated SSR.

Editing and room creation continue to perform their existing server-side
authorization checks. A visible edit/save button is not an authorization
mechanism.

## Invalidation

`revalidateRoomLists()` still invalidates the public `/` and
`/latest` ISR paths, independently of Redis generation invalidation.
Mutations and direct Supabase edits have the same freshness boundaries as
before this change.

## Verification

From `frontend`:

- `npm run test:room-list` — routing, auth presentation and feed tests
- `npx tsc --noEmit`
- `npm run build`

In a Preview or production smoke test:

1. Visit `/` and `/latest` in a fresh private window: both should
   render immediately as guest ISR without a `room-list-viewer` request.
2. Sign in and visit the same URLs: the **first response** should render
   the user menu, saved flags and owner edit permissions with no flicker.
3. Confirm that signed-in HTML is not shared or delivered with
   `x-vercel-cache: HIT`; guest warm feed can be an ISR HIT.
4. Refresh and expire a session cookie: server auth verification must
   prevent any leaked personal room data.
5. Save/unsave a room, sign out, and navigate between all four list
   views; their user-specific controls should stay correct.
6. Validate legacy `/?filter=mine`, `/?owner=me`,
   `/?filter=saved` redirects and ensure no Server Actions break.
