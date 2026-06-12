# QA Packet `qa-20260603-1658-debug-overview-regression-recheck`

- Time: 2026-06-03 17:01:42 CDT
- Marshal: Codex QA
- Classification: READ-ONLY
- Server repo SHA: `53b7761ddee492ebcfde706148fecf072191a908`
- Dashboard repo SHA: `a67f7b314cc749f1e70e61845c8a9e0cde78df25`

## Target

Recheck the live dashboard debug overview truth after earlier reports that
`/debug` stayed offline/empty while the shared Null City runtime was healthy.

## Runtime Stewardship / Safety

- Shared runtime owner remains the active Codex desktop thread per
  `docs/runtime-stewardship.md`.
- No restarts, mutations, AP/GP writes, resident commands, or service changes.
- Shell loopback networking from this sandbox returned `EPERM`, so live HTTP/UI
  verification used the in-app browser plus read-only controller CLIs.

## Orientation Snapshot

### Git / collision state

- Server branch: `agents/wip` tracking `origin/agents/wip`, behind `16`.
- Server dirty files before this packet:
  - `docs/agent-status.md`
  - `docs/issue-register.md`
  - `data/controller/storyteller/latest-frame.json`
  - several untracked `docs/capability-evidence/*.md` and `docs/qa/*.md`
- Dashboard branch: `codex/storyteller-overview-bff` tracking
  `origin/codex/storyteller-overview-bff`.
- Dashboard dirty files before this packet:
  - untracked `docs/qa/`

Because `docs/agent-status.md` and `docs/issue-register.md` were already dirty,
this packet intentionally avoided editing those coordination files.

### Runtime process / port state

Expected screen sessions present:

- `nullcity-infra`
- `nullcity-game`
- `nullcity-controller`
- `nullcity-dashboard-server`
- `nullcity-dashboard-web`

Expected listeners present:

- `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`

### Active residents

Read-only `npm run controller:status` at `2026-06-03T21:58:36.221Z` reported:

- `25` tracked residents
- `10` controller-held cohort residents
- `8` currently `ALIVE_ACTING`
- `2` currently `STUCK` (`res:agent`, `res:hans`)
- no controller health error (`HEALTH: ok`)

Read-only `npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible`
observed all `10` active cohort residents, with `9 OK / 1 WARN`. The only WARN
was `res:qa-trader` stuck in `follow_listen_hold`; no broad runtime outage was
indicated.

### qmd availability

- `qmd` not found in PATH during this packet.

## Evidence

### Source A: controller status / smoke prove a live runtime

- `npm run controller:status`
  - health probe OK (`3134ms`)
  - active actors included `res:qa-banker`, `res:qa-cook`, `res:qa-guardian`,
    `res:qa-scout`, `res:qa-social`, `res:qa-survivor`, `res:qa-trader`,
    `res:qa-woodcutter`
- `npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible`
  - `9 OK / 1 WARN`
  - recent successful actions/speech/effects across the active cohort

### Source B: attendee homepage hydrates from live fallback data

Using the in-app browser on `http://127.0.0.1:5174/` and waiting 12s:

- observed banner: `City overview unavailable; showing live resident fallback.`
- observed city alive card: `10 / 23 active`
- observed demo/story proof:
  - `duke-horacio` selected as attention target
  - Storyteller item `live-20260603204913`

This proves the dashboard web app can still surface live controller-derived
truth on the attendee route during this packet.

### Source C: `/debug` never hydrates and stays false-empty

Using the in-app browser on `http://127.0.0.1:5174/debug` and waiting 12s:

- page still showed `Loading dashboard state`
- cards stayed:
  - `GATEWAY offline`
  - `CONTROLLER quiet`
  - `ONLINE 0`
  - `RUNTIME 0`
- resident table stayed empty:
  - `No residents match the current filters`
- supporting panels stayed empty:
  - `No readiness checks reported`
  - `No recent events`
  - `No recent patron letters`

## Expected vs Observed

- Expected:
  - `/debug` should reflect the same live runtime availability already proven by
    controller status/smoke and by the attendee route fallback.
- Observed:
  - `/debug` remained fully false-empty after wait time, despite the runtime
    being live and the attendee dashboard showing `10 / 23 active`.

## Assessment

Regression still reproduces. This is a human-visible truth failure isolated to
the debug overview surface, not a shared runtime outage.

The earlier proposed issue `QA-20260603-091` should remain open or be created
once `docs/issue-register.md` is safe to edit. This packet adds a fresh
same-day reproduction against current runtime/controller evidence.

## Artifacts

- Browser screenshots captured during this packet in the Codex in-app browser:
  - attendee route `/`
  - debug route `/debug`
- CLI evidence:
  - `npm run controller:status`
  - `npm run controller:smoke -- --observe-seconds 15 --allow-recent-visible`

## Recommended next action

Dashboard/BFF owner should inspect the `/debug` data-loading path specifically,
not the shared runtime. The live attendee route already proves controller truth
is reachable somewhere in the current stack.
