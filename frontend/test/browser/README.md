# Selection keyboard browser regression tests

Run from `frontend`:

```sh
npm ci
npx playwright install chromium webkit
npm run test:selection-browser
```

These tests run the real offline `Client`, `GameView`, `ItemView`,
`SelectionQuestionView`, scheduler and guest localStorage persistence in
Chromium and WebKit. A separate controls fixture tests online hint permission,
editable controls, React StrictMode/rerenders, and DOM KeyboardEvent variants.
Playwright sends real browser key down/up events for normal interactions.

The esbuild test server replaces Next navigation/Link, server authentication,
memory server actions and PostHog adapters. It supplies a four-word room and
an unauthenticated memory response. It does not use production credentials,
connect to a game server, or exercise database synchronization. Production CSS
and Next routing/hydration are not loaded. WebKit coverage is not a manual test
of the Safari application or a Japanese IME.

## Investigation evidence (2026-11-20)

- PR #624 was open; its head was `d7599db0`. Ordinary double-Space and
  double-Space after clicking a wrong answer passed on that existing code in
  both Chromium and WebKit. The reported general failure was not reproduced
  on that head; its deployed URL/browser/IME condition remains unconfirmed.
- Substituting the #622 component (`be533c1e`) reproduced failure of
  `focused enabled choice does not receive a native Space click`: the handler
  excluded every button, so a focused answer kept native Space activation
  instead of revealing distractors. #624 already changes that exclusion and
  cancels keydown/keyup defaults in the capture phase.
- Substituting the original #624 component reproduced failures of
  `holding Space and repeated keydowns without repeat never count twice` and
  `focus changes, modifiers and window blur reset a partial shortcut`.
  It relied only on `repeat` and retained a partially entered shortcut across
  focus/modified input. The updated component requires a release and resets
  that partial sequence when the interaction changes.
- The same `revealHint` callback still serves the button and the shortcut.
  The full offline flow verifies one assisted attempt and `unknownCount: 1`
  in guest history after answering and reloading. The existing answer-mode
  tests verify review failure weight `1.3`.

## Validation of this change

- `npm run test:selection-browser`: 22/22 passed (Chromium and WebKit on macOS).
- `npm run test:playground`: 94/94 passed, including weight `1.3` tests.
- `npx next typegen` followed by `npx tsc --noEmit`: passed. Initial typecheck
  encountered stale `.next/types` paths from a different route layout.
- `npm run build`: passed.
- ESLint for changed TS/TSX/MJS files: no errors; one pre-existing
  `responseClock.current` effect-cleanup warning in SelectionQuestionView.
- Repository-wide `npm run lint`: fails on 10 pre-existing
  `@typescript-eslint/no-require-imports` errors in `account-auth.test.cjs`
  and `mcp-etb-auth.test.cjs`; no assertions or lint rules were removed.

The test fixture is not evidence of production deployment behavior, real
Socket.IO online play, authenticated database persistence, or native IME behavior.
