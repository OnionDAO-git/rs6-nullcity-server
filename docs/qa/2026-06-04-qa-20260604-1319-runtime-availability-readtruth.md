# QA Packet `qa-20260604-1319-runtime-availability-readtruth`

- Timestamp: 2026-06-04 13:19 CDT
- Agent: QA Marshal
- Classification: READ-ONLY
- Target: Shared Null City runtime availability and public/API reachability
- Runtime owner: Codex in James's active desktop thread per `docs/runtime-stewardship.md`
- Server SHA: `53b7761d`
- Dashboard branch/SHA: `codex/storyteller-overview-bff` / not sampled in this packet

## Why this packet

Orientation found the shared local stack fully unreachable from the QA shell while persisted controller state still existed on disk. This is demo-breaking and safe to verify without mutating any service.

## Git state at capture

### Server repo

- Branch: `agents/wip`
- Upstream: `origin/agents/wip`
- Ahead/behind: `0 ahead`, `35 behind`
- Dirty tracked files: `docs/agent-status.md`, `docs/issue-register.md`
- Untracked collision-risk areas already present: `data/controller/storyteller/latest-frame.json`, multiple `docs/capability-evidence/*` and `docs/qa/*`

### Dashboard repo

- Branch: `codex/storyteller-overview-bff`
- Upstream: `origin/codex/storyteller-overview-bff`
- Ahead/behind: `0 ahead`, `0 behind`
- Dirty tracked files: none
- Untracked files: `docs/qa/*`

## Runtime/process evidence

Command: `screen -ls`

Observed:

- No screen sessions were present from this shell context.
- Expected names were absent: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`

Command: `lsof -nP -iTCP -sTCP:LISTEN | rg ':(43591|43592|43594|43595|43596|43610|43611|5174|8787)\\b'`

Observed:

- No listeners on expected Null City ports.

Command: `npm run controller:status --silent`

Observed:

- `HEALTH: UNKNOWN — no inference-health probe has run yet`
- `residents=25 erroring=0 generatedAt=2026-06-04T18:18:12.813Z`
- All 25 residents reported `OFFLINE`
- Current active residents: none

Tooling:

- `qmd` unavailable: `__QMD_NOT_FOUND__`

## Route/API reachability evidence

All probes below were READ-ONLY `curl` GET requests with `--max-time 3`.

| Surface | URL | Expected | Observed |
| --- | --- | --- | --- |
| Dashboard | `http://127.0.0.1:5174/` | HTML route responds | `curl: (7) Failed to connect` |
| Debug dashboard | `http://127.0.0.1:5174/debug` | HTML route responds | `curl: (7) Failed to connect` |
| Dashboard BFF | `http://127.0.0.1:8787/api/health` | JSON health responds | `curl: (7) Failed to connect` |
| Controller letters API | `http://127.0.0.1:43596/v1/health` | JSON health responds | `curl: (7) Failed to connect` |
| Wall/inbox read path | `http://127.0.0.1:43596/v1/inbox?human=demo@onion` | JSON inbox responds | `curl: (7) Failed to connect` |
| City API | `http://127.0.0.1:43611/api/nullcity/health` | JSON health responds | `curl: (7) Failed to connect` |

## Correlated conclusion

Two sources agree on the same state:

1. Process/port inspection shows no runtime screens and no listeners on the expected ports.
2. HTTP reachability fails for dashboard, controller, wall/inbox, and City API surfaces.

Persisted controller state is still readable, but that is historical disk truth, not live service truth. Current live availability should be treated as regressed for demo purposes until the runtime steward restores the stack.

## Issue linkage / handoff

- Existing likely owner row: `QA-20260531-057` (`P0`, runtime/game gateway)
- I did **not** update `docs/issue-register.md` because it already had unrelated dirty changes at capture time.
- Safe next action is steward review/restart, not QA mutation.

## Recommended next narrow QA target

After the shared stack is back up, run a read-only packet on `dashboard overview truth` to verify that online counts, resident cohort, and BFF health match controller/runtime evidence again.
