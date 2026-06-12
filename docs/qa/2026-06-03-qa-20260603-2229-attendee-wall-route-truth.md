## QA Packet `qa-20260603-2229-attendee-wall-route-truth`

- Time: 2026-06-03 22:29-22:35 CDT
- Classification: READ-ONLY
- Server SHA: `53b7761d`
- Dashboard SHA: `2b5190e`
- Related issue: supports proposed `QA-20260603-089` (issue register remained dirty this cycle)

### Target

Verify whether the attendee wall route is live and truthful on the current shared stack, and distinguish a real public-route regression from a debug-only or trailing-slash mismatch.

### Runtime context

- `screen -ls` showed the expected shared sessions: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`, plus `nullcity-storyteller`.
- `lsof` showed listeners on `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, and `5174`.
- `npm run controller:status --silent` reported `HEALTH: ok`, `25` known residents, and the expected active cohort of `10`.
- `npm run controller:smoke -- --observe-seconds 10 --allow-recent-visible` observed the shared cohort alive with only familiar warnings on `res:agent`, `res:qa-trader`, and `res:qa-banker`.

### Evidence

1. Attendee route failure, both variants:
   - `http://127.0.0.1:5174/wall`
   - `http://127.0.0.1:5174/wall/`
   - Observed text on both: `NOT FOUND 404 No city route matches /wall`
2. Debug route success, both variants:
   - `http://127.0.0.1:5174/debug/wall`
   - `http://127.0.0.1:5174/debug/wall/`
   - Observed text on both began with `Null City Embassy letters between residents and their patrons` and rendered resident/wall content.
3. Attendee shell code still treats `/wall` as unknown:
   - [`/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/web/src/lib/routes.ts`](/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/web/src/lib/routes.ts:132) `isKnownCityRoute()` includes `/library`, `/story`, `/inbox`, etc., but not `/wall` or `/graveyard`.
   - [`/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/web/src/App.svelte`](/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/web/src/App.svelte:5974) renders `No city route matches {route}` when the route is not known.
4. Server/debug mapping still preserves the wall as a debug surface:
   - [`/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/server/src/static.ts`](/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/server/src/static.ts:10) maps `/debug/wall` and `/debug/wall/` to `wall/index.html`.
   - The same file marks `/wall` and `/wall/` as retired operations routes at [`static.ts`](/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/server/src/static.ts:54), returning `Legacy dashboard route moved under /debug.` when served directly by the BFF.
5. The dashboard UI still generates a public-event wall link through the debug path:
   - [`/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/web/src/App.svelte`](/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/web/src/App.svelte:412) builds Embassy links with `publicEventPath('/wall/', browserOrigin)`.
   - [`/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/web/src/lib/routes.ts`](/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/packages/web/src/lib/routes.ts:43) turns that into `/debug/wall` on the dashboard server origin.

### Result

The shared runtime is healthy enough to serve wall content, but attendee `/wall` is not a live city route on this build. This is not a trailing-slash mistake and not a runtime outage. It is a route-truth split:

- public attendee shell: `/wall` => 404 unknown city route
- debug/public-event shell: `/debug/wall` => working wall page

### Recommended next action

Keep this as a dashboard routing/truth issue, not a runtime issue. The next narrow follow-up should decide whether attendee `/wall` should be restored as a first-class city route or whether all human docs and links should stop implying a public `/wall` route exists.
