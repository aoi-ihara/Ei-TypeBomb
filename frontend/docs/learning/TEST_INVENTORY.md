# Test case inventory (2026-11-21)

Titles are source declarations; parameterized titles expand at runtime. Existing
assertions are maintained. Mixed historical files are not relabeled as offline-only.

| File / case | Class | Decision and responsibility |
| --- | --- | --- |
| test/account-auth.test.cjs: ETB password sign-in uses Supabase Auth even without legacy OAuth | Unit/integration | Maintain existing domain guarantee |
| test/account-auth.test.cjs: invalid sign-in credentials use the same neutral message | Unit/integration | Maintain existing domain guarantee |
| test/account-auth.test.cjs: signup success has a dedicated screen with no remaining form | Unit/integration | Maintain existing domain guarantee |
| test/account-auth.test.cjs: public operations require CAPTCHA before calling Auth | Unit/integration | Maintain existing domain guarantee |
| test/account-auth.test.cjs: credential changes require a verified user | Unit/integration | Maintain existing domain guarantee |
| test/account-auth.test.cjs: invalid mode, email and password never call Auth mutations | Unit/integration | Maintain existing domain guarantee |
| test/account-auth.test.cjs: signup and recovery use trusted ETB callbacks and pass CAPTCHA to Auth | Unit/integration | Maintain existing domain guarantee |
| test/adaptive-scheduler.test.mts: due long-term review with lower predicted recall comes first | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: due short retry has priority over due reviews and new words | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: at most eight unseen words are introduced in one offline session | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: early practice chooses the weakest not-yet-due word without pausing | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: a recently shown overdue word supplies a future cooldown deadline | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: recent exposures are deprioritized when older alternatives exist | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: a held word is practiced only as last resort without clearing its hold | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: early recalled typing never resets the spaced memory anchor | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: even normal correct recalls cannot strengthen an unduly recent anchor | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: early recognition success does not move the long-term reference date | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: an actually due typing recall can strengthen memory when spaced | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: an overdue card cannot gain stability after very recent extra practice | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: overdue recognition does not gain stability from a recent exposure | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: switching modes immediately never creates a new recall memory anchor | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: mode-specific recognition history does not count as typed recall | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: a recognized word stays eligible when switching to typed recall | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: a recalled word stays eligible when switching to recognition | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: no new word is introduced when four retries are still active | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: a previously selected unfinished question remains stable | Unit/integration | Maintain learning guarantee |
| test/adaptive-scheduler.test.mts: introduced-word count survives a reload | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: the answer-mode selector only offers selection when no answer is typable | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: typing uses only the first valid kana candidate, then the original answer | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: effective answer mode follows ItemView's per-item typing fallback | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: mixed input rooms include selection-only mastery in current and 24h counts | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: typing failures preserve the previous exposure timestamp | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: choice options are unique, include the answer, and use at most four room answers | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: game start and selection share the same Space keydown detection | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: Space keydowns require a release even after delayed repeat-flag-free events | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: double-Space hint works when an answer button has focus | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: manual selection reveal disables only distractors, even in a small room | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: unknown selection is recorded once and receives more review priority than a miss | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: unsupported and long answers can be saved and empty answers cannot | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: choice clock skips paused and background time while preserving active response time | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: selection speed has a bounded, stronger bias and ignores idle responses | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: clean choice recall grows recognition stability with spaced practice | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: wrong and revealed selections reduce stability without crediting a recall | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: selection mastery bar counts recognition instead of free recall | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: selection scheduler prioritizes decayed recognition even at equal accuracy and speed | Unit/integration | Maintain learning guarantee |
| test/answer-mode.test.mts: legacy recognition history without stability remains readable | Unit/integration | Maintain learning guarantee |
| test/automatic-hint-evidence.test.cjs: no hint produces an unaided observation through the real completion callback | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: automatic display alone is not reliance; only subsequent correct hinted commits count | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: a full overlay after an independently typed prefix is partial reliance | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: heavy assistance still requests a short retry at the shared 40% threshold | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: full reliance retains insufficient evidence and a short retry, ignoring layout spaces | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: timed clearing preserves correct recall credit; later hinted mistakes are ignored | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: successive hints count used exposures once and never count an already recalled prefix | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: generated readings determine the hint and completion lengths | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: kana multi-cell commits and out-of-order correct cells retain independent credit | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: initial duplicate-prompt cues count when used, not as extra timed hints | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: new attempts start with fresh assistance evidence | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: online recording uses the shared evaluation and logs normalized reliance | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: offline manual full reveal remains a full hint even after a correct prefix | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: unfinished turns retain the latest hint summary once without changing learning state | Unit/integration | Maintain existing domain guarantee |
| test/automatic-hint-evidence.test.cjs: success, repeated progress and the next game do not create duplicate unfinished summaries | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: production never asks PostHog and permits all visitors | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: beta access requires a verified user and an enabled flag on that user ID | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: only sign-in, signup, recovery and OAuth bootstrap endpoints bypass the beta gate | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: beta pages are rewritten to the access error, never redirected | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: beta API denies guest with 401 and unapproved user with 403 | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: authorized beta user proceeds to the existing personalized feed rewrite | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: auth and MCP protocol requests bypass browser-cookie restrictions | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: normal production guest feed keeps its no-Supabase fast path | Unit/integration | Maintain existing domain guarantee |
| test/beta-access.test.cjs: route groups preserve URLs and MCP resource protection follows OAuth verification | Unit/integration | Maintain existing domain guarantee |
| test/bot-typing.test.mjs: bot types roma-ji first and only shows ちゃ after tya completes | Unit/integration | Maintain existing domain guarantee |
| test/bot-typing.test.mjs: bot uses one roman keystroke per frame for ordinary kana | Unit/integration | Maintain existing domain guarantee |
| test/bot-typing.test.mjs: bot handles ん followed by な-row without duplicated n frames | Unit/integration | Maintain existing domain guarantee |
| test/bot-typing.test.mjs: small tsu and digraphs are typed by the shared romanization | Unit/integration | Maintain existing domain guarantee |
| test/bot-typing.test.mjs: English and numbers keep the existing one-character timing | Unit/integration | Maintain existing domain guarantee |
| test/bot-typing.test.mjs: kana, spaces, Latin, and punctuation can mix in the same answer | Unit/integration | Maintain existing domain guarantee |
| test/bot-typing.test.mjs: remote read-only view decodes unfinished roman keys into the active syllable | Unit/integration | Maintain existing domain guarantee |
| test/bot-typing.test.mjs: unsupported kana cannot trap a Playground CPU turn | Unit/integration | Maintain existing domain guarantee |
| test/browser/learning-diagnostics.spec.ts: beta copy matches rendered forecast and excludes question content | Browser integration | Maintain existing domain guarantee |
| test/browser/learning-diagnostics.spec.ts: production settings never offer learning diagnostic copy | Browser integration | Maintain existing domain guarantee |
| test/browser/learning-diagnostics.spec.ts: clipboard failure produces actionable status | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: offline double Space reveals distractors and records assisted history once | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: double Space after clicking a wrong choice | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: focused enabled choice does not receive a native Space click | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: dual-role Space/Shift tap works without a matching Space keyup | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: dual-role Space with intervening Shift down/up still reveals | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: focus within a question does not reset an armed Space shortcut | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: Space then non-Shift keys still cancel the shortcut | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: very short Space down/up pairs reveal without a hold-time requirement | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: holding Space and repeated keydowns without repeat never count twice | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: delayed hold keydowns without repeat flags never count as a second tap | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: pause blocks hints and resets the previous press | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: number keys 1–4 still answer and preserve clean history | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: online selection never reveals on double Space | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: editors and outside buttons keep native operations | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: focus changes, modifiers and window blur reset a partial shortcut | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: parent rerender does not lose the first press or duplicate listeners | Browser integration | Maintain existing domain guarantee |
| test/browser/selection.spec.ts: key/code fallbacks work and IME composition cannot arm a hint | Browser integration | Maintain existing domain guarantee |
| test/editor-rebase.test.mts: browser back without unsaved edits adopts latest room values | Unit/integration | Maintain existing domain guarantee |
| test/editor-rebase.test.mts: fresh remote fields are adopted without losing unrelated local edits | Unit/integration | Maintain existing domain guarantee |
| test/editor-rebase.test.mts: same-field edits never silently overwrite the remote version | Unit/integration | Maintain existing domain guarantee |
| test/editor-rebase.test.mts: concurrent item edits never overwrite each other | Unit/integration | Maintain existing domain guarantee |
| test/editor-rebase.test.mts: unchanged values and divergent room identities are handled explicitly | Unit/integration | Maintain existing domain guarantee |
| test/editor-rebase.test.mts: equivalent snapshots compare equal regardless of insertion order | Unit/integration | Maintain existing domain guarantee |
| test/fsrs7-engine.test.mts: the engine pins FSRS-7 and a versioned configuration | Unit/integration | Maintain experimental FSRS guarantee |
| test/fsrs7-engine.test.mts: card identities do not collide between recall and recognition | Unit/integration | Maintain experimental FSRS guarantee |
| test/fsrs7-engine.test.mts: answer grading never credits hints or corrected mistakes as first-try recall | Unit/integration | Maintain experimental FSRS guarantee |
| test/fsrs7-engine.test.mts: review returns a separate card and revlog without mutating the input | Unit/integration | Maintain experimental FSRS guarantee |
| test/fsrs7-engine.test.mts: predicted retention decreases over time without an intervening review | Unit/integration | Maintain experimental FSRS guarantee |
| test/fsrs7-engine.test.mts: recognition failures produce Again review logs, not recall credit | Unit/integration | Maintain experimental FSRS guarantee |
| test/generate-words.test.mjs: language rules reach Gemini with ${remote ? "legacy remote" : "fallback"} prompt | Unit/integration | Maintain existing domain guarantee |
| test/generate-words.test.mjs: non-Latin scripts and accents survive response validation without conversion | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: counts only alphanumeric + hiragana, excluding punctuation and kanji | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: >= 2x chooses the longer side, otherwise chooses the right | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: CSV chooses one answer column for all rows, with quoted commas and unicode | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: JSON array of question-answer maps uses the same orientation | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: JSON export roundtrips pair records | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: restrict answer to ASCII alphanumeric, hiragana, hyphen, spaces and specified punctuation | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: CSV and JSON preserve prolonged sound marks | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: invalid answer, malformed JSON and invalid CSV raise readable errors | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: role-labelled export roundtrips even when prompt is more than 2x answer | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: reject unsupported kana but permit all kana emitted by romanizer | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: single JSON object is an explicit question-to-answer mapping | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: duplicate prompts are preserved during JSON export | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: user's thirty CSV quiz rows all import; invalid answers are flagged only after import | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: malformed input still fails even though invalid answer chars are accepted | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: whole CSV chooses a single column even when individual rows favor the other | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: aggregate CSV threshold requires a strict longer side with >= 2x count | Unit/integration | Maintain existing domain guarantee |
| test/import-words.test.mjs: CSV and JSON enforce inclusive limits after assigning field roles | Unit/integration | Maintain existing domain guarantee |
| test/json-export-duplicates.test.mjs: JSON export preserves duplicate prompts instead of throwing | Unit/integration | Maintain existing domain guarantee |
| test/learning/diagnostics.test.mts: copied JSON anonymizes identifiers, uses current graph, and replays the actual choice | Unit/integration | Maintain learning guarantee |
| test/learning/diagnostics.test.mts: empty, duplicate, missing and invalid-date memories produce finite graph values | Unit/integration | Maintain learning guarantee |
| test/learning/diagnostics.test.mts: non-finite stored stability cannot report perfect mastery | Unit/integration | Maintain learning guarantee |
| test/learning/diagnostics.test.mts: inclusive 0.8 boundary and mixed mode use the same production prediction | Unit/integration | Maintain learning guarantee |
| test/learning/reload.test.mts: reload preserves unfinished early practice (held=${held}) | Unit/integration | Maintain learning guarantee |
| test/learning/reload.test.mts: invalid, stale and unavailable storage never prevents practice | Unit/integration | Maintain learning guarantee |
| test/learning/simulation.test.mts: ${size} mixed-mode items, seed ${seed}, ${result}: deterministic bounded state and forecast | Scenario/simulation | Maintain learning guarantee |
| test/learning/simulation.test.mts: failed word leaves its retry queue after independent successful confirmations | Scenario/simulation | Maintain learning guarantee |
| test/learning/simulation.test.mts: due review outranks unrelated new items and trace agrees with actual choice | Scenario/simulation | Maintain learning guarantee |
| test/learning/simulation.test.mts: snapshot continuation is equivalent at 1 hour, 1 day and 7 days | Scenario/simulation | Maintain learning guarantee |
| test/learning/simulation.test.mts: diagnostic observer neither draws random values nor changes selection or memory | Scenario/simulation | Maintain learning guarantee |
| test/learning/simulation.test.mts: invalid schemas and unsafe record identifiers are rejected | Scenario/simulation | Maintain learning guarantee |
| test/mcp-authorization-server.test.mts: MCP authorization server with real PostgreSQL and HTTP | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: DCR, discovery and public JWKS use the dedicated issuer | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: reject insecure/wildcard/fragment redirects and unsupported client authentication | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: consent JSON validates callback and excludes client-controlled CSP directives | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: requires PKCE S256, exact redirect, requested scope and current-environment resource | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: login return path, signed interaction cookie, CSRF, user binding and explicit deny | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: authorization-code exchange issues a resource-bound JWT accepted by MCP | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: repeat approval reuses a grant and legacy duplicates are grouped and fully revoked | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: wrong verifier, wrong redirect and code replay fail; concurrent redemption is single-use | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: refresh rotates, cannot change resource, and replay revokes the grant including JWTs | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: refresh revocation, JWT revocation and user disconnect invalidate grants immediately | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: reject normal Supabase Auth JWT, wrong issuer/audience/type/expiry/signature and revoked storage | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: confidential DCR clients must authenticate at exchange, refresh and JWT revocation | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: concurrent refresh redemption revokes the chain after reuse | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: database commit failure cannot deliver a successful registration | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: private storage has RLS and no public schema access | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: ETB account switch discards the stale MCP browser session before new approval | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: anonymous JWKS and registration floods cannot spend reserved OAuth capacity | Unit/integration | Maintain existing domain guarantee |
| test/mcp-authorization-server.test.mts: host spoofing, cross-origin forms and registration abuse fail closed | Unit/integration | Maintain existing domain guarantee |
| test/mcp-database-tls.test.mts: Supabase pooler receives the dashboard CA after pg parses the URL | Unit/integration | Maintain existing domain guarantee |
| test/mcp-database-tls.test.mts: remote database TLS cannot be weakened through conflicting URL options | Unit/integration | Maintain existing domain guarantee |
| test/mcp-database-tls.test.mts: real TLS verifies trusted chain and hostname and rejects an unrelated CA | Unit/integration | Maintain existing domain guarantee |
| test/mcp-database-tls.test.mts: diagnostics expose only recognized error codes, never credentials or exception text | Unit/integration | Maintain existing domain guarantee |
| test/mcp-etb-auth.test.cjs: return destination stays within ETB | Unit/integration | Maintain existing domain guarantee |
| test/mcp-etb-auth.test.cjs: MCP identity is verified from ETB's Supabase session cookies | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-diagnostics.test.mts: OAuth protocol diagnostics contain only fixed route and HTTP status | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-diagnostics.test.mts: authorization resume URLs use a fixed label and never log the UID | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-diagnostics.test.mts: OAuth server failures log only a fixed phase and allowlisted code | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-diagnostics.test.mts: authorization 503 errors display as plain text, not downloads | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-discovery.test.mjs: discovers DCR using RFC 8414 well-known path | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-discovery.test.mjs: recognizes CIMD separately from DCR | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-discovery.test.mjs: does not treat an unadvertised registration mechanism as supported | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-discovery.test.mjs: rejects mismatching protected resource | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-discovery.test.mjs: rejects issuer mismatch | Unit/integration | Maintain existing domain guarantee |
| test/mcp-oauth-discovery.test.mjs: DCR discovery does not imply resource-bound access tokens | Unit/integration | Maintain existing domain guarantee |
| test/online-memory.test.cjs: online recommends through the same Playground scheduler | Unit/integration | Maintain online guarantee |
| test/online-memory.test.cjs: room snapshots do not resend consumed recommendations | Unit/integration | Maintain online guarantee |
| test/online-memory.test.cjs: online selection answers persist recognition without recording free recall | Unit/integration | Maintain online guarantee |
| test/online-memory.test.cjs: online incorrect selection schedules a retry but never credits free recall | Unit/integration | Maintain online guarantee |
| test/online-memory.test.cjs: online choice speed is recorded only for clean recognition | Unit/integration | Maintain online guarantee |
| test/online-memory.test.cjs: guest online memory is visible to Playground and survives reload | Unit/integration | Maintain online guarantee |
| test/online-memory.test.cjs: server fallback is recorded against the actual word, never the suggestion | Unit/integration | Maintain online guarantee |
| test/online-memory.test.cjs: online recommendations and retries survive a new session after reload | Unit/integration | Maintain online guarantee |
| test/online-memory.test.cjs: a forced single choice advances online play without recording recognition | Unit/integration | Maintain online guarantee |
| test/partial-update.test.mts: invalid settings do not block valid fields or mutate the draft | Unit/integration | Maintain existing domain guarantee |
| test/partial-update.test.mts: skip only invalid words and duplicate IDs while keeping valid order | Unit/integration | Maintain existing domain guarantee |
| test/partial-update.test.mts: retain at most 512 valid words, excluding invalid rows before counting | Unit/integration | Maintain existing domain guarantee |
| test/partial-update.test.mts: empty word lists save deletions and boundary values remain valid | Unit/integration | Maintain existing domain guarantee |
| test/partial-update.test.mts: preserve the stored list while an answer is over the new limit | Unit/integration | Maintain existing domain guarantee |
| test/playground.test.cjs: ${size} fast correct words cover exactly once in ${size} user answers | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: graduated/high stability rows participate in every complete shuffle cycle | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: the first cycle reviews due words before untouched words | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: ${mode}: remaining words follow current priority within a cycle | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: interleaved review targets the weakest previously answered word without consuming the cycle | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: retained words and recent exposures cannot interrupt the cycle | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: due relearning takes priority over an optional spaced review | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: recognition answers advance the scheduler without becoming free recall | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: recognition mistakes reuse typing's short retry and confirmation schedule | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: selection-only recognition history prioritizes difficult questions without free recall | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: choice response speed breaks accuracy ties but cannot override a real failure | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: a single wrong choice is softened; repeated mistakes and speed still influence ordering | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: the first cycle preserves its Fisher–Yates order when no recall history exists | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: cached queue is re-ranked on answer mode change while keeping current and retries | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: old caches without an answer mode re-rank on restore | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: reload continues the exact pending cycle instead of reshuffling | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: reload preserves unfinished questions and scheduled failed recalls | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: repeated difficulty suspends only after four failures over two minutes | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: persistent failures escalate through 3h, 12h and 24h with a 24h cap | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: a successful independent recall reduces hold severity without treating typos as failures | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: recent BOT exposure never escalates difficulty, but assisted independent recalls do | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: all held words remain absent from user/BOT selection until due | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: word hold deadlines survive reload and removed room words are discarded | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: scheduler storage is scoped to user, room and mode | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: long-break restore re-evaluates due words without grading interrupted work | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: room edits reconcile the queue while preserving prior answers | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: damaged scheduler storage falls back to normal scheduling | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: a failed word is retried promptly, before unbounded new introductions | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: four persistently failing words block new introductions | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: relearning backlog drains after independent recall and permits new words | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: mixed failures keep the active backlog bounded | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: retry success widens the gap, second success clears it, renewed failure resets short gap | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: light corrected typo is distinct from a fully revealed answer | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: slow unaided correctness and typing errors do not become recall failures | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: recent BOT exposure supplies no independent recall or long-term gain | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: all words start without forced cues; speed does not multiply stability gain | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: bomb and hint helpers retain their independent behavior | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: BOT fallback stays null only before the user has answered anything | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: BOT fallback keeps the handoff alive after a user answer when every word is protected | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: BOT lookahead skips held and retry words before protecting upcoming recalls | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: BOT never introduces an unseen word when only a protected answered word exists | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: solo answer speech plays after success, including after a full hint | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: paused solo practice does not advance a question | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: active recall clock excludes paused intervals before and after resume | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: memory sync serializes newer writes and retains unsent data on rejection | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: actual solo Client callbacks keep practicing after the eight-new-word budget | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: selection callbacks mark early practice before clearing the scheduler turn | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: fallback answer-mode observations never enter authenticated sync queue | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: actual input callbacks retain a wrong character through Backspace correction | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: a renewed failure resets confirmation; exposure-assisted success never clears retry | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: manual hints skip solved letters and spaces and never reveal the last unresolved letter | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: manual hint shortcut is handled by the text input change path | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: full manual hint reuses the inline overlay and keeps typing enabled | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: existing mistakes clear when hints appear, while new incorrect keys are ignored | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: actual manual hint callback reveals the full answer and records one answer event | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: manual full hint clears incompatible pending romaji but keeps valid prefixes | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: actual solo progress callback keeps hint state without bomb pressure | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: correcting an interior letter completes a retained learning answer | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: second cycle prioritizes lower retrievability even within the old <0.8 bucket | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: first independent recall increases stability without crediting recent exposure | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: mastery progress counts current, three-hour and 24-hour retrievability | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: failed and fully revealed typing never reset the independent review date | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: demonstrated spacing extends the forecast while immediate recognition gives no new anchor | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: a mixed room prioritizes a due selection over a freshly recalled typing word | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: waiting with the prompt open does not increase spacing credit | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: an immediate selection does not clear the pending independent confirmation | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/playground.test.cjs: a full retry pool uses an answered filler before a retry becomes due | Unit/integration (mixed) | Maintain offline/legacy shared guarantee |
| test/posthog-identity.test.cjs: identification uses UUID and sends both email person properties | Unit/integration | Maintain existing domain guarantee |
| test/posthog-identity.test.cjs: verified email changes update the same identified person | Unit/integration | Maintain existing domain guarantee |
| test/posthog-identity.test.cjs: switching signed-in accounts resets the previous identity | Unit/integration | Maintain existing domain guarantee |
| test/posthog-identity.test.cjs: missing email does not create a fabricated person email | Unit/integration | Maintain existing domain guarantee |
| test/posthog-identity.test.cjs: room feed and confirmed account page both synchronize person details | Unit/integration | Maintain existing domain guarantee |
| test/public-feed-isr.test.cjs: guest sees no account-specific data or ownership queries | Unit/integration | Maintain existing domain guarantee |
| test/public-feed-isr.test.cjs: authenticated user receives only their owned IDs and saved IDs | Unit/integration | Maintain existing domain guarantee |
| test/public-feed-isr.test.cjs: failed private DB lookups fail closed and are never CDN cached | Unit/integration | Maintain existing domain guarantee |
| test/public-feed-isr.test.cjs: public feeds are ISR pages and never await personalized room list data | Unit/integration | Maintain existing domain guarantee |
| test/public-feed-isr.test.cjs: cookie-bearing feed requests bypass guest ISR | Unit/integration | Maintain existing domain guarantee |
| test/public-feed-isr.test.cjs: same-route sign out clears deferred ownership and save controls before redirect | Unit/integration | Maintain existing domain guarantee |
| test/public-feed-isr.test.cjs: public feed auth transitions preserve navbar, header and CTA dimensions | Unit/integration | Maintain existing domain guarantee |
| test/public-feed-isr.test.cjs: saved room toggles in personalized feeds update the shared viewer too | Unit/integration | Maintain existing domain guarantee |
| test/public-room-cache.test.cjs: cache miss, write and hit return only public summary fields | Unit/integration | Maintain existing domain guarantee |
| test/public-room-cache.test.cjs: invalidations use generations to prevent late writes from reviving stale lists | Unit/integration | Maintain existing domain guarantee |
| test/public-room-cache.test.cjs: private or item-bearing data is never served from the shared list cache | Unit/integration | Maintain existing domain guarantee |
| test/public-room-cache.test.cjs: Redis failure and missing configuration do not break Supabase fallback | Unit/integration | Maintain existing domain guarantee |
| test/public-room-cache.test.cjs: cache namespaces separate preview and production deployments | Unit/integration | Maintain existing domain guarantee |
| test/public-room-cache.test.cjs: Next.js dynamic-rendering bailout is rethrown, not logged as Redis failure | Unit/integration | Maintain existing domain guarantee |
| test/public-room-cache.test.cjs: configured TTL overrides the one-hour default | Unit/integration | Maintain existing domain guarantee |
| test/retry-gap.test.cjs: short retries precede spaced confirmation checks | Unit/integration | Maintain existing domain guarantee |
| test/retry-gap.test.cjs: retry intervals remain feasible in rooms smaller than the configured gap | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: common syllables, two-/three-letter romanization | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: progressive roman boxes keep the current letter active | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: ん uses the second n as start of the following n-row kana | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: っ supports doubled consonants and small-tsu notation | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: mixes kana, English, spaces and hyphens without changing English keys | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: ASCII hyphen types Japanese long vowels without rewriting the answer | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: editable kana typing commits long vowels via the physical hyphen key | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: English ASCII hyphens remain literal, while fullwidth answer hyphens accept - | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: invalid input never alters committed kana or composition | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: wire representation round-trips mid-composition and completed syllables | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: ん followed by n-row kana accepts shared or explicit extra n | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: roman boxes expand immediately when the whole syllable is hinted | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: incomplete kana hints do not reveal unseen small kana | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: incorrect kana stays until the whole answer is attempted | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: clicking or arrowing to an earlier kana allows editing without clearing later letters | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: skipping ahead never treats the last box as the end of a word | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: impossible romaji fails immediately; a valid but wrong kana does not | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: editable typing supports kana combinations and n-row carry | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: editing a kana + English mixed answer remains position-aware | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: fa and fi convert as combined kana, including optional fe and fo | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: timed hints clear pre-existing mistakes, including incorrect kana | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: hinted Latin cells ignore wrong keys but accept spaces and literal hyphens | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: hinted kana accepts every valid romanization and ignores wrong keys | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: input in a blank unhinted kana slot remains editable through completion | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: てすと -> たちつ: first two wrong kana are held; third ends the failed attempt | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: valid complete sequences preserve input until the last kana even without hints | Unit/integration | Maintain existing domain guarantee |
| test/romaji-input.test.mjs: space-only cells ignore any non-space key without counting a miss | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: room cache stores only public/unlisted source fields, never passwords | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: private room entries are never cached or accepted from Redis | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: invalidation fences delayed writes and affects only selected aliases | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: cache is optional, falls back on errors, and supports TTL override | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: namespaces keep unrelated deployments apart | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: blocking prior to a privacy change bypasses stale data until invalidated | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: a cache outage refuses privacy revocation while allowing DB fallback reads | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: overlapping edit cannot clear another mutation's active privacy fence | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: fencing multiple aliases is atomic when an alias is already blocked | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: a lost block response cannot strand a permanent fence or restore stale data | Unit/integration | Maintain existing domain guarantee |
| test/room-data-cache.test.cjs: shortening room-data TTL never releases a fence before old 24h payloads expire | Unit/integration | Maintain existing domain guarantee |
| test/room-delete-security.test.cjs: delete is conditional on the revision used to fence the original alias | Unit/integration | Maintain existing domain guarantee |
| test/room-delete-security.test.cjs: successful deletion releases the original link and invalidates a changed returned alias | Unit/integration | Maintain existing domain guarantee |
| test/room-delete-security.test.cjs: a private room deletion still invalidates the room ID and slug | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: recommended preserves public ranking and does not reveal private or unlisted rooms | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: mine includes all owned visibility levels, newest first | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: saved applies the same visibility boundary as the web room feed | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: own version of a room overrides public summary and retains ownership | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: guest never gains access from saved IDs alone | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: latest sorts public rooms by creation date, not update date or recommendation rank | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: guests can browse latest public rooms without exposing private or unlisted rooms | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: edit action is available only for the signed-in creator, including in latest | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: minimal owner ID records preserve public details and edit ownership | Unit/integration | Maintain existing domain guarantee |
| test/room-list.test.mts: sidebar and page titles share identical guest and signed-in navigation | Unit/integration | Maintain existing domain guarantee |
| test/room-readings.test.mts: IPADIC exact readings, fully covered compounds and unknown words | Unit/integration | Maintain existing domain guarantee |
| test/room-readings.test.mts: only reuse current readings from persisted answers | Unit/integration | Maintain existing domain guarantee |
| test/room-readings.test.mts: technical compounds, katakana and kana normalization | Unit/integration | Maintain existing domain guarantee |
| test/room-readings.test.mts: saving existing items retries empty, missing, stale and changed answers | Unit/integration | Maintain existing domain guarantee |
| test/room-readings.test.mts: manual, CSV and large JSON imports share save-time generation | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: anonymous, non-owner, missing room, stale version and lookup failure never hash | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: valid owner hashes after authorization and preserves the conditional edit write | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: password retention, clearing and invalid values preserve existing semantics | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: busy admission never clears or writes a password | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: MCP updates reject unauthorized and stale edits before hashing; owner edits save | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: hashing has bounded concurrency, per-user cooldown and releases capacity on failure | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: cooldown storage rejects excess identities and recovers after expiry | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: admitted password hashes remain compatible with the existing Argon2 verifier | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: MCP get_room accepts canonical room URLs without changing ownership filters | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: MCP separates expected failures from database failures in PostHog | Unit/integration | Maintain existing domain guarantee |
| test/room-update-security.test.cjs: successful owner and MCP updates invalidate the affected room aliases | Unit/integration | Maintain existing domain guarantee |
| test/learning/simulation.test.mts: ${size} items with one permanent failure keep bounded retries and progress | Scenario/simulation | Added; preserve bounded queues and other-item progress at all seven sizes |
