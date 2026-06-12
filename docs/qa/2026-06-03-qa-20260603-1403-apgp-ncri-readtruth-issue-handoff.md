# QA-20260603-090 AP/GP Economy Window Stale While Residents Act

Packet: `qa-20260603-1403-apgp-ncri-readtruth`
Scope: READ-ONLY live verification
Proposed issue: `QA-20260603-090`
Severity: P1
Area: AP/GP economy / City API read paths / Storyteller economy input
Owner area: controller CityIntegration economy event append/read filters, with dashboard BFF verification

## Finding

The live controller and dashboard show 10 online residents with fresh action/progress timestamps, but the City economy read paths still report zero activity in the current 15-minute window.

This appears to be the recurrence formerly tracked as `QA-20260602-070`, but that row is not present in the current `docs/issue-register.md`. Because `docs/issue-register.md` is dirty/collision-risky, this handoff preserves the finding for automated dev agents without editing the register.

## Current Evidence

Runtime orientation at `2026-06-03 14:03-14:05 CDT`:

- Screens present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`.
- Listeners present: `43595`, `43594`, `43610`, `43596`, `43611`, `8787`, `5174`.
- Dashboard web `/` returned `200`.
- `/api/controller/status` returned `available=true`, `residentsWithRuntime=27`.
- `/api/overview` returned readiness `ok`, `23` residents, `10` online.
- `qmd` unavailable.

Active residents:

```bash
curl -fsS 'http://127.0.0.1:8787/api/residents?filter=all'
```

Observed `10` online residents. Their `progress.latest.ts` values were fresh around `2026-06-03T19:05:06Z`, including action/chat events for `res:agent`, `res:hans`, `res:qa-banker`, `res:qa-cook`, `res:qa-guardian`, `res:qa-scout`, `res:qa-social`, `res:qa-survivor`, `res:qa-trader`, and `res:qa-woodcutter`.

City heartbeat:

```bash
curl -fsS -H 'Authorization: Bearer operator-token' \
  'http://127.0.0.1:43611/api/nullcity/economy/heartbeat'
```

Returned:

- `activeResidentCount=10`
- `economyEventCount=281`
- `lastEconomyEventTs=2026-06-03T06:44:37.221Z`
- `lastEconomyEventKind=gp_observed`
- `asOf=2026-06-03T19:04:37Z` / later BFF `asOf=2026-06-03T19:05:27Z`
- `degradedFlags=[]`

City live/totals/residents:

```bash
curl -fsS -H 'Authorization: Bearer operator-token' \
  'http://127.0.0.1:43611/api/nullcity/economy/live'
curl -fsS -H 'Authorization: Bearer operator-token' \
  'http://127.0.0.1:43611/api/nullcity/economy/totals'
curl -fsS -H 'Authorization: Bearer operator-token' \
  'http://127.0.0.1:43611/api/nullcity/economy/residents'
```

Observed:

- `/economy/live` window since `2026-06-03T18:50:06Z`, `city.activeResidentCount=0`, `recentEvents=0`, all `countsByKind=0`.
- `/economy/totals` also reported `city.activeResidentCount=0`, all `countsByKind=0`.
- `/economy/residents` reported `31` residents, `10` online, `activeInWindow=0`.
- All 10 online residents had `windowEventCount=0`, `activeInWindow=false`.

Dashboard BFF mirror:

```bash
curl -fsS 'http://127.0.0.1:8787/api/nullcity/economy/heartbeat'
curl -fsS 'http://127.0.0.1:8787/api/nullcity/economy/live?limit=5&residentLimit=5'
```

Observed:

- BFF heartbeat `available=true`, `activeResidentCount=10`, `lastEconomyEventTs=2026-06-03T06:44:37.221Z`.
- BFF live snapshot `available=true`, but `snapshot.city.activeResidentCount=0`, `recentEvents=0`, top residents online with `windowEventCount=0`.

NCRI/read-path sanity:

- Direct City `GET /api/nullcity/economy/listings` returned `7` listings.
- Direct City `GET /api/nullcity/ncri` returned `16` records.
- Direct City `GET /api/nullcity/ncri/print-queue?status=queued` returned `0` queued items.
- Dashboard admin bridge routes exist and auth-gate as expected without a session: `/api/admin/nullcity/economy/listings`, `/api/admin/nullcity/ncri`, and `/api/admin/nullcity/ncri/print-queue?status=queued` all returned `401 unauthenticated`, not `404`.

## Likely Impact

- Dashboard economy panels show a stale/no-activity live window despite residents acting.
- Storyteller economy input will miss current resident AP/GP/NCRI activity.
- CQA/normal-life evidence may under-report ordinary AP/GP recurrence, GP earning/distribution, and NCRI activity.

## Next Action

Add or update a canonical issue-register row for `QA-20260603-090` once `docs/issue-register.md` is safe to edit.

Fix direction for dev agents:

- Determine whether economy events are no longer being appended during ordinary resident actions, or whether `/economy/live`, `/economy/totals`, and `/economy/residents` are filtering/reading the wrong event source.
- Add a regression around a freshly appended economy event appearing in `/economy/live`, `/economy/totals`, `/economy/residents`, `/economy/heartbeat`, and Storyteller digest input.
- Re-run the same read-only curls above after the fix and confirm at least one online resident becomes `activeInWindow=true` after fresh economy activity.

## Collision Note

`docs/issue-register.md` is already dirty and no longer contains the earlier `QA-20260602-070` row. This handoff avoids register edits and adds only a compact `docs/agent-status.md` pointer.
