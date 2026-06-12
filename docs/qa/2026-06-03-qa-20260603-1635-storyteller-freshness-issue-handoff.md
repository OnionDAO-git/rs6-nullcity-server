# QA-20260603-092 Storyteller Projector Freshness Freezes

Packet: `qa-20260603-1635-storyteller-freshness-readtruth`
Scope: READ-ONLY live verification, docs-only issue handoff
Proposed issue: `QA-20260603-092`
Severity: P1
Area: Storyteller / dashboard public truth
Owner area: server Storyteller projector frame read path, with dashboard story overview verification

## Finding

The live Storyteller projector now appears to have picked up the active-resident source filter from `QA-20260601-070`: the current frame names only `res:agent` and `res:hans`, with no stale/test residents.

A separate freshness bug remains: `latest-frame.json` preserves the freshness computed when the frame was written, and the City API/dashboard serve that value later without recomputing age. At `2026-06-03T21:37:20Z`, `/api/projector/overview` returned a frame whose digest was built at `2026-06-03T20:49:13.640Z`:

- wall-clock digest age: about 48 minutes
- code default stale threshold: `30 * 60 * 1000` ms
- reported `source.freshnessMs`: `0`
- reported `source.freshnessStatus`: `fresh`
- dashboard copy path uses `frame.source.freshnessStatus` to render `fresh city evidence`

This means the public projector can continue claiming fresh Storyteller evidence after the frame has aged past the server's own stale threshold.

## Evidence

Runtime orientation at `2026-06-03 16:35-16:37 CDT`:

- Screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`.
- Listeners present: `43595`, `43594`, `43610`, `43596`, `43611`, `8787`, `5174`.
- Dashboard web `/` returned `200`.
- `/api/controller/status` returned `available=true`, `residentsWithRuntime=27`.
- `/api/overview` returned readiness `ok`, `23` residents, `10` active in controller cohort.
- `qmd` unavailable.

Live projector evidence:

```bash
curl -fsS http://127.0.0.1:8787/api/projector/overview |
  jq '{generatedAt, source:.projectorFrame.source, publicHealth:.projectorFrame.publicHealth}'
```

Observed:

- `generatedAt=2026-06-03T21:37:20.807Z`
- `digestBuiltAt=2026-06-03T20:49:13.640Z`
- computed wall-clock age from `digestBuiltAt`: `48` minutes
- `freshnessMs=0`
- `freshnessStatus=fresh`
- `publicHealth.status=degraded`, warnings only `["model call was nooped (unknown)"]`

Direct City projector evidence matched the dashboard BFF:

```bash
curl -fsS -H 'Authorization: Bearer operator-token' \
  http://127.0.0.1:43611/api/nullcity/storyteller/projector/latest
```

`data/controller/storyteller/latest-frame.json` also contains the same frozen freshness fields:

- `source.digestBuiltAt=2026-06-03T20:49:13.640Z`
- `source.freshnessMs=0`
- `source.freshnessStatus=fresh`

## Likely Code Path

Server:

- `src/controller/storyteller/public-frame.ts` computes `freshnessMs` and marks stale after `DEFAULT_STALE_AFTER_MS = 30 * 60 * 1000`.
- `src/controller/city-integration/service.ts` `storytellerProjectorLatest()` returns `StorytellerStore.readLatestProjectorFrame()` as-is when `latest-frame.json` exists.

Dashboard:

- `packages/web/src/lib/story-overview.ts` uses `frame.source.freshnessStatus` to show `fresh city evidence` versus `city evidence needs refresh`.

## Impact

- Public projector/dashboard Storyteller surfaces can claim fresh story evidence from an aged frame.
- This hides the difference between "safe fallback copy from a recent frame" and "safe fallback copy that needs refresh."
- It is separate from `QA-20260601-070`; the stale/test resident names are no longer present in the current frame, but frame freshness is now frozen.

## Next Action

Add or update a canonical issue-register row for `QA-20260603-092` once `docs/issue-register.md` is safe to edit.

Fix direction for dev agents:

- Recompute projector frame freshness on read, or have the dashboard derive current age from `source.digestBuiltAt` / `frame.generatedAt` instead of trusting persisted `freshnessMs`.
- Add a regression where a persisted `latest-frame.json` older than `DEFAULT_STALE_AFTER_MS` produces stale public status or dashboard copy.
- Re-run read-only verification against `/api/projector/overview`, direct City `/api/nullcity/storyteller/projector/latest`, and `/overview` after the frame is older than 30 minutes.

## Collision Note

`docs/issue-register.md` is dirty/collision-risky, and several QA handoffs are already untracked in this repo. This handoff avoids the register and uses a unique docs path plus an append-only `docs/agent-status.md` pointer.
