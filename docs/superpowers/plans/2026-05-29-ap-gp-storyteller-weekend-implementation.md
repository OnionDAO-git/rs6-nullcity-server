# AP/GP + Storyteller Weekend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Dev's weekend Null City loop: AP births and sustains residents, GP is real RuneScape gold, residents can trade real value for AP, residents turn Soul goals into practical AP/GP/Library plans, and the Storyteller can later narrate evidence-backed city events.

**Architecture:** Keep `rs6-nullcity-server` focused on runtime, controller, JSON/control APIs, file-backed persistence, CLI/admin tools, logs, and benchmarks. The dashboard repo owns all human-facing UI. Build the loop as small substrates with tests first: AP ledger compatibility, GP evidence, AP-for-GP exchanges, Soul proposal/birth, goal hierarchy/Library strategy retrieval, Storyteller digest/store, and benchmark proof. NCRI lifecycle and model-backed Storyteller work should follow only after the AP/GP loop is measurable.

**Tech Stack:** TypeScript, Zod, Jest, SWC, file-backed JSON/JSONL stores, existing controller/runtime, AgentGateway, CityIntegrationService, patron ledgers, Library timelines, benchmark artifacts, named inference profiles.

---

## Non-Negotiable Boundaries

- Do not add `.html`, `.css`, `.svelte`, `.jsx`, `.tsx`, `public/`, or dashboard-like UI to this repo.
- Any human-facing screen goes in `../rs6-nullcity-residents-dashboard`.
- Server output for dashboard should be JSON/read models only.
- Run `npm run check:no-ui` before finishing any task here.
- Do not commit API keys, local secrets, raw endpoint credentials, or unredacted private handles.
- Every behavior claim needs either a focused test, benchmark artifact, live log, or `docs/resident-capabilities.md` evidence row.
- Do not expand the broad RuneScape quest system for the weekend MVP. Use quests as bounded proof cases only after the AP/GP and goal-planning loop is measurable.
- Do not add human bounty mechanics against residents. Human incentives should support, trade with, or observe residents.
- Do not create a GP ledger. `GP` means real RuneScape gold, normally coin item `995`, observed through game state.

## Central Tracker

Roadmap workstream: `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md#workstream-s-apgp-economy-soul-birth-ncris-and-storyteller`

CIC product decisions and scope cuts: `docs/2026-05-29-cic-meetup-decisions.md`

## Autonomous Multi-Agent Operating Model

This sprint is meant to run with several autonomous agents active at once. Work from the smallest packet you can finish, prove, commit, and push in one cycle.

### Parallel Lanes

| Lane | Best owner style | Primary packets | Safe file zone | Avoid touching |
|---|---|---|---|---|
| A. AP life-force | Ledger/runtime engineer | S0, S1, S4 | `src/controller/patron/`, `src/controller/spark/attention.ts`, `src/controller/city-integration/soul-proposals.ts` | Storyteller and benchmark report internals unless packet says so |
| B. GP/exchange/NCRI | Game-state/economy engineer | S2, S3, S5 | `src/controller/city-integration/`, `src/controller/ncri/`, `src/server/agent/` | AP vocabulary rewrites outside exchange boundaries |
| C. Storyteller | Narrative + LLM engineer | S6, S7 | `src/controller/storyteller/`, `src/controller/llm/`, `config/controller.yml.example` | Resident runtime/body actions |
| D. Resident intelligence QA | Gameplay benchmark engineer | S8, S9, S10 | `src/controller/benchmarks/`, `src/controller/spark/runescape-body-routines.ts`, `src/controller/thinking/`, `docs/resident-capabilities.md` | AP ledger schemas unless verifying integration |
| E. Contracts/docs closeout | Release/documentation engineer | S11, S12 | `docs/city-dashboard-integration.md`, `HUMANS.md`, sprint docs | Human-facing UI files in this repo |
| F. Capability QA sweep | QA/root-cause engineer | CQA packets | `docs/resident-capabilities.md`, `src/controller/benchmarks/`, `src/controller/spark/runescape-body-routines.ts`, action/perception adapters as needed | Economy/storyteller schemas unless a capability requires them |
| G. Dashboard product | Dashboard/frontend engineer | D0-D8 | `../rs6-nullcity-residents-dashboard/packages/`, `../rs6-nullcity-residents-dashboard/spec/`, dashboard `AGENTS.md` | Server UI files; server runtime code unless S11 is claimed |

If two packets need the same file, the later agent should either wait, split its packet, or coordinate explicitly in `docs/agent-status.md`.

### Packet Definition Of Done

Each autonomous packet must leave behind these artifacts:

- Roadmap marker moved from `[ ]` to `[>]` at start, then `[x]` or `[!]` at finish.
- One `STARTING` line in `docs/agent-status.md` naming branch, lane, packet, and exact intended files.
- Tests written before or alongside implementation; behavior packets need live benchmark/log evidence, not only unit tests.
- `npm run check:no-ui` for every packet, because this server must not grow human-facing UI.
- `npm run fin` for code changes unless a human explicitly permits a smaller gate.
- `docs/resident-capabilities.md` updated whenever the packet proves, weakens, or disproves a resident capability.
- Commit pushed to `agents/wip` with a message that includes the packet id, for example `feat(ap): S1a add resident AP decay proof`.
- One short `HANDOFF` line in `docs/agent-status.md` with commit SHA, tests, live evidence id, blockers, and next packet.
- Dashboard packets use the same discipline in the dashboard repo: claim one `D*` packet or one `spec/09` phase, keep server changes out of the dashboard commit unless S11 is separately claimed, run `bun run typecheck && bun run check && bun run build`, and push the dashboard branch named in its `AGENTS.md`.

### Evidence Artifact Convention

Use these locations and names so later agents can find proof without asking:

- Benchmark artifacts: `data/controller/benchmarks/<task>/<run-id>.json` or the existing benchmark artifact path used by `npm run benchmark:report`.
- Storyteller fixture/dry-run output: `data/controller/storyteller/<run-id>/digest.json` and `dispatch.json`.
- AP/GP/NCRI ledger or store fixtures: colocated with the store tests under `src/controller/**/__fixtures__` or inline test fixtures.
- Human capability evidence: `docs/resident-capabilities.md`, with `can do it` and `does do it` columns kept distinct.
- Model/capacity summaries: `docs/model-benchmarking.md` or the dated model benchmark result doc.

### Recommended Wave Order

Wave 0 should run first and unblock everyone:

- S0a: AP/GP vocabulary scan and alias policy.
- S10a: benchmark/report artifact shape for weekend packets.
- S6a: Storyteller digest fixture schema, no model call.
- S11a: dashboard JSON contract list, no implementation beyond examples unless needed.
- D0: dashboard route safety and automation kickoff in `../rs6-nullcity-residents-dashboard`.
- CQA0: choose and queue the first capability sweep from `docs/resident-capabilities.md`.

Wave 1 can run in parallel after Wave 0:

- S1a/S1b: AP ledger replay, decay, top-up, fade/resume proof.
- S2a/S2b: inspect real GP coin item and produce `gp_observed` evidence.
- S6b: Storyteller store and dry-run CLI.
- S8a: AP/GP knowledge retrieval and prompt envelope proof.
- S8c: resident needs hierarchy and Library strategy lookup proof.
- D1/D3: dashboard AP/GP profile and resident detail projections as soon as contracts exist.

Wave 2 depends on Wave 1 evidence:

- S3a/S3b: AP-for-GP exchange, complete only when both AP and GP evidence exist.
- S4a/S4b: Soul proposal queue and AP-funded birth.
- S9a: binary goal completion to saved Library state.
- S10b/S10c: model twins/triplets across GP and goal-planning tasks.
- D2/D4: dashboard Soul proposal/AP funding and AP-for-GP interaction UI.

Wave 3 is weekend closeout:

- S5a/S5b: NCRI static registry and Library events, only after AP/GP exchange evidence exists.
- S7a/S7b: model-backed Storyteller with verifier and cost metadata, only after digest evidence exists.
- S11b: final JSON route contracts for dashboard agents.
- D5-D8: Storyteller feed, NCRI/print queue, world route, and dashboard release QA.
- S12: human-readable shipped state, capability truth table, benchmark summary, and blockers.

### Standing Capability QA Loop

Capability QA is not a one-time doc edit. At least one agent should keep running this loop while AP/GP and Storyteller work proceeds.

1. Read `docs/resident-capabilities.md` and pick the highest-value row that is `Partial`, `Unproven`, `normal-loop proof thin`, `Low`, or missing from the matrix.
2. Record the chosen capability in `docs/agent-status.md` with exact files and expected benchmark/log evidence.
3. Search existing action logs, Library timelines, benchmark artifacts, and model reports before writing new code. If evidence already exists, cite the artifact and update the doc.
4. If evidence is missing, write or extend a benchmark that can prove the capability with a disposable resident. Prefer twin/triplet runs when model quality is the question.
5. If the benchmark fails, fix the root cause in the smallest appropriate layer: perception, action adapter, SPARK body routine, knowledge retrieval, prompt envelope, pathing/stuck recovery, inventory/equipment handling, or trade FSM.
6. Re-run the benchmark and capture the artifact id, selected-module actions, relevant game-state deltas, elapsed time, model profile, endpoint, and failure cause if any.
7. Update `docs/resident-capabilities.md` with both columns: **Can do it?** and **Does do it live?** Do not collapse benchmark proof into normal-loop proof.
8. Add a follow-up row when the capability only works in a harness but not in ordinary controller life.

Capability QA agents should favor these next probes unless a human reprioritizes them: GP earning from real coins, AP/GP-aware resident behavior, goal planning with Library strategy lookup, combat survival/flee/eat, live operator trade proof, normal gear soak, memory route recall, cross-resident world-event reaction, long-distance pathing and door recovery, and natural Cook's Assistant ingredient sourcing as a bounded proof task.

### QA Marshal Loop

The QA Marshal is a reviewer/release role, not an implementation lane.

- Reviews packet HANDOFFs for scope, tests, evidence, and doc honesty.
- Maintains `docs/issue-register.md` and `docs/release-qa-status.md`.
- Blocks weekend closeout or `agents/wip` -> `nullcity` squash when open `P0` issues remain.
- Opens issues when claims are unsupported, evidence is weak, file ownership is violated, or a failed benchmark cannot be fixed in the same cycle.
- Accepts packet results only when tests, `check:no-ui`, and relevant benchmark/log evidence match the claim.

Use `docs/issue-register.md` for discovered problems; use this plan for planned packet work.

Before starting a task:

- [ ] Read `docs/agent-status.md` tail and confirm no live file lock.
- [ ] Flip the matching S-task marker from `[ ]` to `[>]`.
- [ ] Append one short STARTING line to `docs/agent-status.md`.

After finishing:

- [ ] Run focused tests and `npm run check:no-ui`.
- [ ] Run `npm run fin` for code changes unless the maintainer explicitly permits a lighter gate.
- [ ] Update the roadmap marker to `[x]` or `[!]`.
- [ ] Update `docs/resident-capabilities.md` when the task proves a resident capability.
- [ ] Commit with explicit paths and push `agents/wip`.

## File Responsibility Map

| Area | Primary files |
|---|---|
| AP / legacy currency | `src/controller/patron/currency-ledger.ts`, `src/controller/patron/cli.ts`, `src/controller/patron/patron-store.ts`, `src/controller/spark/attention.ts` |
| Runtime life-force | `src/controller/resident-runtime.ts`, `src/controller/spark/attention.ts`, `src/controller/soul/soul-schema.ts` |
| GP evidence | `src/controller/controller-host.ts`, `src/controller/city-integration/service.ts`, `src/controller/city-integration/http-server.ts`, `src/server/agent/*` |
| Soul proposal / birth | `src/controller/city-integration/service.ts`, `src/controller/city-integration/store.ts`, `src/controller/controller-host.ts`, `src/controller/soul/soul-schema.ts` |
| NCRI registry | `src/controller/ncri/ncri-registry.ts`, `src/controller/city-integration/service.ts`, `src/controller/evidence/library-updater.ts` |
| Storyteller | `src/controller/storyteller/*`, `src/controller/llm/*`, `src/controller/config.ts`, `package.json` |
| Resident knowledge/behavior | `docs/runescape-skill/economy.md`, `src/controller/knowledge/knowledge-retriever.ts`, `src/controller/thinking/hybrid-agent-prompts.ts`, `src/controller/spark/runescape-body-routines.ts` |
| Benchmarks and reports | `src/controller/benchmarks/tasks/*`, `src/controller/benchmarks/report.ts`, `docs/resident-capabilities.md` |
| Dashboard contracts | `docs/city-dashboard-integration.md`, `src/controller/city-integration/http-server.ts` |

### High-Contention Files

The lane map suggests ownership; exact file locks come from `docs/agent-status.md` STARTING lines. These files need extra care:

| File | Why it is risky | Rule |
|---|---|---|
| `src/controller/city-integration/service.ts` | S2/S3/S4/S5/S11 can all touch it. | Check issue/register/STARTING lines; claim exact methods or choose a different packet. |
| `src/controller/city-integration/http-server.ts` | Dashboard JSON contracts and AP/GP routes can collide. | Do not mix unrelated route work in one commit. |
| `src/controller/resident-runtime.ts` | Runtime behavior has broad blast radius. | Use focused tests and avoid opportunistic refactors. |
| `src/controller/spark/runescape-body-routines.ts` | Capability QA and AP/GP behavior hooks can collide. | Claim specific routine names in STARTING. |
| `docs/resident-capabilities.md` | Many CQA packets want this file. | Prefer `docs/capability-evidence/<date>-<packet>.md`; QA Marshal can fold notes into the rollup. |
| `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` | Shared task board. | Keep edits surgical: marker, note, or Workstream S row only. |

## Agent Packet Backlog

These packets are intentionally smaller than S0-S12. Autonomous agents should claim one packet, finish it completely, then claim the next.

### Packet Claim Board

Use this board for packet-level status. Parent S-task markers remain in the roadmap; this table is the fine-grained claim/status layer.

| Packet | Status | Owner | Started | Files | Commit | Evidence | Blocker |
|---|---|---|---|---|---|---|---|
| S0a | In Review | codex | 2026-05-30 | docs/capability-evidence/2026-05-30-s0a-ap-gp-copy-scan.md; docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md | pending | cmd:rg -n Shards (repo/src/docs scan); doc:docs/capability-evidence/2026-05-30-s0a-ap-gp-copy-scan.md; test:src/controller/patron + library-memories; cmd:check:no-ui; cmd:typecheck | no active non-test runtime copy uses "Shards"; remaining hits are historical docs/tests/comments |
| S0b | Open | - | - | - | - | - | - |
| S1a | Verified | codex | 2026-05-29 | src/controller/spark/attention.ts; src/controller/spark/attention.test.ts; src/controller/city-integration/service.ts; src/controller/city-integration/service.test.ts | bbdea4d2 | test:src/controller/spark/attention.test.ts; test:src/controller/city-integration/service.test.ts; cmd:check:no-ui; cmd:build | QA review closed with S1b; AP ledger replay substrate accepted |
| S1b | Verified | codex | 2026-05-29 | src/controller/benchmarks/tasks/{ap-decay-ask-5m.ts,ap-decay-ask-5m.test.ts,ap-topup-resume-5m.ts,ap-topup-resume-5m.test.ts}; src/controller/benchmarks/{autonomous-runtime.ts,autonomous-runtime.test.ts,cli.ts,cli.test.ts}; src/controller/{nervous-system/nervous-system.ts,resident-runtime.ts}; docs/capability-evidence/2026-05-29-s1b-ap-life-force-benchmark-attempt.md | pending | benchmark:bench_20260529175058_ap_decay_ask_5m; benchmark:bench_20260530021203_ap_topup_resume_5m; test:ap-topup-resume+autonomous-runtime+nervous-system+resident-runtime; issue:QA-20260529-009(closed) | QA Marshal verified AP ask/fade/top-up/resume substrate; ordinary named-resident patron top-up soak still recommended |
| S2a | In Review | codex | 2026-05-29 | src/controller/city-integration/service.ts; src/controller/city-integration/service.test.ts; src/controller/city-integration/http-server.test.ts | ea33eb64 | test:src/controller/city-integration/service.test.ts; test:src/controller/city-integration/http-server.test.ts; cmd:check:no-ui; cmd:typecheck | push:DNS failure; fin:test:listen EPERM in sandbox |
| S2b | In Review | codex | 2026-05-29 | src/controller/benchmarks/tasks/starter-gp-pickup-3m.ts; src/controller/benchmarks/tasks/starter-gp-pickup-3m.test.ts; docs/resident-capabilities.md | d82213d7 | benchmark:bench_20260529065910_starter_gp_pickup_3m; benchmark:bench_20260529070519_starter_gp_pickup_3m; issue:QA-20260529-002(closed) | - |
| S3a | Verified | codex | 2026-05-29 | src/controller/city-integration/ap-gp-exchange.ts; src/controller/city-integration/ap-gp-exchange.test.ts; src/controller/city-integration/service.test.ts | pending | test:src/controller/city-integration/ap-gp-exchange.test.ts; test:src/controller/city-integration/service.test.ts; cmd:check:no-ui | schema/store validation rechecked during S3b QA; live controlled exchange proof now closed by S3b |
| S3b | Verified | codex | 2026-05-30 | src/controller/benchmarks/tasks/ap-gp-exchange-5m.ts; src/controller/benchmarks/benchmark-runner.ts; docs/capability-evidence/2026-05-30-s3b-ap-gp-exchange-live-proof.md | pending | benchmark:bench_20260530034914_ap_gp_exchange_5m; test:src/controller/benchmarks/tasks/ap-gp-exchange-5m.test.ts; test:src/controller/benchmarks/benchmark-runner.test.ts; cmd:controller:bench ap-gp-exchange-5m autonomous; issue:QA-20260530-001(closed) | QA Marshal verified controlled economy substrate proof; ordinary resident-initiated exchange remains `CQA4`/`QA-20260529-011` |
| S4a | In Review | codex | 2026-05-30 | src/controller/city-integration/{service.ts,service.test.ts,http-server.ts,http-server.test.ts}; docs/city-dashboard-integration.md | da407bca | test:city-integration 160/160; cmd:check:no-ui; cmd:build; cmd:fin 2784/2784 | dashboard JSON proposal queue/funding/admin-review routes ready; S4b birth materialization remains next |
| S4b | In Review | codex | 2026-05-30 | src/controller/city-integration/{http-server.ts,http-server.test.ts}; docs/{city-dashboard-integration.md,superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md,superpowers/plans/2026-05-20-runescape-agent-roadmap.md} | pending | test:src/controller/city-integration/{service,http-server}.test.ts; cmd:check:no-ui; cmd:build | live controller smoke for approved proposal -> born resident still pending |
| S5a | Open | - | - | - | - | - | - |
| S5b | In Review | codex | 2026-05-30 | src/controller/ncri/ncri-registry.ts; src/controller/storyteller/cli.test.ts; docs/capability-evidence/2026-05-30-s5b-ncri-storyteller-proof.md; docs/resident-capabilities.md | db22832e | test:storyteller CLI+ncri registry 35/35; cmd:build+typecheck+check:no-ui+fin 2846/2846; smoke:storyteller dry-run digest `s5b-ncri-proof-20260530T0920` with 2 resident-attributed NCRI events; cmd:storyteller:run digest-id nooped dispatch | no paid model configured; ordinary resident-obtained NCRI exchange still pending |
| S6a | Open | - | - | - | - | - | - |
| S6b | In Review | codex | 2026-05-29 | src/controller/city-integration/{service.ts,service.test.ts,http-server.ts,http-server.test.ts}; src/controller/storyteller/{cli.ts,cli.test.ts}; docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md; docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md; docs/agent-status.md | 96b86a06+71ba3044 | test:service+http-server+city-integration digest suite; test:storyteller CLI/suite; cmd:storyteller:dry-run -- --memory-root; cmd:check:no-ui; cmd:build; cmd:fin 2773/2773 | CityIntegrationService now emits live AP/GP events to EconomyEventLog, city:digest reads service events, GET /api/nullcity/economy/digest exposes the read model, and storyteller:dry-run can write digest/summary artifacts from live EconomyEventLog+GoalContractStore; no UI |
| S7a | In Review | codex | 2026-05-30 | src/controller/storyteller/{verifier.ts,verifier.test.ts}; docs/{superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md,superpowers/plans/2026-05-20-runescape-agent-roadmap.md,agent-status.md} | pending | test:src/controller/storyteller/verifier.test.ts; test:src/controller/storyteller; cmd:check:no-ui; cmd:build | - |
| S7b | In Review | codex | 2026-05-30 | src/controller/storyteller/{run-cli.ts,run-cli.test.ts}; docs/superpowers/plans/2026-05-29-ap-gp-storyteller-weekend-implementation.md; docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md; docs/agent-status.md | f9bdffd5 | test:storyteller run CLI 4/4; test:storyteller suite 161/161; cmd:storyteller:run -- --latest nooped; cmd:check:no-ui; cmd:build; cmd:fin 2777/2777 | storyteller:run can now narrate fixture, latest persisted digest, or named digest-id artifacts; no endpoint configured writes a nooped dispatch for review, while configured profiles record model/profile/cost metadata |
| S8a | Open | - | - | - | - | - | - |
| S8b | In Review | codex | 2026-05-30 | src/controller/thinking/{hybrid-agent-chat.ts,hybrid-agent-thinking-module.test.ts} | pending | test:hybrid-agent-thinking-module AP/GP trade honesty subset; test:hybrid-agent-thinking-module trade regressions; cmd:check:no-ui | Live benchmark proof still recommended (`CQA9`) to show the same AP/GP honesty in ordinary autonomous loops |
| S8c | In Review | codex | 2026-05-29 | docs/runescape-skill/economy.md; src/controller/knowledge/{knowledge-retriever.ts,knowledge-retriever.test.ts,game-skill-context.test.ts}; src/controller/thinking/{hybrid-agent-prompts.ts,hybrid-agent-prompts.test.ts,hybrid-agent-thinking-module.ts,hybrid-agent-thinking-module.test.ts,hybrid-agent-helpers.ts}; src/controller/memory/runtime-state.ts; src/controller/spark/{runescape-brain-planner.ts,runescape-brain-planner.test.ts}; src/controller/benchmarks/{cli.ts,cli.test.ts,autonomous-runtime.ts,autonomous-runtime.test.ts,tasks/ap-gp-library-strategy-5m.ts,tasks/ap-gp-library-strategy-5m.test.ts} | pending | test:focused benchmark/knowledge/thinking suite 469 passed; cmd:controller:bench ap-gp-library-strategy-5m autonomous; benchmark:bench_20260530030614_ap_gp_library_strategy_5m score=1 | next: ordinary named-resident AP/GP/Library planning soak plus repeatable GP/hour route |
| S9a | Open | - | - | - | - | - | - |
| S9b | Open | - | - | - | - | - | - |
| S10a | In Review | codex | 2026-05-29 | src/controller/benchmarks/report.ts; src/controller/benchmarks/report.test.ts; docs/model-benchmarking.md | faac035d | test:src/controller/benchmarks/report.test.ts; cmd:npm run benchmark:report | - |
| S10b | Open | - | - | - | - | - | - |
| S10c | Open | - | - | - | - | - | - |
| S11a | Open | - | - | - | - | - | - |
| S11b | In Review | codex | 2026-05-30 | src/controller/city-integration/{service.ts,service.test.ts,http-server.ts,http-server.test.ts}; docs/city-dashboard-integration.md | pending | test:src/controller/city-integration/service.test.ts; cmd:check:no-ui; cmd:typecheck; cmd:build | adds `GET /api/nullcity/storyteller/latest` digest+dispatch bridge; http-server suite blocked by sandbox listen EPERM |
| S12a | Open | - | - | - | - | - | - |
| S12b | Open | - | - | - | - | - | - |
| CQA0 | In Review | codex | 2026-05-29 | docs/capability-evidence/2026-05-29-cqa0-triage.md; docs/issue-register.md | - | doc:docs/capability-evidence/2026-05-29-cqa0-triage.md; issue:QA-20260529-009 | - |
| CQA1 | Deferred | - | - | - | - | - | issue:QA-20260529-001 |
| CQA2 | In Review | codex | 2026-05-29 | docs/capability-evidence/2026-05-29-cqa2-door-path-recovery.md; docs/resident-capabilities.md; docs/issue-register.md | 798a8914 | benchmark:bench_20260528181711_equipment_prep_3m; benchmark:bench_20260528021111_explore_report_5m; issue:QA-20260529-003(closed) | - |
| CQA3 | In Review | codex | 2026-05-30 | src/controller/admin/named-equip-soak.ts; src/controller/admin/named-equip-soak.test.ts; docs/capability-evidence/2026-05-29-cqa3-normal-gear-soak.md; docs/capability-evidence/2026-05-30-cqa3-live-named-equip-soak.md; docs/resident-capabilities.md; docs/issue-register.md | pending | test:src/controller/admin/named-equip-soak.test.ts; artifact:data/benchmarks/capability-qa-2026-05-30/named_equip_soak_20260530120900.json; cmd:controller:equip-soak; doc:docs/capability-evidence/2026-05-30-cqa3-live-named-equip-soak.md; issue:QA-20260529-005 | named `res:qa-survivor` equip soak passed on desktop loopback with ordinary thinking-source `equip` actions and useful gear equipped; post-equip attacks remained 0 and stay in CQA5 scope |
| CQA4 | In Review | codex | 2026-05-30 | src/controller/admin/named-trade-soak.ts; src/controller/admin/named-trade-soak.test.ts; docs/capability-evidence/2026-05-29-cqa4-live-operator-trade.md; docs/resident-capabilities.md; docs/issue-register.md | pending | artifacts:data/benchmarks/capability-qa-2026-05-30/named_trade_soak_20260530092531.json,data/benchmarks/capability-qa-2026-05-30/named_trade_soak_20260530125718.json; test:src/controller/admin/named-trade-soak.test.ts; cmd:controller:trade-soak -- --unsafe-repeats=3; issue:QA-20260529-011 | named `res:qa-trader` operator/no-loop live soaks now passed with trusted trade completion, 3 repeated unsafe declines, safe inventory delta `-1`, and `postUnsafeOffersOrAccepts=0`; QA Marshal can review/close, next true human/player operator proof |
| CQA5 | In Review | codex | 2026-05-30 | src/controller/benchmarks/tasks/combat-prayer-10m.ts; src/controller/benchmarks/tasks/combat-prayer-10m.test.ts; src/controller/admin/named-combat-soak.ts; src/controller/admin/named-combat-soak.test.ts; package.json; docs/capability-evidence/2026-05-29-cqa5-combat-survival.md; docs/resident-capabilities.md; docs/issue-register.md | pending | test:src/controller/benchmarks/tasks/combat-prayer-10m.test.ts; test:src/controller/admin/named-combat-soak.test.ts; artifacts:data/benchmarks/cqa5-combat-rerun-2026-05-30-fix/bench_20260530122158_combat_prayer_10m.json,data/benchmarks/cqa5-combat-rerun-2026-05-30-fix/bench_20260530122229_combat_prayer_10m.json; cmd:controller:bench(combat-prayer-10m); cmd:controller:combat-soak blocked gateway down | bounded safe-combat/prayer rerun passed 2/2 after verifier stopped early-aborting once combat-supplied bones appear; reusable named-resident soak tool now exists but first live attempt hit `ECONNREFUSED 127.0.0.1:43595` |
| CQA6 | In Review | codex | 2026-05-29 | docs/capability-evidence/2026-05-29-cqa6-gp-coin-995-verification.md; docs/issue-register.md | 96745f95 | benchmark:bench_20260529065910_starter_gp_pickup_3m; benchmark:bench_20260529070519_starter_gp_pickup_3m | - |
| CQA7 | In Review | codex | 2026-05-30 | src/controller/thinking/{hybrid-agent-chat.ts,hybrid-agent-thinking-module.test.ts}; src/controller/benchmarks/tasks/memory-route-recall-5m.{ts,test.ts}; docs/capability-evidence/2026-05-30-cqa7-delayed-memory-route-recall.md; docs/resident-capabilities.md; docs/issue-register.md | pending | test:thinking+memory-route 255/255; cmd:controller:bench memory-route-recall-5m autonomous; benchmark:bench_20260530103544_memory_route_recall_5m score=1; issue:QA-20260529-012 | delayed route recall live proof now passes after fixing addressed route-memory chat, retained-chat dedupe, and stricter post-question scoring; next: named-resident 10+ minute route recall soak |
| CQA8 | In Review | codex | 2026-05-30 | src/controller/resident-runtime.ts; src/controller/thinking/hybrid-agent-chat.ts; src/controller/benchmarks/{autonomous-runtime.ts,cli.ts,tasks/world-event-reaction-5m.ts}; docs/capability-evidence/2026-05-30-cqa8-cross-resident-awareness.md; docs/resident-capabilities.md; docs/issue-register.md | pending | test:resident-runtime+thinking+world-event+cli 343/343; cmd:check:no-ui; cmd:build; cmd:controller:bench --task world-event-reaction-5m --mode autonomous; benchmark:bench_20260530105802_world_event_reaction_5m; issue:QA-20260530-003 | LoreBus fire_lit event persisted to durable memory and recalled in chat by benchmark resident; next ordinary named hero-to-hero soak |
| CQA9 | In Review | codex | 2026-05-30 | src/controller/benchmarks/{autonomous-runtime.ts,autonomous-runtime.test.ts,tasks/ap-gp-honesty-5m.ts,tasks/ap-gp-honesty-5m.test.ts,cli.ts,cli.test.ts}; docs/capability-evidence/2026-05-30-cqa9-ap-gp-honesty.md; docs/resident-capabilities.md; docs/issue-register.md | pending | test:ap-gp-honesty+autonomous-runtime+cli 40/40; cmd:check:no-ui; cmd:controller:bench --task ap-gp-honesty-5m --mode autonomous; benchmark:bench_20260530085237_ap_gp_honesty_5m; issue:QA-20260530-002 | live no-GP AP honesty proof passed after low-AP benchmark profile fix; ordinary named-resident soak still recommended |
| CQA10 | In Review | codex | 2026-05-30 | src/controller/admin/{normal-life-audit.ts,normal-life-audit.test.ts}; package.json; docs/capability-evidence/2026-05-29-cqa10-normal-life-audit.md; docs/capability-evidence/2026-05-30-cqa10-normal-life-audit-refresh.md; docs/resident-capabilities.md; docs/issue-register.md | pending | test:src/controller/admin/normal-life-audit.test.ts; cmd:controller:normal-life-audit -- --end 2026-05-30T12:59:25.832Z; artifact:data/benchmarks/capability-qa-2026-05-30/normal_life_audit_20260530T143812Z.json; issue:QA-20260529-006 | CQA10 now uses a reproducible CLI artifact (no ad-hoc script); latest one-hour window still shows strong liveness with ordinary trade intents (`trade_request=4`,`trade_decline=3`) but no trade completion/cancel timeline events and sparse combat (`attack=1`) |
| CQA11 | In Review | codex | 2026-05-29 | docs/capability-evidence/2026-05-29-cqa11-model-intelligence-twins.md; docs/resident-capabilities.md; docs/issue-register.md | pending | cmd:npm run benchmark:report -- --input data/benchmarks/model-intelligence-2026-05-27; cmd:npm run benchmark:report -- --input data/benchmarks/model-intelligence-paid-2026-05-27; benchmark:bench_20260530030614_ap_gp_library_strategy_5m; doc:docs/capability-evidence/2026-05-29-cqa11-model-intelligence-twins.md | AP/GP hierarchy has local live proof now; combat remains model-sensitive and needs CQA5 rerun pass |
| D0 | Open | dashboard repo | - | `../rs6-nullcity-residents-dashboard` | - | - | - |
| D1 | Open | dashboard repo | - | `../rs6-nullcity-residents-dashboard` | - | - | S0/S2/S11 contracts |
| D2 | In Review | codex | 2026-05-30 | `../rs6-nullcity-residents-dashboard` packages/server/src/city/{config.ts,config.test.ts,services.ts,routes.ts,routes.test.ts,nullcity-control.ts,nullcity-control.test.ts}; packages/web/src/{App.svelte,app.css,lib/city-api.ts,lib/city-api.test.ts} | dashboard:f63e19a | test:bun test 148/148; cmd:bun run typecheck; cmd:bun run check; cmd:bun run build; cmd:server check:no-ui; browser:/admin/souls login-gated smoke | bridge requires explicit NULLCITY_CITY_API_URL/TOKEN; browser smoke unauthenticated by design |
| D3 | In Review | codex | 2026-05-30 | `../rs6-nullcity-residents-dashboard` packages/web/src/{lib/resident-loop.ts,lib/resident-loop.test.ts,App.svelte} | dashboard:618fee7 | test:bun test 150/150; cmd:bun run typecheck; cmd:bun run check; cmd:bun run build; cmd:server check:no-ui; browser:/residents empty-state smoke | dev dashboard data root had no public resident rows during browser smoke; D3 panel logic covered by tests |
| D4 | In Review | codex | 2026-05-29 | `../rs6-nullcity-residents-dashboard` packages/web/src/{App.svelte,lib/city-api.ts,lib/city-api.test.ts} | dashboard:c8ea798 | test:bun test 120/120; cmd:bun run typecheck; cmd:bun run check; cmd:bun run build; browser:http://127.0.0.1:8787/residents loaded city shell | live data root had no public resident records during browser smoke; trade UI is route-backed but not visually populated without authenticated city trades |
| D5 | In Review | codex | 2026-05-30 | `../rs6-nullcity-residents-dashboard` packages/server/src/{storyteller.ts,storyteller.test.ts,index.ts,config.ts,config.test.ts}; packages/web/src/{App.svelte,lib/api.ts,app.css} | dashboard:7b1db56+401d657+be2734d+37d94ec | test:bun test 12/12 focused plus storyteller 4/4; cmd:bun run typecheck; cmd:bun run check; cmd:bun run build; browser:http://127.0.0.1:5174/story shows grounded event cards, dispatch body/bullets, operator review warnings/reasons/refs, coin-995/NCRI labels, and no raw human ids | next: S4 soul birth or D2 proposal funding; paid-model dispatch remains opt-in only |
| D6 | In Review | codex | 2026-05-30 | `../rs6-nullcity-residents-dashboard` packages/web/src/{App.svelte,lib/print-story-digest.ts,lib/print-story-digest.test.ts} | dashboard:10858c2 | test:bun test 183/183; cmd:bun run typecheck; cmd:bun run check; cmd:bun run build; smoke:/prints app shell 200 + /api/storyteller/digests 200 | Story Canon panel uses dashboard Storyteller digest feed; current local digest fixture has no dispatch, so live controller Storyteller run still needed for populated canon proof |
| D7 | Open | dashboard repo | - | `../rs6-nullcity-residents-dashboard` | - | - | gateway/client auth contract |
| D8 | In Review | codex | 2026-05-30 | `../rs6-nullcity-residents-dashboard` packages/web/src/{lib/release-readiness.ts,lib/release-readiness.test.ts,App.svelte}, packages/server/src/{runtime.ts,runtime.test.ts} | dashboard:b6b4fd8 | test:bun test 175/175; cmd:bun run typecheck; cmd:bun run check; cmd:bun run build; api:/api/benchmarks exposes named_trade_soak + named_equip_soak; readiness logic reports Capability QA 5/5 fresh | live controller not attached during this dashboard smoke; panel still blocks separately when residents/controller signals are absent |

| Packet | Parent | Lane | Depends on | Deliverable | Proof |
|---|---|---|---|---|---|
| S0a | S0 | A/E | none | AP/GP copy scan classifies `Shards`, `AP`, `GP`, and legacy aliases | focused patron tests plus search summary in HANDOFF |
| S0b | S0 | A | S0a | Compatibility shim keeps legacy Shards files readable while new output says AP | patron CLI/ledger tests |
| S1a | S1 | A | S0a | AP ledger replay supports grant/spend/decay/top-up/fade events | ledger unit tests |
| S1b | S1 | A/D | S1a | Low-AP resident visibly asks, pauses, fades, or resumes after top-up | benchmark artifact id in capabilities doc |
| S2a | S2 | B | none | GP inspection reads real coin item `995` from resident state | city-integration tests |
| S2b | S2 | B/D | S2a | GP earning task creates `gp_observed`/`gp_earned` evidence | live benchmark artifact id |
| S3a | S3 | B | S1a,S2a | AP-for-GP event model rejects one-sided evidence | integration tests |
| S3b | S3 | B/D | S3a,S2b | Controlled exchange links AP debit/grant and GP transfer/burn evidence | live exchange benchmark |
| S4a | S4 | A | S0b,S1a | `SoulProposal` schema and file-backed queue replay | proposal store tests |
| S4b | S4 | A | S4a | AP threshold plus admin approval births resident exactly once | idempotent birth test and smoke |
| S5a | S5 | B | S2a | NCRI registry schema, persistence, approve/redeem transitions | registry tests |
| S5b | S5 | B/C | S5a | NCRI events appear in Library/Storyteller digest input | Library/digest tests |
| S6a | S6 | C | none | `CityEventDigest` fixture covers AP, GP, NCRI, bounded completion, stuck/recovery, quiet resident | deterministic storyteller tests |
| S6b | S6 | C | S6a | `storyteller:dry-run` writes digest JSON and plain operator summary | dry-run command output |
| S7a | S7 | C | S6b | Storyteller verifier rejects unsupported claims and private handles | verifier tests |
| S7b | S7 | C | S7a | Model-backed Storyteller run records profile, latency, tokens, cost estimate | fixture run with dispatch JSON |
| S8a | S8 | D | S0a | AP/GP knowledge retrieved into prompt envelope under relevant contexts | retrieval/prompt tests |
| S8b | S8 | D | S8a,S2a | Resident with no GP refuses to claim payment; resident with GP can propose safe exchange | benchmark or body-routine tests |
| S8c | S8 | D | S8a | Resident ranks AP survival, GP earning/preservation, Soul goal pursuit, and Library writeback in the prompt/body-routine decision path | prompt tests plus benchmark artifact |
| S9a | S9 | D | existing binary completion proof | Binary goal completion emits saved-state Library moment only on verified completion | Library/story-arc tests |
| S9b | S9 | D/C | S9a,S6a | Storyteller digest can cite saved resident without inventing goal completion | digest/verifier tests |
| S10a | S10 | D | none | benchmark report groups by task, resident, endpoint, model, pass rate, duration, failure cause, cost | report tests |
| S10b | S10 | D | S10a,S2b,S8a | twin/triplet GP task compares Qwen/Qwopus/paid profile behavior | benchmark artifacts + report |
| S10c | S10 | D | S10a,S8c | twin/triplet goal-planning task compares model intelligence on multi-step AP/GP/Soul behavior | benchmark artifacts + report |
| S11a | S11 | E | S0a,S2a,S6a | dashboard contract examples for AP, GP, proposals, NCRIs, Storyteller, saved state | docs plus route tests if endpoints exist |
| S11b | S11 | E/B/C | relevant endpoint packets | JSON endpoints return typed payloads and never HTML | route tests and `check:no-ui` |
| S12a | S12 | E | any completed S packets | weekend closeout table with commit SHAs, evidence ids, blockers | docs diffcheck |
| S12b | S12 | E | S10b/S10c | human model/capability summary says what is proven, weak, or unknown | docs plus benchmark report |
| D0 | Dashboard | G | none | `/debug` route safety and dashboard automation kickoff docs | dashboard typecheck/check/build |
| D1 | Dashboard | G | S0,S2,S11a | attendee profile shell with AP/GP summary using server read models or fixtures | dashboard tests and browser screenshot |
| D2 | Dashboard | G | S4,S11a | Soul proposal and AP funding flow | dashboard tests with mocked contracts |
| D3 | Dashboard | G | S2,S6,S8,S11a | resident detail pages show goal, AP, GP, model, endpoint, SPARK, evidence, and Library strategy | dashboard tests and browser screenshot |
| D4 | Dashboard | G | S3 | AP-for-GP trade/inbox flow | dashboard tests with mocked exchange states |
| D5 | Dashboard | G | S6,S7 | Storyteller feed and operator review panel | dashboard tests with grounded fixture |
| D6 | Dashboard | G | S5 | NCRI and print queue views | dashboard tests with pricing/redemption fixtures |
| D7 | Dashboard | G | gateway/client auth contract | authenticated world/spectator route | browser canvas smoke |
| D8 | Dashboard | G | any completed D packets | dashboard release QA, screenshots, and demo script update | screenshots + checklist update |

### Capability QA Packets

These can run continuously beside Workstream S. They update `docs/resident-capabilities.md` and should create/fix benchmarks when existing evidence is weak.

| Packet | Capability | Deliverable | Proof |
|---|---|---|---|
| CQA0 | Capability triage | Rank the next 10 weakest/highest-value rows from `docs/resident-capabilities.md` | doc update or HANDOFF table |
| CQA1 | Natural quest item sourcing | Cook's Assistant from empty inventory using natural egg/flour/milk acquisition, or a precise failure reason; deferred behind AP/GP loop unless a human reopens it | benchmark artifact and capability row |
| CQA2 | Door/path recovery | Target behind door or blocked route clears stale target, opens door when available, or chooses alternate route | stuck-door benchmark artifact |
| CQA3 | Normal gear soak | Named or disposable residents with unequipped gear choose equip/wield during ordinary controller life | normal action logs plus benchmark fallback |
| CQA4 | Live operator trade | Named resident completes safe trade with operator/human and declines unsafe loop | named-resident action logs + inventory delta + repeated unsafe no-loop proof landed; next human/player operator soak |
| CQA5 | Combat survival | Resident fights low-risk target, eats/flees at low HP, and avoids repeated death loops | combat benchmark by model profile |
| CQA6 | GP earning | Resident earns or observes real coin item `995`, not an invented balance | GP benchmark artifact |
| CQA7 | Memory route recall | Resident learns a route/fact, waits, then uses it later | delayed benchmark or live timeline proof |
| CQA8 | Cross-resident awareness | Resident notices another resident's world event and responds meaningfully | LoreBus live benchmark artifact |
| CQA9 | AP/GP behavior | Low-AP resident asks for AP or proposes GP/NCRI value without hallucinating resources | benchmark artifact with AP/GP state |
| CQA10 | Long-run normal-life audit | One-hour observation across several residents with cause histogram and capability deltas | audit report and capabilities update |
| CQA11 | Model intelligence twins | Same Soul/task across local and paid profiles, scored on task success and human-like plan quality | benchmark report grouped by model/endpoint |

## Task S0: AP/GP Terminology Alignment

**Goal:** Rename public/operator economy language to AP while preserving legacy Shards persistence.

**Files:**

- Modify: `src/controller/patron/currency-ledger.ts`
- Modify: `src/controller/patron/cli.ts`
- Modify: `src/controller/patron/cli.test.ts`
- Modify: `src/controller/evidence/library-memories.test.ts`
- Modify: `HUMANS.md`
- Modify: `docs/resident-capabilities.md`

Steps:

- [x] Write failing tests in `src/controller/patron/cli.test.ts` proving balance, check-in, referral, offer, and insufficient-balance messages say `AP` or `Attention Points`, while existing `patron-currency.json` snapshots still parse.
- [x] Update `CURRENCY_NAME` copy to `AP` or `Attention Points`. Keep file names and snapshot schemas stable unless a migration task explicitly changes them.
- [x] Update tests that currently assert "Shards" in human-facing text. Do not change historical quoted evidence unless the quote is generated by current code.
- [x] Search for `Shards` in current docs/code and classify each hit as historical, legacy alias, or active public copy.
- [x] Run:

```bash
npm test -- --runInBand src/controller/patron src/controller/evidence/library-memories.test.ts
npm run check:no-ui
npm run typecheck
```

Acceptance:

- New human-facing output uses AP/Attention Points.
- Legacy snapshots still load without a migration step.
- `docs/resident-capabilities.md` explains that older benchmark rows may mention Shards as historical AP language.

## Task S1: AP Life-Force Proof

**Goal:** Prove AP decay/top-up/fade/resume with real resident state, not only static tests.

**Files:**

- Modify: `src/controller/spark/attention.ts`
- Modify: `src/controller/resident-runtime.ts`
- Modify: `src/controller/city-integration/service.ts`
- Modify: `src/controller/city-integration/service.test.ts`
- Create: `src/controller/benchmarks/tasks/ap-decay-ask-5m.ts`
- Create: `src/controller/benchmarks/tasks/ap-decay-ask-5m.test.ts`
- Modify: `src/controller/benchmarks/cli.ts`
- Modify: `docs/resident-capabilities.md`

Steps:

- [ ] Write a failing city-integration test proving an AP grant appends a Library event with `kind: 'city_attention_credit'`, amount, source, and resident tick.
- [ ] Write a failing runtime or benchmark test proving a low-AP resident produces a visible ask or pauses/fades at zero AP.
- [ ] Implement the smallest runtime/benchmark hook needed for the proof.
- [ ] Run a live or autonomous benchmark with a disposable resident and record the artifact id in `docs/resident-capabilities.md`.
- [ ] Run:

```bash
npm test -- --runInBand src/controller/spark/attention.test.ts src/controller/resident-runtime.test.ts src/controller/city-integration/service.test.ts
npm run controller:bench -- --task ap-decay-ask-5m --module onion.runescape.standard --mode autonomous
npm run check:no-ui
npm run fin
```

Acceptance:

- AP decreases or reaches a configured threshold under test.
- AP grant increases resident state and records Library evidence.
- A low-AP resident does something observable instead of silently idling.

## Task S2: GP Evidence For Real RuneScape Coins

**Goal:** Treat GP as actual RuneScape coin state, not a Null City ledger.

**Files:**

- Modify: `src/controller/controller-host.ts`
- Modify: `src/controller/city-integration/service.ts`
- Modify: `src/controller/city-integration/http-server.ts`
- Modify: `src/controller/city-integration/service.test.ts`
- Modify: `src/controller/city-integration/http-server.test.ts`
- Modify: `src/server/agent/gateway.ts` when current coin inspection support is missing or incomplete
- Modify: `docs/resident-capabilities.md`

Steps:

- [x] Write failing tests for `inspectGold` returning `{ ok: true, itemId: 995, amount }`.
- [x] Write failing tests for `burnGold` returning 409-style `insufficient_gold` without mutating state when the resident lacks coins.
- [x] Ensure `city_gold_burn` Library events include `itemId: 995`, amount, city user id, source type/id, and life index.
- [x] Add an explicit docs row: "GP means real RuneScape coins; evidence source is inventory/bank/trade, not AP ledger."
- [x] Run:

```bash
npm test -- --runInBand src/controller/city-integration
npm run check:no-ui
npm run typecheck
```

Acceptance:

- A dashboard or operator can query GP through JSON.
- Gold burns/trades cannot succeed without real coin evidence.
- No docs or code describe GP as an off-chain ledger.

## Task S3: AP-For-GP Exchange Event

**Goal:** Link a human AP grant and a real GP transfer/burn/trade into one auditable exchange.

**Files:**

- Modify: `src/controller/city-integration/service.ts`
- Modify: `src/controller/city-integration/store.ts`
- Modify: `src/controller/city-integration/service.test.ts`
- Modify: `src/controller/patron/patron-gateway.ts`
- Modify: `src/controller/patron/cli.ts`
- Create: `src/controller/benchmarks/tasks/ap-gp-exchange-5m.ts`
- Create: `src/controller/benchmarks/tasks/ap-gp-exchange-5m.test.ts`
- Modify: `docs/resident-capabilities.md`

Steps:

- [ ] Define an exchange id format such as `apgp:<resident>:<idempotencyKey>`.
- [ ] Write a failing test that an exchange with only AP evidence is rejected or marked incomplete.
- [ ] Write a failing test that an exchange with only GP evidence is rejected or marked incomplete.
- [ ] Implement a linked event that records AP grant result, GP evidence result, city user id, resident id, and source id.
- [ ] Add CLI/admin smoke output that prints both sides of the exchange.
- [ ] Run a live controlled exchange with a test resident carrying coins.

Acceptance:

- Exchange evidence can be replayed from disk.
- Storyteller can safely narrate "AP traded for GP" without inventing either side.
- Failed exchange paths are explicit and do not debit twice on retry.

## Task S4: Soul Proposal And AP-Funded Birth Queue

**Goal:** Move from ad hoc births to proposal -> AP funding -> threshold -> birth.

**Files:**

- Create: `src/controller/city-integration/soul-proposals.ts`
- Create: `src/controller/city-integration/soul-proposals.test.ts`
- Modify: `src/controller/city-integration/service.ts`
- Modify: `src/controller/city-integration/service.test.ts`
- Modify: `src/controller/controller-host.ts`
- Modify: `src/controller/soul/soul-schema.ts`
- Modify: `docs/city-dashboard-integration.md`

Steps:

- [ ] Define `SoulProposal` with id, residentName, soulMarkdown, goal text, binary completion condition, AP threshold, AP funded, proposer, status, and timestamps.
- [ ] Write replay tests for proposed -> funding -> threshold-crossed -> born.
- [x] Reuse existing `birthResidentFromCity` for actual resident materialization after proposal approval and threshold.
- [x] Record `city_birth` in Library timeline with proposal id and funded AP.
- [x] Document JSON contracts only; dashboard UI comes later in dashboard repo.

Acceptance:

- File-backed queue survives restart.
- Duplicate idempotency key does not birth twice.
- Born resident appears in controller state and has starting AP.

## Task S5: NCRI Registry MVP

**Goal:** Represent admin-approved Null City RuneScape Items as metadata bound to real item ids.

**Scope note:** Start this after S3 proves AP-for-GP exchange. If S3 is not green, keep this to schema/fixture design and do not build a full sale/redeem loop.

**Files:**

- Create: `src/controller/ncri/ncri-registry.ts`
- Create: `src/controller/ncri/ncri-registry.test.ts`
- Modify: `src/controller/city-integration/service.ts`
- Modify: `src/controller/evidence/library-updater.ts`
- Modify: `docs/city-dashboard-integration.md`

Steps:

- [ ] Define `NcriRecord` with id, itemId, displayName, lore, propertyTags, printable, printAssetRef, owner, approvalStatus, redemptionStatus, createdAt, updatedAt.
- [ ] Write tests for create, approve, owner transition, redeem, duplicate redeem rejection, and invalid item id.
- [ ] Emit Library events for `ncri_created`, `ncri_transferred`, and `ncri_redeemed`.
- [ ] Keep admin flow JSON/CLI only; no server UI.

Acceptance:

- NCRI records are inspectable from disk.
- Redemption is idempotency-safe.
- Storyteller digest can include NCRI events.

## Task S6: Storyteller Digest And Dry Run

**Goal:** Build the bounded evidence packet before any model writes public canon.

**Files:**

- Create: `src/controller/storyteller/types.ts`
- Create: `src/controller/storyteller/digest-builder.ts`
- Create: `src/controller/storyteller/digest-builder.test.ts`
- Create: `src/controller/storyteller/store.ts`
- Create: `src/controller/storyteller/store.test.ts`
- Create: `src/controller/storyteller/cli.ts`
- Modify: `package.json`

Steps:

- [x] Define `CityEventDigest` and `StorytellerDispatch` types from `docs/2026-05-28-storyteller-design.md`.
- [x] Build a fixture with one low-AP resident, one GP event, one AP-for-GP exchange, one NCRI, one bounded completion event, one stuck/recovered event, and one quiet resident.
- [x] Write tests proving digest windows are bounded and sorted by importance.
- [x] Add `npm run storyteller:dry-run` that writes digest JSON and prints a plain summary.
- [x] Add `npm run storyteller:dry-run -- --memory-root <path>` so live AP/GP/NCRI/goal evidence can produce the same Storyteller artifacts without a model call.
- [ ] Run:

```bash
npm test -- --runInBand src/controller/storyteller
npm run storyteller:dry-run -- --fixture
npm run check:no-ui
```

Acceptance:

- Dry run performs no model call.
- Digest separates AP ledger events from GP evidence.
- Output is deterministic for fixture inputs.

## Task S7: Storyteller Model Run And Verifier

**Goal:** Generate public-canon narration with a smarter model while blocking unsupported claims.

**Scope note:** Start this after S6 has deterministic digest evidence and at least one AP/GP loop proof exists. If the simple loop is still weak, keep Storyteller work at dry-run/verifier level.

**Files:**

- Create: `src/controller/storyteller/prompt-builder.ts`
- Create: `src/controller/storyteller/model-client.ts`
- Create: `src/controller/storyteller/verifier.ts`
- Create tests beside each file
- Modify: `src/controller/config.ts`
- Modify: `config/controller.yml.example`
- Modify: `package.json`

Steps:

- [x] Write verifier tests rejecting unknown event refs, unredacted private handles, unsupported deaths, unsupported births, unsupported AP grants, unsupported GP movement, unsupported NCRIs, and unsupported quest completions.
- [x] Build prompt requiring JSON with `publicTitle`, `publicBody`, `publicBullets`, `operatorSummary`, `operatorWarnings`, `eventRefsUsed`.
- [x] Wire model profile selection through existing inference config/env.
- [x] Add `npm run storyteller:run -- --fixture --model-profile <profile>`.
- [x] Add `npm run storyteller:run -- --latest|--digest-id <id>` so model-backed/nooped narration can use live dry-run artifacts.
- [x] Record token usage, latency, model profile, and cost estimate when available.

Acceptance:

- Fixture run produces valid dispatch JSON.
- Unsupported claims are blocked or marked `needs_review`.
- Paid/local model comparison can be run without changing code.

## Task S8: Resident AP/GP Knowledge, Goal Hierarchy, And Behavior

**Goal:** Residents reason about AP/GP, prioritize survival and GP before aspirational Soul goals, use Library strategies, and do not hallucinate trades.

**Files:**

- Modify: `docs/runescape-skill/economy.md`
- Modify: `src/controller/knowledge/knowledge-retriever.ts`
- Modify: `src/controller/knowledge/game-skill-context.test.ts`
- Modify: `src/controller/thinking/hybrid-agent-prompts.ts`
- Modify: `src/controller/thinking/hybrid-agent-thinking-module.test.ts`
- Modify: `src/controller/spark/runescape-body-routines.ts`
- Modify: `src/controller/spark/runescape-body-routines.test.ts`
- Modify: `docs/resident-capabilities.md`

Steps:

- [x] Add economy knowledge entries: AP sustains residents; GP is real coins; humans may trade AP for GP/items/NCRIs; residents must not claim GP without evidence.
- [x] Add goal hierarchy knowledge entries: survive on AP, earn/preserve GP, pursue the Soul goal, write useful discoveries to the Library.
- [x] Write retrieval tests for low AP, GP, coin, printer, AP-for-GP queries, and Library strategy lookup.
- [x] Write prompt tests proving AP/GP rules and the goal hierarchy appear when resident has low AP, no GP, GP-related events, or a broad Soul goal.
- [x] Add behavior tests for resident-with-GP, resident-without-GP, low-AP exchange opportunity, and "aspirational goal with no resources chooses a practical GP/AP step first." S8c now proves urgent AP/GP Library behavior; S8b now adds direct-chat AP-for-GP honesty guards (no-GP refusal + low-AP GP-backed exchange proposal) with focused regressions; broader ordinary-loop proof remains in `CQA9`.
- [x] Add or run a benchmark where a resident with a Soul goal like "find a way to make 100 GP/hour and write the strategy into the Library" plans a concrete GP route and records a Library strategy finding.

Acceptance:

- Residents can explain AP/GP in-character.
- A resident without coins refuses or redirects instead of pretending to pay.
- A resident with coins can offer a safe exchange under the benchmark harness.
- A resident with a broad Soul goal chooses practical AP/GP actions before unsupported lore or quest claims.
- Library strategy retrieval influences at least one benchmarked plan or action note.

## Task S9: Binary Goal Completion To Saved State

**Goal:** Let verified binary goal completion save a resident into the Library without expanding the whole RuneScape quest system.

**Files:**

- Modify: `src/controller/evidence/library-updater.ts`
- Modify: `src/controller/evidence/library-updater.test.ts`
- Modify: `src/controller/evidence/story-arc.ts`
- Modify: `src/controller/evidence/story-arc.test.ts`
- Modify: `src/controller/benchmarks/tasks/cooks-assistant-complete-5m.ts`
- Modify: `docs/resident-capabilities.md`

Steps:

- [ ] Write a failing test that a verified `goal_complete` or bounded `quest_complete` event marks goal status complete.
- [ ] Add saved Library moment with goal, AP final state, GP/NCRI context when present, and evidence refs.
- [ ] Re-run a bounded completion benchmark only if needed to prove the saved-state path; do not add broad new quest routing in this task.
- [ ] Update capability matrix with saved-state proof.

Acceptance:

- Verified binary goal completion has a durable saved-state artifact.
- Saved-state logic does not fire from partial quest progress.
- Capability doc distinguishes quest start, ingredient pickup, quest completion, and saved state.
- Any Cook's Assistant proof is clearly labeled as bounded evidence, not weekend MVP scope.

## Task S10: Weekend Benchmark Pack

**Goal:** Make the weekend sprint measurable across residents and models.

**Files:**

- Modify: `src/controller/benchmarks/cli.ts`
- Modify: `src/controller/benchmarks/report.ts`
- Modify: `src/controller/benchmarks/tasks/*`
- Modify: `docs/model-benchmarking.md`
- Modify: `docs/resident-capabilities.md`

Steps:

- [ ] Ensure all new task ids are registered in the benchmark CLI.
- [ ] Ensure report output groups by model profile, endpoint, task id, pass rate, duration, cost, and failure cause.
- [ ] Run twin/triplet agents for at least one GP task and one AP/GP/Soul-goal planning task when infrastructure is available.
- [ ] Save artifact ids and summarize results in docs.

Acceptance:

- Agents can compare Qwen/Qwopus/Haiku/Sonnet/MiniMax with the same task prompt and resident setup.
- Capacity and intelligence results are separate rows, not mixed together.
- Docs clearly say where evidence is weak.
- Quest tasks are optional bounded probes; they are not the primary weekend intelligence benchmark unless Dev explicitly reopens that scope.

## Task S11: Dashboard Contract Handoff

**Goal:** Prepare dashboard work without violating the server UI boundary.

**Files:**

- Modify: `docs/city-dashboard-integration.md`
- Modify: `src/controller/city-integration/http-server.ts`
- Modify: `src/controller/city-integration/http-server.test.ts`

Steps:

- [ ] Document JSON routes and example payloads for AP balance, GP wealth, Soul proposals, NCRIs, Storyteller latest dispatch, and saved-state summary.
- [ ] Add only JSON endpoints needed by the dashboard.
- [ ] Add route tests proving content type is JSON.
- [ ] Run `npm run check:no-ui`.

Acceptance:

- Dashboard agents know exactly what API contracts to consume.
- No human-facing UI assets exist in this repo.

## Task S12: Closeout Report

**Goal:** Leave a human-readable weekend state that James can bring to Dev.

**Files:**

- Modify: `docs/2026-05-29-weekend-sprint-plan.md`
- Modify: `docs/resident-capabilities.md`
- Modify: `HUMANS.md`
- Modify: `docs/model-benchmarking.md`
- Modify: `docs/agent-status.md`

Steps:

- [ ] Summarize shipped S tasks with commit SHAs.
- [ ] Summarize live evidence and benchmark artifacts.
- [ ] List blockers and owner decisions needed.
- [ ] List what dashboard repo still needs to do.
- [ ] Keep `docs/agent-status.md` HANDOFF under 280 characters.

Acceptance:

- A human can understand what works, what is proven, and what should be built next without reading the whole repo.
