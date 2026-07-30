# PostHog post-wizard report

The wizard has completed a deep integration of the Ei-TypeBomb Next.js App Router project. The previous integration (PR #66) already provided a solid foundation: client-side initialization via `instrumentation-client.ts`, a reverse proxy via `next.config.ts`, a `lib/posthog-server.ts` helper for server actions, user identification on home page load, and 15 instrumented events. This run added 4 new events covering settings toggles, room visibility changes, room code copying, and server-side room updates.

| Event name | Description | File |
|---|---|---|
| `game_lost` | Player's bomb exploded, ending the game round | `app/(game)/game/Client.tsx` |
| `game_won` | Player survived as a winner | `app/(game)/game/Client.tsx` |
| `room_join_clicked` | Player clicked the Join button in a game room | `app/(game)/game/Client.tsx` |
| `room_watch_clicked` | Player chose spectator mode | `app/(game)/game/Client.tsx` |
| `game_started` | Host started a game | `app/(game)/game/Client.tsx` |
| `game_left` | Player left the game room | `app/(game)/game/Client.tsx` |
| `word_succeeded` | Player typed the correct word during their turn | `app/(game)/game/Client.tsx` |
| `signed_out` | User signed out | `app/(game)/Home.tsx` |
| `play_clicked` | User clicked the Play button on the home page | `app/(game)/Home.tsx` |
| `display_name_set` | Player set their display name before joining | `app/(game)/display-name/page.tsx` |
| `sign_in_submitted` | User submitted the sign-in form | `app/(editor)/sign-in/page.tsx` |
| `sign_in_failed` | Sign-in returned an error | `app/(editor)/sign-in/page.tsx` |
| `room_entered` | Player authenticated into a game room | `app/(game)/room/page.tsx` |
| `room_created` | Server: user created a new room | `lib/room/create.ts` |
| `room_deleted` | Server: user deleted a room | `lib/room/delete.ts` |
| `settings_changed` | User toggled background music or sound effects | `app/(game)/settings/Settings.tsx` |
| `room_visibility_changed` | User changed room visibility (public/private) | `app/(editor)/my-rooms/[slug]/visibility/page.tsx` |
| `room_code_copied` | User copied the room code in the room editor | `app/(editor)/my-rooms/[slug]/page.tsx` |
| `room_updated` | Server: room settings or words were saved | `lib/room/update.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard**: [Analytics basics (wizard)](https://us.posthog.com/project/529828/dashboard/1909901)
- **Game play funnel**: [hTQvheBa](https://us.posthog.com/project/529828/insights/hTQvheBa) — `play_clicked` → `room_entered` → `room_join_clicked` → `game_started`
- **Game outcomes over time**: [CmGzVOTO](https://us.posthog.com/project/529828/insights/CmGzVOTO) — `game_won` vs `game_lost` daily trends
- **Room lifecycle events**: [aP7KuHKs](https://us.posthog.com/project/529828/insights/aP7KuHKs) — `room_created`, `room_updated`, `room_deleted` daily counts
- **Sign-in success vs failure**: [nbTTi6OC](https://us.posthog.com/project/529828/insights/nbTTi6OC) — `sign_in_submitted` vs `sign_in_failed` trends
- **Daily active players**: [t8diiapP](https://us.posthog.com/project/529828/insights/t8diiapP) — unique users starting games per day

## Verify before merging

- [ ] Run a full production build (`npm run build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` to `.env.example` and any CI/deployment scripts so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify.
- [ ] Confirm the returning-visitor path also calls `identify` — currently `posthog.identify(userId)` runs in a `useEffect` in `Home.tsx` on every render; verify it fires on page refresh when a session is already active.
- [ ] **Data warehouse**: This project uses Supabase. Run `npx @posthog/wizard warehouse` to connect Supabase as a PostHog data warehouse source and unlock SQL queries over your game and room data alongside PostHog events.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
