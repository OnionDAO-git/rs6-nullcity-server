# QA-20260602-002 — Story route protection handoff

Status: Fixed in dashboard commit `a91bb92`.

Issue: `/story` and `/story/*` were known Storyteller routes, but `isProtectedCityRoute()` did not treat them as protected attendee UI. QA Marshal filed this as `QA-20260602-002`.

Fix:

- Dashboard `packages/web/src/lib/routes.ts` now protects `/story` and `/story/*`.
- Dashboard `packages/web/src/lib/routes.test.ts` now asserts story routes are protected while still avoiding the heavy city snapshot.

Verification:

- `bun test packages/web/src/lib/routes.test.ts`: 11/11 passing, 54 assertions.
- `bun run typecheck`: pass.
- `bun run check`: pass.
- `bun run build`: pass.

Notes:

- `docs/issue-register.md` in the shared server checkout had the QA-20260602 rows, but those rows were not present on `origin/agents/wip` at claim time and the shared file was dirty. Per protocol, this packet used `docs/agent-status.md` as the lock and this handoff file as the row update substitute.
- No live runtime, resident, controller, or dashboard process was restarted or mutated.

Next:

- Once the QA Marshal issue-register rows are safely pushed/merged, update `QA-20260602-002` from `Open` to `Fixed` or `In Review` with dashboard commit `a91bb92` and this evidence.
