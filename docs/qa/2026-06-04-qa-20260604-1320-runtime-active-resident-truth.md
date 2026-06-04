# QA Packet `qa-20260604-1320-runtime-active-resident-truth`

- Time: 2026-06-04 13:20:21 CDT
- Classification: READ-ONLY
- Scope: Runtime availability and active-resident truth only
- Commit: `53b7761ddee492ebcfde706148fecf072191a908`

## Why this packet

This cycle stayed inside the safest narrow slice available during orientation:
verify that the shared runtime is up, the expected screen sessions exist, the
controller reports a live cohort, and the current active residents still show
real action cadence.

I did not touch `docs/agent-status.md` or `docs/issue-register.md` because both
were already dirty in the shared `agents/wip` worktree.

## Orientation snapshot

- Server repo branch: `agents/wip` at `53b7761d`, behind `origin/agents/wip` by 35 commits
- Dashboard repo branch: `codex/storyteller-overview-bff` tracking `origin/codex/storyteller-overview-bff`
- Shared server dirty files: `docs/agent-status.md`, `docs/issue-register.md`
- Shared server untracked files include prior QA docs and `data/controller/storyteller/latest-frame.json`
- Dashboard repo has untracked `docs/qa/`
- Expected shared `screen` sessions present: `nullcity-infra`, `nullcity-game`, `nullcity-controller`, `nullcity-dashboard-server`, `nullcity-dashboard-web`
- Expected listeners present: `43591`, `43592`, `43594`, `43595`, `43596`, `43610`, `43611`, `8787`, `5174`
- `qmd` command: not available on PATH

## Evidence

### Controller status

Command:

```bash
npm run controller:status
```

Observed:

- `HEALTH: ok — probe ok (19840ms)`
- `residents=25 erroring=0`
- Active alive cohort reported by the controller:
  - `res:agent`
  - `res:hans`
  - `res:qa-banker`
  - `res:qa-cook`
  - `res:qa-guardian`
  - `res:qa-scout`
  - `res:qa-social`
  - `res:qa-survivor`
  - `res:qa-trader`
  - `res:qa-woodcutter`

### Live smoke

Command:

```bash
npm run controller:smoke -- --observe-seconds 30 --allow-recent-visible
```

Observed:

- `res:agent` OK, visible speech and successful movement
- `res:hans` OK
- `res:qa-woodcutter` OK, repeated successful actions/results
- `res:qa-cook` OK
- `res:qa-survivor` OK
- `res:qa-trader` OK, but mostly `follow_listen_hold`
- `res:qa-banker` OK
- `res:qa-scout` OK
- `res:qa-guardian` WARN: `no_recent_visible_activity,no_observed_visible_activity`
- `res:qa-social` WARN: `observed_no_action_decision_loop:follow_listen_hold`

Net result:

- Runtime is not dark.
- Controller and active resident cohort are live.
- Current read-only concern is behavior quality, not stack availability.

## Limits in this sandbox

Direct localhost GET probes to `43596`, `8787`, and `5174` failed from both
shell `curl` and Node `fetch` in this sandbox despite the ports listening on
the host. Because of that, this packet does **not** upgrade dashboard, wall,
inbox, or City API truth for this cycle.

## Outcome

- Safe target completed: yes
- Runtime availability: verified
- Active resident truth: verified from controller CLI plus live smoke
- Dashboard/controller JSON/API/browser truth: not verified this cycle from this sandbox
- Issue register update: skipped to avoid colliding with existing dirty shared docs

## Recommended next narrow QA target

`qa-20260604-<time>-dashboard-http-truth`

Use a browser-capable or unsandboxed localhost path to verify whether:

- `http://127.0.0.1:8787/api/overview`
- `http://127.0.0.1:43596/v1/wall/snapshot`
- `http://127.0.0.1:43596/v1/inbox?...`
- `http://127.0.0.1:8787/api/nullcity/heartbeat`

still agree with the live controller cohort, especially after the fresh smoke
warnings on `res:qa-guardian` and `res:qa-social`.
