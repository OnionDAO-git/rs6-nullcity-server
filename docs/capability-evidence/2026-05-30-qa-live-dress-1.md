# QA-LIVE-DRESS-1 - live demo oracle

Date: 2026-05-30 17:39-17:45 CDT
Stack: local hot stack, controller pid `28531`, dashboard `http://127.0.0.1:5174`, BFF `http://127.0.0.1:8787`, letters HTTP `http://127.0.0.1:43596`.

## Verdict

**READY WITH WARNINGS for the dashboard/story/wall demo path. NOT fully green for resident intelligence.**

The stack is alive enough to show: dashboard loads, 23 residents are online, wall snapshot is redacted and populated, Storyteller feed renders, and most residents act during a 120s window. The main warning is resident behavior: `res:qa-guardian` and `res:qa-survivor` got stuck in a low-health stranded loop with too few observed actions.

## Commands

```sh
bash scripts/post-restart-smoke.sh
npm run controller:smoke -- --observe-seconds 120 --min-observed-actions 1 --allow-recent-visible
curl -s 'http://127.0.0.1:8787/api/overview'
curl -s 'http://127.0.0.1:8787/api/residents?filter=all'
curl -s 'http://127.0.0.1:8787/api/storyteller/digests?limit=5'
curl -s 'http://127.0.0.1:43596/v1/wall/snapshot'
```

Browser checks:

- `http://127.0.0.1:5174/residents` initially rendered "Resident roster is syncing", then settled to 23 live resident cards with no console errors.
- `http://127.0.0.1:5174/story` rendered the latest Storyteller digest (`s5b-ncri-proof-20260530T0920`) with operator-review status and no console errors.

## Results

### Post-restart smoke

`scripts/post-restart-smoke.sh` returned **READY WITH WARNINGS (1 yellow)**.

- Controller process alive: pid `28531`, started `Sat May 30 16:22:16`.
- Letters HTTP server bound on `:43596`; `/v1/inbox` responded.
- `/v1/health` was slow/unavailable, but the script's fallback route passed.
- `/v1/wall/snapshot` redaction passed: public letter bodies empty and recipients masked.
- All 23 resident runtime states were alive.
- Hero attention floors were preserved: Hans/Father Aereck/Wise Old Man/Duke at `5000`, Pip/Thrand at `3000`.
- Library index showed all 23 residents in `living` state.
- Recent activity was green for 22/23 residents. `res:qa-survivor` had rows but `0` actions in the last 5 minutes.
- Patron registry had 1 configured patron.

### API probes

Dashboard overview:

```json
{"residents":23,"online":23,"gateway":true,"controller":true}
```

Dashboard resident list:

```json
{"count":23,"first":"res:agent"}
```

Dashboard Storyteller feed:

```json
{"items":2,"latest":"s5b-ncri-proof-20260530T0920","latestTitle":"Null City Dispatch: NCRI activity recorded","needsReview":true}
```

Wall snapshot:

- HTTP `200` on `http://127.0.0.1:43596/v1/wall/snapshot`.
- Included redacted recent letters, live hero roster rows, faction labels, and faction stockpiles.
- 11 public/hero residents visible in the wall roster; synthetic QA residents are correctly filtered from the public wall.

### Controller smoke

`controller:smoke` exited **1** after 120s because 2 residents were warned.

Healthy signals:

- 21/23 residents were OK.
- Hero residents spoke and moved, with distinctive goal text visible in their lines.
- Most QA residents produced action/result evidence in the observation window.
- No global submit queue collapse was observed in this run.

Warnings:

- `res:qa-guardian`: `no_recent_visible_activity`, `decision_loop_without_actions:low_health_stranded`, `no_observed_visible_activity`, `observed_actions_below_1`.
- `res:qa-survivor`: `decision_loop_without_actions:low_health_stranded`, `observed_actions_below_1`.
- `res:qa-angler` and `res:qa-cook` had movement timeouts but still spoke/acted.
- Several hero lines still use the fallback "Still here as X; watching the area" cadence.

## Demo Guidance

Safe to show right now:

- Dashboard home and `/residents` as the main "city is alive" surface.
- `/story` as a grounded Storyteller feed, while saying dispatches currently require operator review before public canon.
- Wall snapshot/projection as proof of redacted public letters, live residents, faction labels, and stockpiles.
- Resident detail for active residents such as `res:agent`, Hans, Thrand, Father Aereck, Wise Old Man, Duke Horacio, `res:qa-woodcutter`, `res:qa-scout`, `res:qa-trader`.

Avoid as a proof point until fixed:

- Claiming every resident is continuously intelligent under all conditions.
- Combat/survival as fully solved. Low-health residents can still strand in decision loops.
- `/v1/health` as a live-demo command; it can hang on inference health.

## Next Fix Packet

Open a focused P0/P1 packet for low-health stranded behavior:

- Reproduce with `res:qa-guardian` and `res:qa-survivor` smoke/log evidence.
- Make low-health residents emit a safe action instead of no-op looping: eat if food is available, retreat to a safe tile if pathable, say/ask for help if stranded, or log a visible `heal_wait` action result.
- Add TDD coverage around the `decision_loop_without_actions:low_health_stranded` path and rerun the 120s smoke.
