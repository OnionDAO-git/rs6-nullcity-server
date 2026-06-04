# QA Packet `qa-20260604-1428-library-public-empty`

- Time: 2026-06-04 14:28-14:34 CDT
- Classification: READ-ONLY verification plus docs-only issue handoff
- Proposed issue: `QA-20260604-095`
- Severity: P1
- Area: Dashboard public Library truth
- Owner area: dashboard attendee Library route / Library data hydration

## Finding

The attendee `/library` route renders an empty Library even though the same live stack exposes Library data through the API and debug Library route.

This is distinct from the public `/wall` and `/graveyard` route 404s:

- `/library` is a known attendee route and does not 404.
- The route renders `No projected soul lives` and `No soul files found`.
- `GET /v1/library` returns `total=13`.
- `/debug/library` renders the actual Library with resident entries.

## Orientation Evidence

- Server repo: `agents/wip`, behind `origin/agents/wip` by 58 commits.
- Dashboard repo: `codex/storyteller-overview-bff`.
- Expected screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`, `nullcity-storyteller`.
- Expected listeners present: `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`.
- `qmd` unavailable on PATH.
- Dashboard root returned `200`.
- `/api/overview` returned readiness `ok`, gateway connected, controller available, `23` residents, `10` online, `27` runtimes.
- `npm run controller:status` returned `HEALTH: ok`, `25` residents, `0` erroring.

## Evidence

API Library truth:

```bash
curl -fsS 'http://127.0.0.1:8787/v1/library'
```

Observed:

- top-level keys: `asOf`, `residents`, `total`
- `total=13`
- first sample: `res:mother-anvil`, `currentState=living`, `arcPhase=progress`

Rendered attendee route:

- URL: `http://127.0.0.1:5174/library`
- Rendered route did not 404.
- Observed text included:
  - `LIBRARY`
  - `No projected soul lives`
  - `SOUL FILES`
  - `No soul files found`
- Rendered text did not include `res:restart-test`, `res:loop-check`, or the resident entries visible in debug Library.

Rendered debug route:

- URL: `http://127.0.0.1:5174/debug/library`
- Rendered text included:
  - `Library of Souls`
  - resident entries including `res:mother-anvil`, `res:agent`, and `res:restart-test`
  - `res:agent reborn`

Related route truth:

- `/debug/wall` still shows repeated public passing broadcasts for `res:loop-check`.
- `/debug/graveyard` simultaneously says `No residents have died yet.`
- `/v1/wall/snapshot?limit=12` returns 12 duplicate `[Broadcast] On the passing of res:loop-check` letters while `/v1/graveyard` returns `total=0`.
- Those wall/death signals remain covered by proposed `QA-20260603-089`.

## Likely Code Path

Dashboard repo:

- Attendee route mapping accepts `/library` as a known city route.
- Debug route `/debug/library` renders the legacy/public Library page correctly.
- The attendee Library view appears to use a different projected soul/story model than the working `/v1/library` payload, and falls back to empty state instead of consuming the live Library residents.

## Impact

The public attendee Library says there are no soul files while the live Library contains resident records. This undermines the main human-facing memory/lifecycle surface and makes operators think Library substrate is empty even when it is not.

## Next Action

For the dashboard dev agent:

1. Decide whether attendee `/library` should consume `GET /v1/library` directly or share the debug Library data mapping.
2. Add a regression where `GET /v1/library` returns residents and attendee `/library` renders at least one resident entry instead of `No soul files found`.
3. Re-run rendered checks for:
   - `http://127.0.0.1:5174/library`
   - `http://127.0.0.1:5174/debug/library`
   - `GET http://127.0.0.1:8787/v1/library`

## Collision Note

`docs/issue-register.md` is already dirty in the shared worktree, so this cycle did not add a canonical issue-register row. Add or merge `QA-20260604-095` into the issue register once that file is safe to edit.
