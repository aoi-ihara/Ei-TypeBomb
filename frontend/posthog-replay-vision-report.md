# PostHog Replay Vision — Setup Report

## Session Recording

Session replay was already enabled on your PostHog project. The client init in `app/providers.tsx` has `disable_session_recording: false`, so recordings flow automatically for every user who visits the app. No code changes were needed.

---

## Scanners

Three AI scanners are now live in your PostHog project, watching incoming recordings automatically.

### 1. Game entry failures (broken-experiences)

| Field | Value |
|---|---|
| Scanner ID | `01a05c44-766b-7aa6-91ad-901c766adbb4` |
| Type | Monitor (broken experiences) |
| Scope | Sessions that visited both `/display-name` and `/game` — the full entry funnel |
| Sampling rate | 0.5 |
| Est. monthly spend | **355 credits / month** |

**Watches for:** invite link rejected as "Room not found" after a valid link is pasted; the Continue button on the display-name screen stuck loading; the game board showing "Connecting to server…" indefinitely; the typing input not accepting keystrokes on a player's turn; the Start Game button appearing disabled when two or more players have already joined.

---

### 2. TypeBomb rage clicks (user frustration)

| Field | Value |
|---|---|
| Scanner ID | `01a05c43-cb6b-7b73-9e2f-45eb131e7cad` |
| Type | Monitor (rage clicks / frustration) |
| Scope | Sessions containing a `$rageclick` event |
| Sampling rate | 1.0 |
| Est. monthly spend | **255 credits / month** |

**Watches for:** hammering Start Game with only one player present; clicking Continue with an invalid invite link; retrying a wrong room password; tapping Join on a full room; clicking Play Again before the result overlay dismisses.

---

### 3. TypeBomb session summaries

| Field | Value |
|---|---|
| Scanner ID | `01a05c44-16fe-7895-8fe9-1300f3a071ec` |
| Type | Summarizer |
| Scope | All recordings (unscoped) |
| Sampling rate | 0.1 |
| Est. monthly spend | **150 credits / month** (~30 observations/month) |

**Produces:** plain-language summaries of individual sessions using your product's vocabulary — rooms, bomb, words, turns, invite links, display names, winning/losing, spectating, and playing again.

---

## Credit Budget

| Scanner | Credits/month |
|---|---|
| Game entry failures | 355 |
| TypeBomb rage clicks | 255 |
| TypeBomb session summaries | 150 |
| **Total** | **760 of 2,500 (~30%)** |

---

## Nothing Skipped

All three scanner types were created successfully. No scanner was deferred or skipped.

---

## Where to Look

Results appear on the [Replay Vision page](https://us.posthog.com/project/529828/replay-vision) in PostHog. The first scanner observations arrive as new recordings complete — typically within hours of real users visiting the app.
