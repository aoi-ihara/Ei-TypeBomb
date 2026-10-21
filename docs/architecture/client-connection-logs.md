# Browser connection diagnostics

The game UI exposes **only two connection messages**, independent of the server's
internal error text:

- **接続中…**: reconnecting, waiting for authentication or a usable snapshot
- **現在はプレイできません。時間をおいて再度お試しください。**:
  non-retryable failure or unavailable credentials

Details are logged in the **browser DevTools Console** (not displayed to
students). The logger accepts only an allowlist of public diagnostic fields;
it never prints JWTs, session tokens, room/player IDs, display names, input
content, or raw server errors. No additional server-side disk writes are added.

| Prefix | Examples | Level |
| --- | --- | --- |
| `[CONNECTION]` | Resolving authoritative server / Route lookup rejected / Socket handshake failed | `log` for normal status, `error` for failures |
| `[CONNECTED]` | Connected to primary/secondary/fallback server | `log` |
| `[AUTH]` | Sending authentication request / Authentication succeeded / Credentials unavailable | `log` or `error` |
| `[FALLBACK]` | Starting connection recovery / Requesting ownership verification / Ownership verification rejected / Connection recovered / Automatic recovery stopped | `log` or `error` |

## Diagnosing background tab recovery

Filter the Console for `[FALLBACK]` and inspect the structured object next to
each message. `recoveryId` identifies the interruption. `previousOwner`,
`server`, `httpStatus`, `code`, `revision`, `durationMs`, and
`heartbeatAgeMs` help distinguish a suspended browser tab from a missing
checkpoint. Check the adjacent `[CONNECTION]` lines for routing failures.

- **HTTP 200, same owner**: the server reports that the current owner remains
  authoritative. This is **not** an election refusal error.
- **HTTP 409 and `CHECKPOINT_UNAVAILABLE`**: the receiving server could not
  read the requested room checkpoint. The client stops if there is no
  recoverable authoritative route.
- **HTTP 503, `OWNER_TRANSFER_NOT_APPROVED`**: the current owner
  explicitly declined a transfer. This is retryable; no takeover is permitted.
- **Other HTTP 503 / transport error**: the ownership check could not be
  completed. Look at owner/peer server logs for the underlying reason.
- **`heartbeat_timeout`** after returning to a background tab: the client
  timed out; it does **not** by itself establish a server crash.

The logging change does not modify the existing quorum, election, rejoin grace
period, or checkpoint safety rules. If a user copies console logs into a bug
report, confirm they have not manually added secrets from the Network panel.
