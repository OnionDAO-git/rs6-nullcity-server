# QA-20260602-003 Handoff: Storyteller Preview Fails Closed

## Issue

`storytellerLatestPreview` in the dashboard exposed dynamic public-looking copy for Storyteller runs that were not public canon:

- dispatches with `needsReview=true` fell back to top-event preview text,
- otherwise-ready dispatches in the `review` queue showed their generated body,
- dry-run digests showed event-derived preview copy.

## Fix

Dashboard commit: `e52cf00 fix(story): fail closed non-canon previews`

Changed `packages/web/src/lib/resident-story.ts` so non-ready or non-canon-queue runs return static held-for-review copy before dispatch or event-derived copy can be used. Canon/ready dispatches still show public dispatch copy, and canon/ready runs with no body can still derive grounded public moments from events.

## Evidence

Red/green regression:

- `bun test packages/web/src/lib/resident-story.test.ts`
  - red before implementation: 3 failing assertions for review-needed, review-queue, and dry-run preview exposure
  - green after implementation: `41 pass, 0 fail, 90 expect() calls`

Dashboard gates after installing from `bun.lock` in the isolated worktree:

- `bun run typecheck`: all packages exited 0
- `bun run check`: all packages exited 0
- `bun run build`: all packages built; existing Vite asset/chunk-size warnings only

## Notes

`docs/issue-register.md` was not edited in this clean server worktree because the new QA rows are still local/dirty in the shared checkout and not present on `origin/agents/wip`. The `STARTING` and `HANDOFF` lines in `docs/agent-status.md` are the durable lock/evidence for this issue until the register is reconciled.

