# PostHog post-wizard report

The wizard integration remains the foundation for the Ei-TypeBomb Next.js App Router project. The current instrumentation includes client-side initialization via `instrumentation-client.ts`, the PostHog reverse proxy, the server-side `lib/posthog-server.ts` helper, and custom product events across gameplay, rooms, authentication, and the room editor.

The room editor was substantially consolidated and expanded after the original PostHog setup. This update aligns analytics with the current single-page editor flow, removes a false-positive word deletion path, and adds coverage for the newer generation, import, export, and editor-entry interactions.

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
| `room_editor_opened` | User opened a specific room editor | `components/analytics/PostHogEventTracker.tsx` |
| `room_visibility_settings_opened` | User opened the room visibility settings from the editor | `components/analytics/PostHogEventTracker.tsx` |
| `room_visibility_changed` | User successfully changed room visibility (public/private) | `app/(editor)/my-rooms/[slug]/page.tsx` |
| `room_qr_opened` | User opened the room QR code view | `components/analytics/PostHogEventTracker.tsx` |
| `room_code_copied` | User copied the room invite link in the room editor | `app/(editor)/my-rooms/[slug]/page.tsx` |
| `room_updated` | Server: room settings or words were saved | `lib/room/update.ts` |
| `word_added` | User manually added a word in the editor | `app/(editor)/my-rooms/[slug]/page.tsx` |
| `word_deleted` | User deleted an individual word in the editor | `components/analytics/PostHogEventTracker.tsx` |
| `words_reordered` | User reordered words with drag and drop | `components/analytics/PostHogEventTracker.tsx` |
| `words_exported` | User copied the room's word list as JSON | `components/analytics/PostHogEventTracker.tsx` |
| `words_import_opened` | User opened the JSON import controls | `components/analytics/PostHogEventTracker.tsx` |
| `words_import_help_opened` | User opened the JSON import format help | `components/analytics/PostHogEventTracker.tsx` |
| `words_import_submitted` | User submitted JSON import from the editor | `components/analytics/PostHogEventTracker.tsx` |
| `words_import_succeeded` | JSON import was accepted and the editor closed the import controls | `components/analytics/PostHogEventTracker.tsx` |
| `words_import_failed` | JSON import validation failed | `components/analytics/PostHogEventTracker.tsx` |
| `words_import_cancelled` | User cancelled the JSON import controls | `components/analytics/PostHogEventTracker.tsx` |
| `words_imported_and_added` | Existing import handler event kept for dashboard compatibility | `app/(editor)/my-rooms/[slug]/page.tsx` |
| `word_generation_opened` | User opened the AI word generation controls | `components/analytics/PostHogEventTracker.tsx` |
| `word_generation_example_selected` | User selected a suggested generation theme | `components/analytics/PostHogEventTracker.tsx` |
| `word_generation_requested` | User submitted an AI word generation request | `components/analytics/PostHogEventTracker.tsx` |
| `word_generation_succeeded` | AI generation returned a result set | `components/analytics/PostHogEventTracker.tsx` |
| `word_generation_failed` | AI generation returned an error | `components/analytics/PostHogEventTracker.tsx` |
| `generated_words_added` | User added generated words to the room | `components/analytics/PostHogEventTracker.tsx` |
| `word_generation_cancelled` | User cancelled the generation controls | `components/analytics/PostHogEventTracker.tsx` |

## Room editor analytics notes

The room editor is now a single consolidated page. The analytics implementation therefore tracks the current editor controls directly rather than depending on the old split-page structure.

The previous generic trash-icon matcher could classify the room-level `Delete Room` action as `word_deleted`. The matcher now explicitly excludes that room-level action and attaches `room_id` to word deletion events.

The newer generation UI is tracked as a small funnel: `word_generation_opened` → optional `word_generation_example_selected` → `word_generation_requested` → `word_generation_succeeded` / `word_generation_failed` → `generated_words_added`.

JSON import is tracked separately for opening, help, submission, success, failure, and cancellation. The existing `words_imported_and_added` event remains at the current import handler for dashboard compatibility, while the new success/failure events reflect the actual UI outcome.

## Verify before merging

- [ ] Run a full production build (`npm run build`) and fix any lint or type errors introduced by analytics changes.
- [ ] Run the lint command (`npm run lint`).
- [ ] Manually exercise the room editor and confirm no event is duplicated for the same action.
- [ ] Confirm `Delete Room` does not produce `word_deleted`.
- [ ] Confirm generation emits requested + succeeded/failed, and adding generated words emits `generated_words_added`.
- [ ] Confirm JSON import emits submitted + succeeded/failed for the corresponding outcomes.
- [ ] Confirm `room_updated` remains useful as a server-side save event without being treated as a direct UI action.
