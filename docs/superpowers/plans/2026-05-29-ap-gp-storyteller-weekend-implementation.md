# AP/GP + Storyteller Weekend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Dev's weekend Null City loop: AP births and sustains residents, GP is real RuneScape gold, residents can trade real value for AP, NCRIs can be registered/redeemed, and the Storyteller narrates evidence-backed city events.

**Architecture:** Keep `rs6-nullcity-server` focused on runtime, controller, JSON/control APIs, file-backed persistence, CLI/admin tools, logs, and benchmarks. The dashboard repo owns all human-facing UI. Build the loop as small substrates with tests first: AP ledger compatibility, GP evidence, AP-for-GP exchanges, Soul proposal/birth, NCRI registry, Storyteller digest/store/model, and benchmark proof.

**Tech Stack:** TypeScript, Zod, Jest, SWC, file-backed JSON/JSONL stores, existing controller/runtime, AgentGateway, CityIntegrationService, patron ledgers, Library timelines, benchmark artifacts, named inference profiles.

---

## Non-Negotiable Boundaries

- Do not add `.html`, `.css`, `.svelte`, `.jsx`, `.tsx`, `public/`, or dashboard-like UI to this repo.
- Any human-facing screen goes in `../rs6-nullcity-residents-dashboard`.
- Server output for dashboard should be JSON/read models only.
- Run `npm run check:no-ui` before finishing any task here.
- Do not commit API keys, local secrets, raw endpoint credentials, or unredacted private handles.
- Every behavior claim needs either a focused test, benchmark artifact, live log, or `docs/resident-capabilities.md` evidence row.

## Central Tracker

Roadmap workstream: `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md#workstream-s-apgp-economy-soul-birth-ncris-and-storyteller`

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

Wave 1 can run in parallel after Wave 0:

- S1a/S1b: AP ledger replay, decay, top-up, fade/resume proof.
- S2a/S2b: inspect real GP coin item and produce `gp_observed` evidence.
- S6b/S6c: Storyteller store and dry-run CLI.
- S8a: AP/GP knowledge retrieval and prompt envelope proof.

Wave 2 depends on Wave 1 evidence:

- S3a/S3b: AP-for-GP exchange, complete only when both AP and GP evidence exist.
- S4a/S4b: Soul proposal queue and AP-funded birth.
- S5a/S5b: NCRI registry and Library events.
- S9a: quest completion to saved Library state.
- S10b/S10c: model twins/triplets across GP and quest tasks.

Wave 3 is weekend closeout:

- S7a/S7b: model-backed Storyteller with verifier and cost metadata.
- S11b/S11c: final JSON route contracts for dashboard agents.
- S12: human-readable shipped state, capability truth table, benchmark summary, and blockers.

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

## Agent Packet Backlog

These packets are intentionally smaller than S0-S12. Autonomous agents should claim one packet, finish it completely, then claim the next.

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
| S6a | S6 | C | none | `CityEventDigest` fixture covers AP, GP, NCRI, quest, stuck/recovery, quiet resident | deterministic storyteller tests |
| S6b | S6 | C | S6a | `storyteller:dry-run` writes digest JSON and plain operator summary | dry-run command output |
| S7a | S7 | C | S6b | Storyteller verifier rejects unsupported claims and private handles | verifier tests |
| S7b | S7 | C | S7a | Model-backed Storyteller run records profile, latency, tokens, cost estimate | fixture run with dispatch JSON |
| S8a | S8 | D | S0a | AP/GP knowledge retrieved into prompt envelope under relevant contexts | retrieval/prompt tests |
| S8b | S8 | D | S8a,S2a | Resident with no GP refuses to claim payment; resident with GP can propose safe exchange | benchmark or body-routine tests |
| S9a | S9 | D | existing Cook completion proof | Quest completion emits saved-state Library moment only on binary completion | Library/story-arc tests |
| S9b | S9 | D/C | S9a,S6a | Storyteller digest can cite saved resident without inventing goal completion | digest/verifier tests |
| S10a | S10 | D | none | benchmark report groups by task, resident, endpoint, model, pass rate, duration, failure cause, cost | report tests |
| S10b | S10 | D | S10a,S2b,S8a | twin/triplet GP task compares Qwen/Qwopus/paid profile behavior | benchmark artifacts + report |
| S10c | S10 | D | S10a,S9a | twin/triplet quest task compares model intelligence on multi-step goal | benchmark artifacts + report |
| S11a | S11 | E | S0a,S2a,S6a | dashboard contract examples for AP, GP, proposals, NCRIs, Storyteller, saved state | docs plus route tests if endpoints exist |
| S11b | S11 | E/B/C | relevant endpoint packets | JSON endpoints return typed payloads and never HTML | route tests and `check:no-ui` |
| S12a | S12 | E | any completed S packets | weekend closeout table with commit SHAs, evidence ids, blockers | docs diffcheck |
| S12b | S12 | E | S10b/S10c | human model/capability summary says what is proven, weak, or unknown | docs plus benchmark report |

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

- [ ] Write failing tests in `src/controller/patron/cli.test.ts` proving balance, check-in, referral, offer, and insufficient-balance messages say `AP` or `Attention Points`, while existing `patron-currency.json` snapshots still parse.
- [ ] Update `CURRENCY_NAME` copy to `AP` or `Attention Points`. Keep file names and snapshot schemas stable unless a migration task explicitly changes them.
- [ ] Update tests that currently assert "Shards" in human-facing text. Do not change historical quoted evidence unless the quote is generated by current code.
- [ ] Search for `Shards` in current docs/code and classify each hit as historical, legacy alias, or active public copy.
- [ ] Run:

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

- [ ] Write failing tests for `inspectGold` returning `{ ok: true, itemId: 995, amount }`.
- [ ] Write failing tests for `burnGold` returning 409-style `insufficient_gold` without mutating state when the resident lacks coins.
- [ ] Ensure `city_gold_burn` Library events include `itemId: 995`, amount, city user id, source type/id, and life index.
- [ ] Add an explicit docs row: "GP means real RuneScape coins; evidence source is inventory/bank/trade, not AP ledger."
- [ ] Run:

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
- [ ] Reuse existing `birthResidentFromCity` for actual resident materialization after proposal approval and threshold.
- [ ] Record `city_birth` in Library timeline with proposal id and funded AP.
- [ ] Document JSON contracts only; dashboard UI comes later in dashboard repo.

Acceptance:

- File-backed queue survives restart.
- Duplicate idempotency key does not birth twice.
- Born resident appears in controller state and has starting AP.

## Task S5: NCRI Registry MVP

**Goal:** Represent admin-approved Null City RuneScape Items as metadata bound to real item ids.

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

- [ ] Define `CityEventDigest` and `StorytellerDispatch` types from `docs/2026-05-28-storyteller-design.md`.
- [ ] Build a fixture with one low-AP resident, one GP event, one AP-for-GP exchange, one NCRI, one quest event, one stuck/recovered event, and one quiet resident.
- [ ] Write tests proving digest windows are bounded and sorted by importance.
- [ ] Add `npm run storyteller:dry-run` that writes digest JSON and prints a plain summary.
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

**Files:**

- Create: `src/controller/storyteller/prompt-builder.ts`
- Create: `src/controller/storyteller/model-client.ts`
- Create: `src/controller/storyteller/verifier.ts`
- Create tests beside each file
- Modify: `src/controller/config.ts`
- Modify: `config/controller.yml.example`
- Modify: `package.json`

Steps:

- [ ] Write verifier tests rejecting unknown event refs, unredacted private handles, unsupported deaths, unsupported AP grants, unsupported GP movement, unsupported NCRIs, and unsupported quest completions.
- [ ] Build prompt requiring JSON with `publicTitle`, `publicBody`, `publicBullets`, `operatorSummary`, `operatorWarnings`, `eventRefsUsed`.
- [ ] Wire model profile selection through existing inference config.
- [ ] Add `npm run storyteller:run -- --fixture --model-profile <profile>`.
- [ ] Record token usage, latency, model profile, and cost estimate when available.

Acceptance:

- Fixture run produces valid dispatch JSON.
- Unsupported claims are blocked or marked `needs_review`.
- Paid/local model comparison can be run without changing code.

## Task S8: Resident AP/GP Knowledge And Behavior

**Goal:** Residents reason about AP/GP and do not hallucinate trades.

**Files:**

- Modify: `docs/runescape-skill/economy.md`
- Modify: `src/controller/knowledge/knowledge-retriever.ts`
- Modify: `src/controller/knowledge/game-skill-context.test.ts`
- Modify: `src/controller/thinking/hybrid-agent-prompts.ts`
- Modify: `src/controller/thinking/hybrid-agent-thinking-module.test.ts`
- Modify: `src/controller/spark/runescape-body-routines.ts`
- Modify: `src/controller/spark/runescape-body-routines.test.ts`

Steps:

- [ ] Add economy knowledge entries: AP sustains residents; GP is real coins; humans may trade AP for GP/items/NCRIs; residents must not claim GP without evidence.
- [ ] Write retrieval tests for low AP, GP, coin, printer, and AP-for-GP queries.
- [ ] Write prompt tests proving AP/GP rules appear when resident has low AP or GP-related events.
- [ ] Add behavior tests for resident-with-GP, resident-without-GP, and low-AP exchange opportunity.

Acceptance:

- Residents can explain AP/GP in-character.
- A resident without coins refuses or redirects instead of pretending to pay.
- A resident with coins can offer a safe exchange under the benchmark harness.

## Task S9: Quest Completion To Saved State

**Goal:** Let binary quest completion save a resident into the Library.

**Files:**

- Modify: `src/controller/evidence/library-updater.ts`
- Modify: `src/controller/evidence/library-updater.test.ts`
- Modify: `src/controller/evidence/story-arc.ts`
- Modify: `src/controller/evidence/story-arc.test.ts`
- Modify: `src/controller/benchmarks/tasks/cooks-assistant-complete-5m.ts`
- Modify: `docs/resident-capabilities.md`

Steps:

- [ ] Write a failing test that a `quest_complete` or Cook's Assistant complete event marks goal status complete.
- [ ] Add saved Library moment with goal, AP final state, GP/NCRI context when present, and evidence refs.
- [ ] Re-run autonomous Cook's Assistant completion benchmark.
- [ ] Update capability matrix with saved-state proof.

Acceptance:

- Quest completion has a durable saved-state artifact.
- Saved-state logic does not fire from partial quest progress.
- Capability doc distinguishes quest start, ingredient pickup, quest completion, and saved state.

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
- [ ] Run twin/triplet agents for at least one GP task and one quest task when infrastructure is available.
- [ ] Save artifact ids and summarize results in docs.

Acceptance:

- Agents can compare Qwen/Qwopus/Haiku/Sonnet/MiniMax with the same task prompt and resident setup.
- Capacity and intelligence results are separate rows, not mixed together.
- Docs clearly say where evidence is weak.

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
