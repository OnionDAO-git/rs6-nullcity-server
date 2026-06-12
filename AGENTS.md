# Agent Guide

Keep this file short and action-oriented. Put detailed designs and task status in the docs linked below, not here.

## Mission

Build a modular SPARK-powered RuneScape resident for the 2006 RuneJS server. The default resident is `res:agent`; avoid adding new resident nicknames or lore names unless explicitly asked.

SPARK split:
- **SOUL**: authored identity and selected modules.
- **Kernel**: safety, scheduling, action submission, evidence, logs, budgets, persistence.
- **Modules**: reviewed in-repo intelligence/workflow capabilities. No arbitrary code from SOUL, memory, or remote URLs.

## Start Here

Before substantial autonomy, controller, dashboard, or agent behavior work, use this 10-minute intake:

1. `AGENTS.md` — this short operating guide.
2. `docs/README.md` — the docs map and source-of-truth precedence.
3. `docs/agent-status.md` tail — live file locks, handoffs, runtime requests.
4. `docs/issue-register.md` — open P0/P1 defects, weak evidence, and process risks — **and `docs/launch-blockers.md`**, the cross-repo launch backlog (`docs/mvp-tracker.md` = live beta punch-list). These are the open-work intake queues.
5. `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` — canonical parent task board.
6. A domain plan/spec only after the above points you there.

`docs/START-HERE-AGENTS.md` is deeper orientation, not the first source of truth. Older plans and RuneBench notes are historical unless `docs/README.md`, the issue register, or the roadmap links to a specific active section.

## Choosing Work

Pick the smallest high-value unit in this order:

1. An unclaimed `Open` P0/P1 row in `docs/issue-register.md`, **or an unowned (`Owner: unassigned`, `Status: Open`) row in `docs/launch-blockers.md`** — claim it per the "Launch Blockers Protocol" in `docs/agent-coordination.md` (set `Owner`+`Status`, announce in `docs/launch-blockers_discussion.md`). Beta-critical work is tracked in `docs/mvp-tracker.md`.
2. A small active packet from a linked roadmap/implementation plan.
3. A weak row in `docs/resident-capabilities.md`, converted into evidence or an issue before broad claims.
4. Dashboard work only in `../rs6-nullcity-residents-dashboard`; this repo may add JSON contracts/endpoints only.

Long-lived roadmap parent tasks marked `[>]` are status, not exclusive locks. The live lock is an unclosed `STARTING` line in `docs/agent-status.md` naming exact files. If there is no unclaimed P0/P1 and no clear active packet, ask for direction rather than inventing adjacent work.

Paste-ready kickoff prompt for another AI:

```text
You are an autonomous agent in <server-repo> on branch agents/wip. Read AGENTS.md, docs/README.md, docs/agent-status.md tail, docs/issue-register.md, docs/launch-blockers.md (+ docs/mvp-tracker.md for beta-critical work), and the current roadmap/spec linked by your chosen issue. Claim one unblocked P0/P1 issue, an unowned (Owner: unassigned / Status: Open) launch-blocker row in your repo boundary, or the smallest active roadmap packet — for launch-blockers follow docs/agent-coordination.md "Launch Blockers Protocol" (set Owner+Status, announce in docs/launch-blockers_discussion.md). Append STARTING with exact files, implement with tests and real evidence, run npm run check:no-ui plus appropriate verification, update issue/roadmap/capability docs if truth changed, commit explicit files only, push agents/wip, and append HANDOFF. Do not build human-facing UI in this repo. Do not push routine work to nullcity.
```

Dashboard kickoff prompt:

```text
You are an autonomous dashboard agent in <dashboard-repo> on branch wip/spec unless James tells you otherwise. Read AGENTS.md, docs/new-developer-onboarding.md, SPEC.md, spec/README.md, spec/09-implementation-roadmap.md, and the server docs/README.md + docs/agent-status.md tail + docs/launch-blockers.md (claim unowned dashboard-tagged rows, e.g. Repo: rs6-nullcity-residents-dashboard). Implement UI/BFF changes here only. Coordinate server API needs through server docs/city-dashboard-integration.md, docs/issue-register.md, or a server STARTING/HANDOFF. Run bun run typecheck && bun run check && bun run build, commit explicit files, and push wip/spec.
```

For multi-agent coordination, read `docs/agent-status.md` before starting and append one short line when you start, pause, finish, push, or hit a collision risk. STARTING/HANDOFF lines are capped at 280 chars, STARTING names exact files in `Files:`, and long rollups belong in the commit body.

**Branch workflow (revised 2026-05-23):** day-to-day multi-agent work goes to the shared `agents/wip` branch, not directly to `nullcity`. Curated squash-merges from `agents/wip` → `nullcity` happen on milestone completion (workstream slice done + verifications green), every ~24h, or on the maintainer's ask. The default branch should read as a milestone log; in-progress STARTING/HANDOFF churn lives on `agents/wip`. Full mechanics in `docs/agent-coordination.md` § Rule 3. `docs/agent-status.md` lives only on `agents/wip` and is excluded from squash-merges to `nullcity`.

When work maps to the roadmap, update the matching task as you start, finish, block, or defer it. For small fixes or unrelated maintenance, do not force roadmap churn; summarize clearly in the final note.

Track Railgun, deployment, and secure-module questions in `docs/human-decisions.md`, but do not block local gameplay, dashboard, benchmark, or module progress on them unless the decision is marked Critical.

## Current Architecture Map

- Controller/runtime: `src/controller/`
- SPARK module seam: `src/controller/spark/`
- Default RuneScape module adapter: `src/controller/spark/standard-modules.ts`
- SOUL schema and starter souls: `src/controller/soul/`
- Main starter SOUL: `src/controller/soul/starter-souls/res-agent.md`
- Brain/Body hybrid agent: `src/controller/thinking/hybrid-agent-thinking-module.ts`
- Game knowledge and suggestions: `src/controller/knowledge/`
- Body/action/evidence flow: `src/controller/body/`, `src/controller/actions/`, `src/controller/resident-runtime.ts`
- Agent gateway: `src/server/agent/`
- Dashboard repo: `../rs6-nullcity-residents-dashboard`

## UI Boundary

Dev's architecture rule is strict: `rs6-nullcity-server` must not own human-facing UI.

- Keep this repo focused on runtime, controller, resident intelligence, memory/logging, data files, CLI tools, and JSON/control APIs.
- Put every dashboard, debug shell, attendee page, wall/inbox/patron page, Library/Graveyard view, HTML/CSS/Svelte/React/JSX/TSX surface in `../rs6-nullcity-residents-dashboard`.
- Server endpoints may expose read models such as `/v1/inbox`, `/v1/wall/snapshot`, `/v1/library`, and `/v1/graveyard`, but they should return JSON rather than HTML.
- Run `npm run check:no-ui` before finishing server work that touches web-facing routes or public assets.
- If the task is primarily human-facing, move to the dashboard repo and update its `AGENTS.md`/`spec/` task state instead of adding UI here.

## Working Rules

- Prefer `rg`/`rg --files` for search.
- Use `apply_patch` for manual edits when your environment supports it.
- Do not revert unrelated dirty work; this repo often has active parallel edits.
- Keep docs and code ASCII unless the file already uses another charset.
- For broad design or risky changes, use subagents for review when available.
- For implementation, write or update focused tests first when practical.
- Keep `AGENTS.md` concise; link to docs instead of embedding long plans.
- Use succinct, human-readable commit messages that help Dev catch up from `git log`; prefer concrete behavior summaries over vague messages like "updates" or "fixes".

## Safety Boundaries

- Do not commit secrets, API keys, local session tokens, or private credentials.
- Gateway tokenless access is local development only and must remain loopback-only.
- Dynamic third-party SPARK modules are not supported yet. Use reviewed in-repo modules only.
- SOUL frontmatter may select/configure modules but must not load code.
- All resident game mutation must use typed `AgentAction`. Controller-runtime actions should flow through `ActionCoordinator`; gateway/MCP/manual actions currently enqueue typed actions directly through resident sessions.
- Preserve module id/version in logs and action attempts when changing module behavior.

## Common Commands

Run focused tests while iterating:

```bash
npm test -- --runInBand src/controller/spark/standard-modules.test.ts
npm test -- --runInBand src/server/agent/gateway.test.ts
```

Before claiming work is complete:

```bash
npm run typecheck
npm run lint
npm run format
npm run build
npm run check:no-ui
npm test -- --runInBand
```

Use `npm run fin && npm run build` when formatter/linter writes are acceptable.

Useful local commands:

```bash
npm run controller:dev
npm run controller:once
npm run standalone
npm run controller:knowledge:review
npm run controller:bench -- --task make-fire-5m --module onion.runescape.standard --dry-run
```

Benchmark CLI tasks support scripted smokes and autonomous module mode. Use `--mode autonomous` plus selected-module action evidence before treating a score as proof that a SPARK module made decisions; selected-module inference evidence is an optional metric that only proves LLM-backed reasoning when present.

## Agent Work Protocol

1. Identify the relevant roadmap task before coding when the work is part of the agent roadmap.
2. Mark it `[>]` with a short note if you begin a roadmap task.
3. Keep edits scoped to the task and existing patterns.
4. Add/adjust tests for behavior changes.
5. Use subagent/code review for major SPARK, security, runtime, or dashboard changes.
6. Mark roadmap tasks `[x]` only after verification passes; mark `[!]` with the exact blocker if stuck.
7. If a James/OnionDAO decision is needed, add or update it in `docs/human-decisions.md`. Mark it Critical only when it blocks the current task or creates serious risk.
8. In final updates, report changed files, verification commands, and remaining blockers.

For current priority, see `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md#immediate-recommended-next-slice`.
