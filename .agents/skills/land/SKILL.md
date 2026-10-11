---
name: land
description: >-
  Prepare and publish requested Ei-TypeBomb changes as a pull request only.
  Invoke only when the user explicitly chooses Land Changes or asks to publish
  a PR. Never merge as part of this workflow.
disable-model-invocation: true
metadata:
  delta-action: land
---

# Land Ei-TypeBomb changes

Use this workflow only after an explicit request to publish the current changes
as a PR or to use Land Changes. That request authorizes committing, pushing,
and opening/updating the PR, but **never authorizes merging**. Finish after
verifying the PR exists, or report clearly why publication failed.

## Preflight

1. Confirm the repository is Ei-TypeBomb and inspect `git status`, current
   branch, configured remotes, and the intended change diff. Never operate on
   another checkout or another thread's worktree.
2. Preserve unrelated and pre-existing changes. Do not reset, clean, overwrite,
   or stage unrelated files. If changes are uncommitted, identify which belong
   to the requested work and stage only those. If scope cannot be separated
   safely, stop and ask.
3. Check the target branch and repository settings through the available
   GitHub interface. Use `main` for ordinary feature work unless the user or
   repository configuration specifies otherwise. Use `production` only when
   that is the intended destination.
4. Check `gh auth status` if using the GitHub CLI. If CLI authentication is
   unavailable, use an authenticated GitHub integration that supports the
   necessary operations and verification. Use the configured source remote
   (normally `origin`), never the `local` backlink, for CLI publication.
   If neither interface has sufficient access, stop before publishing.
5. Create or use an issue-named feature branch such as
   `aoiihara/dev-472`. Preserve the existing branch if it already represents
   this change. Do not rewrite shared history or force-push.
6. If the requested change is already implemented and there is no meaningful
   diff to publish, do not create an empty commit or PR. Verify and report it.

## Verify locally

Inspect the changed paths and their `package.json` scripts; run the relevant
checks before publishing. Supported repository commands include:

- Node backend: `npm test --prefix backend/server`,
  `npm run typecheck --prefix backend/server`, and
  `npm run build --prefix backend/server`.
  (`backend/server/package.json`, scripts `test`, `typecheck`, `build`)
- Cloudflare backend: `npm test --prefix backend/cloudflare`,
  `npm run typecheck --prefix backend/cloudflare`, and
  `npm run build --prefix backend/cloudflare`.
  (`backend/cloudflare/package.json`, scripts `test`, `typecheck`, `build`)
- Client: `npm run lint --prefix client`,
  `npm run build --prefix client`, and, when playground behavior is affected,
  `npm run test:playground --prefix client`.
  (`client/package.json`, scripts `lint`, `build`, `test:playground`)

Both backend projects share `backend/shared/`; changes there require checks for
both backends. Run additional checks required by the actual changed code or
repository settings. Do not treat local checks as a substitute for required
PR checks.

## Publish PR and stop

1. Prepare a concise, accurate commit and PR description from the actual diff.
   Follow existing issue/branch context; do not invent issue IDs, test results,
   or human-authored text required by policy.
2. Push the feature branch to the configured source remote and create or update
   a PR using an authenticated GitHub interface. Target `main` by default;
   target `production` only when explicitly intended.
3. For a PR targeting `production`, apply exactly one of `Major`, `Minor`, or
   `Patch`. `.github/workflows/validate-release-label.yml` enforces this.
4. Inspect the final PR diff against its base branch. Confirm that all changed
   files belong to the requested scope and no secrets, unrelated changes, or
   unintended generated artifacts are included.
5. Verify the PR URL, base, head branch, head SHA, and open state. Report the
   available review and CI/check status accurately; pending or failing checks
   are not grounds for merging or for claiming checks passed. Do not wait for
   CI completion merely to finish this workflow.
6. **Stop after PR creation or update. Never merge, enable auto-merge, enqueue
   a merge, or modify the destination branch.** A separate explicit request
   and workflow are required to merge.

## Resolve conflicts

Resolve conflicts automatically only when the intended result is clear from
the change, surrounding code, and project conventions. Preserve unrelated
work. If intent is ambiguous or resolution risks data loss, stop and ask.

## Confirm PR publication

Confirm the PR is open on GitHub with the intended base and head. Report its
URL, changed scope, tests run, and any outstanding checks or reviews.
**PR publication is the final step; do not merge the PR.**
