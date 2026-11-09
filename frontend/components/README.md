# Component ownership

The `frontend/components` directory is organized by responsibility.

| Directory | Responsibility |
| --- | --- |
| `ui/` | Reusable controls without knowledge of ETB rooms, game rules, or learning models |
| `layout/` | Shared page shells, header/footer, and navigation progress |
| `account/` | Sign-in, sign-up, and account details |
| `rooms/` | Room cards and room navigation |
| `game/` | Game presentation, players, bombs, reconnection, and real-time overlays |
| `recall/` | Answer input, typed recall, and kana composition shared by online play and Playground |
| `settings/` | Game and offline voice settings |
| `docs/` | Documentation presentation |
| `analytics/` | Analytics integration |

## Dependencies

- `app/` orchestrates pages and can import feature and shared components.
- Feature components (`game`, `rooms`, `recall`, etc.) may use `ui/` and `layout/`.
- `ui/` must not import feature components or implement game-specific behavior.
- Components used by only one route should remain in that route's `_components/` directory until they need reuse.
- Keep algorithms, persistence, and networking in `lib/` (or React-specific hooks), not in reusable controls.

This change deliberately preserves the internal behavior of `TypingView` and `EditorClient`. Extracting their hooks and smaller components should be done separately, with dedicated tests.
