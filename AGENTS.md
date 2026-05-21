# Agent Guide

Keep this file short and action-oriented. Put detailed designs and task status in the docs linked below, not here.

## Mission

Build a modular SPARK-powered RuneScape resident for the 2006 RuneJS server. The default resident is `res:agent`; avoid adding new resident nicknames or lore names unless explicitly asked.

SPARK split:
- **SOUL**: authored identity and selected modules.
- **Kernel**: safety, scheduling, action submission, evidence, logs, budgets, persistence.
- **Modules**: reviewed in-repo intelligence/workflow capabilities. No arbitrary code from SOUL, memory, or remote URLs.

## Start Here

Before substantial autonomy, controller, dashboard, or agent behavior work, read:

1. `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`
2. `docs/superpowers/specs/2026-05-21-spark-faceted-module-system-design.md` and `docs/superpowers/plans/2026-05-21-spark-facets-implementation.md` for current SPARK facet work
3. `docs/human-decisions.md` for open James/OnionDAO choices and default assumptions
4. `docs/spark-module-authoring.md`, `docs/spark-module-experiments.md`, `docs/railgun-controller-deployment.md`, and `docs/controller-knowledge-runbook.md`
5. `docs/superpowers/specs/2026-05-20-runescape-game-skill-design.md` and `docs/superpowers/plans/2026-05-20-runescape-game-skill-implementation.md` when changing knowledge, prompts, or workflow availability
6. `feat/controller.md`, `feat/residents.md`, and `feat/runebench-agent-design.md` when changing resident design
7. `feat/runebench-systems-design.md` only as historical RuneBench analysis unless the roadmap points to a specific active item
8. `docs/superpowers/specs/2026-05-20-spark-module-system-design.md` and `docs/superpowers/plans/2026-05-20-spark-module-system-implementation.md` only for historical first-slice context
9. `../rs6-nullcity-residents-dashboard/SPEC.md` before dashboard work

The roadmap is the source of truth for active task status and next work. Older plans and RuneBench design notes are background unless the roadmap explicitly points to them as active.

When work maps to the roadmap, update the matching task as you start, finish, block, or defer it. For small fixes or unrelated maintenance, do not force roadmap churn; summarize clearly in the final note.

Until June 1, 2026, OnionDAO work is pre-launch development. Default to building fast with good design. Track Railgun, deployment, and secure-module questions in `docs/human-decisions.md`, but do not block local gameplay, dashboard, benchmark, or module progress on them unless the decision is marked Critical.

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

## Working Rules

- Prefer `rg`/`rg --files` for search.
- Use `apply_patch` for manual edits when your environment supports it.
- Do not revert unrelated dirty work; this repo often has active parallel edits.
- Keep docs and code ASCII unless the file already uses another charset.
- For broad design or risky changes, use subagents for review when available.
- For implementation, write or update focused tests first when practical.
- Keep `AGENTS.md` concise; link to docs instead of embedding long plans.

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
