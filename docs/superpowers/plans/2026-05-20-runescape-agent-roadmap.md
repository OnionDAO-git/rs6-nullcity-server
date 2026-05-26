# RuneScape Agent Roadmap And Task List

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Update this file whenever you start, finish, block, or defer a task.

**Goal:** Track the remaining design and build work needed for `res:agent` to become a safe, modular, self-improving RuneScape resident that can explore, chat, fight, trade, and perform starter workflows.

**Architecture:** SOUL files define resident identity and module selection. The SPARK kernel owns safety, runtime scheduling, action submission, evidence, logs, budgets, and persistence. Reviewed SPARK modules provide RuneScape thinking, workflows, knowledge, benchmarks, and experiments through explicit capability seams.

**Tech Stack:** TypeScript, Zod, Jest, SWC, existing RuneJS server/controller/dashboard, SPARK module registry, dashboard repo, JSONL action/inference logs, Markdown knowledge docs.

**Human Decisions:** Track James/OnionDAO choices in `docs/human-decisions.md`. Until June 1, 2026, this is pre-launch development: prefer fast local progress with good design, and do not block on Railgun or secure third-party module decisions unless they are marked Critical.

---

## Status Legend

- `[x]` Done and verified.
- `[>]` In progress in the current branch/session.
- `[!]` Blocked and needs a named decision or dependency.
- `[ ]` Not started.
- `[~]` Designed, but not yet implemented.

Agents should update the status marker and add a one-line note under the task when meaningful progress happens.

## Current Baseline

- `[x]` SPARK module seam exists.
  - SOUL can select reviewed in-repo modules.
  - `onion.runescape.standard` wraps the current hybrid agent.
  - Module id/version are logged with inference and action metadata.
  - Strict SOUL module parsing rejects unknown executable fields and duplicate module ids.
  - Focused and full test suites passed after implementation.
- `[x]` Starter agent can make a fire in local testing.
- `[x]` Action evidence is less fragile than before.
  - Movement waits honor `move_to.range`.
  - Item/action effect waits ignore unrelated position churn.
  - Gateway request ids and module metadata are preserved on attempts.
- `[x]` Gateway local safety improved.
  - Tokenless access is loopback-only.
  - Example gateway config uses `127.0.0.1` and a placeholder auth token.
- `[x]` MVP game-skill context, workflow availability, prompt injection, and knowledge suggestion plumbing exist.
- `[x]` A dedicated agent-facing RuneScape skill/doc index exists under `docs/runescape-skill/`.
- `[x]` Benchmark harness foundation and dashboard benchmark inspection exist; humans can inspect artifact lists/details and module leaderboard rows without opening raw JSON.

## Workstream A: SPARK Capability Facades

**Purpose:** Let OnionDAO members experiment with modules without giving arbitrary code raw filesystem, network, secrets, mutable state, or controller internals.

- `[x]` **A1: Implement SPARK facet runtime foundation.**
  - Files: `docs/superpowers/specs/2026-05-21-spark-faceted-module-system-design.md`, `docs/superpowers/plans/2026-05-21-spark-facets-implementation.md`, `src/controller/spark/modules.ts`, `src/controller/spark/runtime-facets.ts`, `src/controller/resident-runtime.ts`
  - Deliverable: SPARK resolves the selected module stack once, builds Brain/Thinking and Nervous compatibility facets, preserves kernel-priority survival reflexes, and logs module id/version when module facets act.
  - Verification: architecture/security/docs subagent review; focused facet/runtime tests; full typecheck, lint, format, build, full Jest suite, benchmark dry-runs, and live `res:agent` smoke.
  - Verified 2026-05-21 on `codex/body-waiter-coordinator`: expert reviews incorporated; SPARK facet runtime foundation implemented with focused tests, typecheck, lint, format, build, dry-run benchmark checks, live scripted `make-fire-5m` smoke, and post-review regressions for kernel-first nervous safety plus unique module shutdown.

- `[x]` **A2: Implement read-only state and perception facades.**
  - Files: `src/controller/spark/module-context.ts`, `src/controller/spark/module-context.test.ts`
  - Deliverable: modules can inspect resident state/perception without mutating `RuntimeState`.
  - Verification: Jest tests prove mutation attempts do not affect runtime state.
  - Verified 2026-05-21 in this pass: added immutable state/perception snapshots, public SOUL view without source path/model endpoint, and a safe context shape separate from `TrustedSparkModuleContext`. Focused facade tests, full typecheck, lint, format, build, `git diff --check`, and full Jest suite passed.

- `[x]` **A3: Implement resident-scoped memory facade.**
  - Files: `src/controller/spark/module-memory.ts`, `src/controller/spark/module-memory.test.ts`
  - Deliverable: modules can read/write only approved resident-local paths and cannot invoke arbitrary `qmd` or process execution.
  - Verification: tests reject absolute paths, parent traversal, and unknown namespaces.
  - Verified 2026-05-21 in this pass: added module-owned `modules/<module-id>/...` memory namespace, path/traversal/backslash/null/empty-path rejection, write size caps, bounded recall, and no absolute path return to modules. Focused memory tests, full typecheck, lint, format, build, `git diff --check`, and full Jest suite passed.

- `[x]` **A4: Implement budgeted inference facade.**
  - Files: `src/controller/spark/module-inference.ts`, `src/controller/spark/module-inference.test.ts`
  - Deliverable: modules call inference through explicit profiles and budgets, not raw `LlmClient`.
  - Verification: tests cover budget exhaustion, profile selection, and redacted logging.
  - Verified 2026-05-21 in this pass: added named profile inference facade with budget admission, unknown-profile rejection before LLM calls, budget-exhausted no-op responses, and telemetry without raw prompts/responses. Focused inference tests, full typecheck, lint, format, build, `git diff --check`, and full Jest suite passed.

- `[x]` **A5: Enforce module capabilities before invoking facets.**
  - Files: `src/controller/spark/modules.ts`, `src/controller/thinking/thinking-module.ts`
  - Deliverable: a module cannot expose `thinking`, `hooks`, `nervous-rules`, `candidates`, `prompt-sections`, or `attempt-observer` behavior unless its manifest declares that capability.
  - Verification: module registry tests reject capability/implementation mismatches.
  - Verified 2026-05-21 on heartbeat slice: centralized manifest capability enforcement for current callable facets and planned future facets. Future hook/candidate/prompt/observer/benchmark methods are not part of the public callable `SparkModule` contract until runtime wiring exists, but registry validation still rejects undeclared implementations. Red/green tests cover undeclared future facets plus the declared-facet happy path; full typecheck, lint, format, build, `git diff --check`, and full Jest suite passed.

- `[x]` **A6: Add module config schemas and caps.**
  - Files: `src/controller/spark/module-config.ts`, `src/controller/spark/module-config.test.ts`, `src/controller/spark/modules.ts`
  - Deliverable: selected module config is schema-validated, size/depth-capped, and rejects executable, secret-looking, path-looking, and endpoint-looking fields unless a reviewed module schema explicitly allows them.
  - Verification: tests reject malformed config, oversized config, parent traversal, absolute paths, raw URLs/endpoints, and key/token/password-shaped values.
  - Verified 2026-05-21 on heartbeat slice: added conservative config validator and module resolution integration; focused tests, full typecheck, lint, format, build, `git diff --check`, and full Jest suite passed.

- `[x]` **A7: Add redacted module telemetry facade.**
  - Files: `src/controller/spark/module-telemetry.ts`, `src/controller/spark/module-telemetry.test.ts`, dashboard/runtime log readers as needed.
  - Deliverable: modules can emit bounded, redacted telemetry/events for dashboard and benchmark artifacts without direct log/file access.
  - Verification: tests cover size caps, redaction, allowed event kinds, and rejection of raw secrets.
  - Verified 2026-05-21 on heartbeat slice: added bounded `telemetry.emit()` context surface backed by controller inference logs, with module identity tags, redaction, size caps, and secret-key rejection. Focused telemetry/runtime tests, full typecheck, lint, format, build, `git diff --check`, and full Jest suite passed; controller restarted and `res:agent` came back online under `onion.runescape.standard@0.1.0`.

Safe public module facade building blocks are implemented, but the public member module contract is not wired yet. `TrustedSparkModuleContext` remains an internal reviewed-adapter context and must not be presented as the OnionDAO member module API.

## Workstream B: Standard RuneScape Module Extraction

**Purpose:** Turn the current large hybrid agent into composable, inspectable modules that can be swapped, benchmarked, and improved independently.

- `[x]` **B1: Keep `onion.runescape.standard` as the compatibility adapter.**
  - Files: `src/controller/spark/standard-modules.ts`, `src/controller/soul/starter-souls/res-agent.md`
  - Verified as the first SPARK slice; future work should preserve this as the default stable module.

- `[x]` **B2: Extract starter workflow cards.**
  - Files: `src/controller/spark/runescape-workflows.ts`, `src/controller/spark/runescape-workflows.test.ts`, `src/controller/thinking/hybrid-agent-thinking-module.ts`
  - Deliverable: woodcutting, firemaking, fishing, prayer, safe combat, follow/chat, and exploration workflow definitions live outside the hybrid module.
  - Verification: existing hybrid tests still pass; new workflow tests verify prerequisites and next actions.
  - *Completed: Extracted, unit tested, and integrated under Workstream R1.*

- `[~]` **B3: Extract deterministic Body routines.**
  - Files: `src/controller/spark/runescape-body-routines.ts`, `src/controller/spark/runescape-body-routines.test.ts`
  - Deliverable: "make fire", "walk to interaction range", "use tool on target", "eat food", and "recover from stuck" routines are separate from inference prompts.
  - Verification: tests simulate perception and assert typed `AgentAction` sequences.
  - Partial 2026-05-23 on `nullcity`: starter fishing Body routine now approaches distant visible Fishing spots to interaction range before netting, and interaction range checks treat diagonal adjacency as valid. Remaining extraction work still includes generalizing the typed routine library beyond fishing/firemaking.
  - Partial 2026-05-23 on `nullcity`: object and item-on-object action pipes now run matching hooks immediately when the resident is already in object interaction range instead of enqueueing a redundant walk task. Regression tests cover adjacent diagonal object/item-on-object targets and far targets that should still enqueue `WalkToObjectPluginTask`.
  - Partial 2026-05-25 on `agents/wip`: NPC interaction hooks can declare custom interaction distance, fishing spots use a shoreline casting range, and `ignoreDestination` pathing can fall back to reachable adjacent tiles. Verified with focused tests and a live autonomous `starter-fishing-5m` pass (`score=1`, `changed=skills,inventory`, artifact `/tmp/oniondao-starter-fishing-live-codex/bench_20260525102747_starter_fishing_5m.json`). Remaining extraction work still includes generalizing the typed routine library beyond fishing/firemaking.
  - Hardened 2026-05-25 on `agents/wip`: stale NPC world-index refs now recover by matching target key/position, and starter anglers can reposition to the live-proven Lumbridge bank tile after a spot timeout. Live `res:qa-angler` restarted, netted shrimp, gained Fishing XP, and passed `controller:smoke -- --resident res:qa-angler --fail-on-warn`.
  - Hardened 2026-05-25 on `agents/wip` (ae49008f): accept fishing busy evidence and relax bank recovery range using `STARTER_FISHING_SPOT_DISCOVERY_RANGE`.
  - Follow-up 2026-05-25 on `agents/wip`: live QA showed discovery-range movement could pass while qa anglers oscillated near the river without netting. Starter fishing now routes to the live stand spot with normal interaction range, filters visible spots to net-capable NPC keys, and leaves broad Body extraction open.
  - Repair 2026-05-25 on `agents/wip`: live qa-angler still timed out on fishing clicks, then hid both spots behind target-failure cooldowns and looped toward the exact stand tile. Fishing tasks now mark `busy` as soon as queued, and starter fishing recovery routes only to discovery range, reporting a blocker when already close enough instead of oscillating.
  - Repair 2026-05-25 on `agents/wip`: live qa-angler had a full pack of cooked/burnt shrimp; inventory-full prevented the fishing plugin from queueing work, while burnt shrimp was not registered so it could not be dropped. Starter fishing now clears burnt starter fish, eats cooked starter fish when needed, says when blocked, and registers burnt shrimp/fish config.
  - Repair 2026-05-25 on `agents/wip`: dropped burnt starter fish is no longer considered useful ground loot or emergency food, preventing beacons like "Next: pick up burnt shrimp" immediately after the resident intentionally discarded it.
  - Repair 2026-05-25 on `agents/wip`: starter-fishing beacons now say to cook carried raw fish before advertising another fishing click, so observers can tell when the resident is in the cooking half of the loop.
  - Repair 2026-05-25 on `agents/wip`: river-side starter anglers with raw fish now route through the known Lumbridge Castle south entrance before chasing the kitchen range, avoiding unrelated river doors that previously trapped the cooking half of the loop.
  - Hardened 2026-05-26 on `agents/wip`: free exploration now ignores NPCs, landmarks, tree stands, openables, and ground items on other floors, so level-blind distance math cannot send Lumbridge Castle residents after downstairs targets. Verified with red/green Body tests, hybrid exploration subset, `npm run fin` (2054/2054), post-restart smoke, 180s targeted QA smoke, and 60s whole-city smoke.
  - Hardened 2026-05-26 on `agents/wip`: same-floor level checks and target failure cooldowns are fully integrated and verified across all deterministic body routines (woodcutting, fishing, combat, prayer, and exploration). Added focused Jest tests; verified all 2059 tests pass green (`npm run fin`) and successfully ran 5-minute live city-wide smoke test (`npm run controller:smoke -- --observe-seconds 300`).

- `[x]` **B4: Extract Brain goal planner.**
  - Files: `src/controller/spark/runescape-brain-planner.ts`, `src/controller/spark/runescape-brain-planner.test.ts`
  - Deliverable: high-level goals are selected from skill progress, inventory, nearby affordances, SOUL preferences, and benchmark task hints.
  - Verification: tests cover goal choice for firemaking, fishing, combat survival, follow/chat, and exploration.
  - *Completed: Extracted 23 brain-planner symbols to src/controller/spark/runescape-brain-planner.ts under Workstream R4.*

- `[x]` **B5: Extract Nervous survival rules into a module facet.**
  - Files: `src/controller/spark/runescape-nervous-rules.ts`, `src/controller/spark/runescape-nervous-rules.test.ts`, `src/controller/nervous-system/*`
  - Deliverable: survival behavior remains kernel-priority but can be supplied by first-party modules.
  - Verification: low HP, enemy attack, blocked/stuck, and dangerous area tests.
  - *Completed: Extracted 7 nervous-system reflex symbols to src/controller/spark/runescape-nervous-rules.ts under Workstream R3.*

## Workstream C: Benchmark Harness

**Purpose:** Prove whether modules actually help the resident play RuneScape instead of relying on vibes.

- `[x]` **C1: Define benchmark artifact schema.**
  - Files: `src/controller/benchmarks/benchmark-artifact.ts`, `src/controller/benchmarks/benchmark-artifact.test.ts`
  - Deliverable: JSON artifact includes run id, module id/version, task id/version, resident, model profile, commits, start/end times, pass/fail, score, metrics, and failure reason.
  - Verification: schema tests reject missing module identity and invalid statuses.
  - Verified 2026-05-20 on `codex/body-waiter-coordinator` with focused benchmark tests, format check, typecheck, and `git diff --check`.

- `[x]` **C2: Add disposable benchmark resident runner.**
  - Files: `src/controller/benchmarks/benchmark-runner.ts`, `src/controller/benchmarks/benchmark-runner.test.ts`
  - Deliverable: create/connect a disposable resident, run a bounded task, collect action/inference/perception evidence, then cleanly stop.
  - Verification: mocked gateway test proves lifecycle and cleanup.
  - Verified 2026-05-20 on `codex/body-waiter-coordinator` with mocked gateway lifecycle and timeout cleanup tests.

- `[x]` **C3: Implement `make-fire-5m` verifier.**
  - Files: `src/controller/benchmarks/tasks/make-fire-5m.ts`, `src/controller/benchmarks/tasks/make-fire-5m.test.ts`
  - Deliverable: pass when logs are consumed and a fire appears or firemaking success event is observed within the time budget.
  - Verification: fixture tests for pass, timeout, wrong action, and unsafe loop.
  - Verified 2026-05-20 on `codex/body-waiter-coordinator` with fixture tests for pass, timeout, wrong action, and unsafe repeated action loops.

- `[x]` **C4: Implement starter benchmark suite.**
  - Tasks: `woodcutting-firemaking-10m`, `starter-fishing-5m`, `fishing-cooking-10m`, `combat-prayer-10m`, `explore-report-5m`, `follow-and-chat-5m`
  - Deliverable: every task has a verifier, scoring rubric, and fixture tests.
  - Verification: benchmark task tests pass locally and artifacts are written to the configured output dir.
  - Partial 2026-05-20 on `codex/body-waiter-coordinator`: added `explore-report-5m` verifier/CLI wiring and live smoke (`status=passed`, `score=1`, artifact `data/benchmarks/bench_20260521002220_explore_report_5m.json`). Remaining tasks: woodcutting-firemaking, starter-fishing, combat-prayer, follow-and-chat.
  - Partial 2026-05-21 on `codex/body-waiter-coordinator`: added `follow-and-chat-5m`, disposable benchmark peer support, exact per-run peer chat stimuli, and live autonomous smoke (`status=passed`, `score=1`, `selectedModuleActions=2`, `selectedModuleInferences=2`, `statusResponses=1`, `movedTowardSpeaker=1`, artifact `/tmp/oniondao-autonomous-follow-chat/bench_20260521044246_follow_and_chat_5m.json`). Remaining tasks: woodcutting-firemaking, starter-fishing, combat-prayer. Local gateway still reports delete-disabled cleanup as a metric.
  - Partial 2026-05-21 on `nullcity`: added `woodcutting-firemaking-10m` verifier/CLI wiring and autonomous fixture coverage. The verifier requires a selected module to chop a level-1 tree, gain self-supplied logs or woodcutting success evidence, then attempt firemaking and observe a firemaking success signal. Live autonomous smoke passed (`status=passed`, `score=1`, `selectedModuleActions=5`, `woodcuttingEvidence=1`, `firemakingSuccess=1`, artifact `/tmp/oniondao-wood-fire-bench/bench_20260521052903_woodcutting_firemaking_10m.json`).
  - Partial 2026-05-21 on `nullcity`: added `starter-fishing-5m` verifier/CLI wiring, false-positive fixture coverage, benchmark-goal seeding, and a Body fix that uses the Fishing spot's `net` interaction directly instead of pathing to water-adjacent tiles first. Live autonomous smoke passed (`status=passed`, `score=1`, `selectedModuleActions=2`, `netActions=1`, `fishGained=1`, `fishingXpIncreased=1`, artifact `/tmp/oniondao-starter-fishing-bench/bench_20260521060945_starter_fishing_5m.json`). Remaining task: `combat-prayer-10m`.
  - Verified 2026-05-21 on `nullcity`: added `combat-prayer-10m` verifier/CLI wiring, benchmark-goal seeding, false-positive coverage for unsafe targets, pre-existing/external bones, zero-damage hits, unordered burial, and bone loss without Prayer XP. Live autonomous smoke passed (`status=passed`, `score=1`, `selectedModuleActions=8`, `safeAttackActions=3`, `bonesEvidence=1`, `prayerXpIncreased=1`, `deathEvents=0`, artifact `/tmp/oniondao-combat-prayer-bench/bench_20260521064209_combat_prayer_10m.json`).
  - Verified 2026-05-23 on `nullcity`: hardened `fishing-cooking-10m` after a stale-server/live smoke exposed two real-play issues. The standard module no longer pre-lights its only log before catching fish, and distant/diagonal Fishing spot interactions now approach and execute correctly. Live autonomous smoke passed (`status=passed`, `score=1`, `netActions=4`, `successfulNetActions=3`, `cookingActions=2`, `successfulCookingActions=2`, `cookingSuccess=1`, `orderedActionChain=1`).
  - Verified 2026-05-23 on `nullcity`: tightened `fishing-cooking-10m` action evidence so paired ack/final rows are coalesced and a pure accepted-action row cannot hide a final timeout. A follow-up live autonomous smoke passed (`status=passed`, `score=1`, `durationMs=91058`, `netActions=1`, `successfulNetActions=1`, `cookingActions=1`, `successfulCookingActions=1`, `cookingSuccessEvents=2`) by accepting independent game evidence when the final cook observer timed out after the resident visibly completed the loop.

- `[x]` **C5: Add benchmark CLI.**
  - Files: `src/controller/benchmarks/cli.ts`, `package.json`
  - Deliverable: `npm run controller:bench -- --task make-fire-5m --module onion.runescape.standard`
  - Verification: dry-run test and one local smoke run when server/controller are available.
  - Verified 2026-05-20 on `codex/body-waiter-coordinator` with CLI parser tests, focused benchmark tests, typecheck, lint, build, dry run, and live `make-fire-5m` smoke (`status=passed`, `score=1`, artifact `data/benchmarks/bench_20260521001409_make_fire_5m.json`).

- `[x]` **C6: Add autonomous module benchmark mode.**
  - Files: `src/controller/benchmarks/benchmark-runner.ts`, `src/controller/benchmarks/cli.ts`, benchmark task verifiers, fixture tests.
  - Deliverable: a benchmark mode starts or attaches to `ResidentRuntime` with the selected SPARK module and observes the module's decisions instead of submitting the winning action from the task script.
  - Verification: artifact records `mode: autonomous`, action evidence contains the selected module id/version, inference evidence is recorded as an optional metric, and at least `make-fire-5m` can be run without scripted task action injection.
  - Verified 2026-05-21 on `codex/body-waiter-coordinator`: autonomous runner mode starts a benchmark `ResidentRuntime`, records `mode: autonomous`, requires selected-module action evidence before a pass, records selected-module inference evidence as an optional metric, isolates benchmark runtime memory/log/knowledge writes to temp dirs, and keeps scripted task injection out of `runAutonomous`. Focused benchmark tests, typecheck, lint, format, build, `git diff --check`, full Jest suite, and live `make-fire-5m` autonomous smoke passed (`status=passed`, `score=1`, `selectedModuleActions=2`, `selectedModuleInferences=2`, artifact `/tmp/oniondao-autonomous-bench/bench_20260521032113_make_fire_5m.json`). Local gateway still reports delete-disabled cleanup as a metric.

- `[x]` **C7: Make benchmark cleanup quiet in local dev.**
  - Files: benchmark runner, local dev config/docs, gateway delete policy as needed.
  - Deliverable: disposable benchmark residents and peers are removed cleanly in an explicit local benchmark mode, or cleanup-disabled local runs are clearly separated from pass/fail metrics and easy to sweep.
  - Verification: local autonomous benchmark artifact has no cleanup warning when cleanup is intentionally enabled; delete remains disabled by default for normal local gameplay unless explicitly opted in.
  - Verified 2026-05-21 on `codex/body-waiter-coordinator`: exact gateway `EDELETE_DISABLED` cleanup is recorded as `cleanupSkipped` evidence instead of `cleanupFailures`, generic cleanup errors still retain the old failure behavior, and delete remains disabled by default for normal local gameplay.

## Workstream D: Dashboard Debugging

**Purpose:** Let humans see whether the agent is alive, what it wants, what module is driving it, and why it failed.

- `[x]` **D1: Expose module stack in dashboard data.**
  - Files: dashboard API/client files, controller log readers
  - Deliverable: resident observer view shows selected module id/version/config and active facets.
  - Verification: dashboard test or local browser screenshot at `/observe/resident/res%3Aagent`.
  - Verified 2026-05-20 in `rs6-nullcity-residents-dashboard` with runtime read-model and activity snapshot tests plus dashboard typecheck/build.

- `[x]` **D2: Add current goal and last thought/action panel.**
  - Files: dashboard resident observe route/components
  - Deliverable: humans can see active goal, recent action, evidence, final status, and failure reason.
  - Verification: Playwright/browser inspection with `res:agent`.
  - Partial 2026-05-21 on `nullcity`: resident detail Spark Activity now surfaces Thinking/Nervous/Body state, current goal, recent inference/action/feed, and explicitly distinguishes gateway-online residents that are still waiting for controller runtime state. Dashboard spawn now writes controller-discoverable SOUL files for autonomous residents, and the controller discovers valid SOUL files from `souls.dir` during reconcile.
  - Partial 2026-05-23 in `rs6-nullcity-residents-dashboard`: dashboard defaults now read controller runtime/log roots from `data/controller/*` and write default souls to the controller-discoverable starter-souls directory, so a local default launch surfaces resident runtime state without env overrides. Activity labels now render trade request/offer/accept/decline as human-readable actions. Verified with dashboard tests, typecheck, check, build, a temp API smoke showing `residentsWithRuntime=5`, and browser smoke at `/residents/res%3Aagent` showing SPARK Activity, runtime active, active goal, and module identity.
  - Partial 2026-05-23 in `rs6-nullcity-residents-dashboard`: resident runtime API now summarizes controller `evidence/progress/*.jsonl`, and the resident SPARK Activity Body panel shows `Progress` as either current progress, no-progress, or stuck ticks with last meaningful progress reasons. Verified with dashboard tests, typecheck, check, build, temp API smoke for `res:agent` (`stuckTicks=98`), and browser smoke showing `Progress stuck 98 ticks`.
  - Partial 2026-05-23 in `rs6-nullcity-residents-dashboard`: progress row is now freshness-aware, so old evidence for an offline resident renders as `offline; last ...` with sample age rather than implying current activity. Verified with activity regression, dashboard tests, typecheck, check, build, and browser smoke showing `Progress offline; last stuck 98 ticks 9h ago`.
  - Partial 2026-05-24 on `agents/wip`: resident inference logs now emit a delayed `thinking_started`/`deciding` marker only when thinking remains pending long enough for observers, so dashboard readers can distinguish slow thought from idle without fast body-wait log spam. Benchmark selected-module inference metrics continue to count completed decisions only. Verified with red/green runtime and benchmark regressions, full controller gates/Jest, and live controller smoke.
  - Hardened 2026-05-25 on `agents/wip`: the public wall roster now filters to configured controller residents, so stale disposable benchmark runtime folders no longer appear in the "Who's Here" panel. Verified with focused wall snapshot/HTTP tests and live `/v1/wall/snapshot` after controller restart.
  - Improved 2026-05-25 on `agents/wip`: public wall roster can use SOUL display names and first authored SOUL goal as a fallback when runtime cognition has not selected an active goal yet. Runtime active goals still win. Verified with wall snapshot/HTTP tests and direct real-memory snapshot proof for Hans, Father Aereck, Wise Old Man, Pip, and Thrand.
  - Improved 2026-05-25 in `rs6-nullcity-residents-dashboard`: `/api/residents` now filters gateway residents to controller-discoverable SOULs when a SOUL catalog exists, dropping stale disposable benchmark residents from the dashboard list. Verified with dashboard runtime tests, typecheck, check, build, and live API smoke showing 19 residents instead of 182.
  - Improved 2026-05-25 in `rs6-nullcity-residents-dashboard`: `/api/residents` and overview resident rows now keep compact feed/action/SPARK/progress summaries but omit raw perception/event/save blobs; detail runtime endpoints still expose full state. Verified with red/green dashboard tests, typecheck, check, build, full Bun tests, and live API proof.
  - Hardened 2026-05-25 on `agents/wip`: `/v1/wall/snapshot` roster filtering now merges configured residents with SOUL-discovered residents, so newly live faction flagships appear on the wall while stale benchmark folders stay hidden. Verified with focused wall tests, full `npm run fin`, build, dashboard API proof, wall snapshot proof, and live 45s cohort smoke.
  - Improved 2026-05-25 in `rs6-nullcity-residents-dashboard`: overview now surfaces recent patron letters via `/api/letters/recent` and `recentLetters`, with recipients redacted and private bodies omitted. Verified with red/green dashboard tests, typecheck, check, build, live API proof, and browser smoke on a temp server.
  - Improved 2026-05-25 in `rs6-nullcity-residents-dashboard`: overview now surfaces patron Shards and standing via `/api/patrons/summary` and a Patron Standing panel. The panel exposes redacted handles, non-derived display IDs, balances, total Shards, tier counts, standing points, and next-tier gaps while omitting raw patron handles. Verified with red/green dashboard tests, typecheck, check, build, live API proof (`18` patrons, `6375` Shards), browser smoke, and subagent privacy review.
  - Improved 2026-05-25 in `rs6-nullcity-residents-dashboard`: overview now surfaces an Event Readiness panel and `/api/overview` readiness rollup for gateway, controller data, resident cohort, SOUL catalog, patron ledgers, and letters. Readiness details avoid raw gateway URLs, filesystem paths, and token-bearing errors. Verified with red/green readiness tests, full dashboard tests, typecheck, check, build, live API proof (`level=ok`, `23` online, `18` patrons, `6375` Shards, `12` letters), browser smoke, and subagent privacy review.
  - Improved 2026-05-25 in `rs6-nullcity-residents-dashboard`: overview now surfaces Library relationship evidence via `/api/relationships/summary` and `overview.relationships`, filtering to visible/SOUL residents, omitting raw patron handles, reading full timelines for aggregate counts, and removing Library folders during dashboard resident delete cleanup. Verified with red/green dashboard tests, typecheck, check, build, live API proof (`3` residents with relationships, `37` patron events), browser smoke, and subagent privacy review.
  - Closed 2026-05-25 with live proof: browser DOM at `/` showed Event Readiness, Patron Standing, Resident Relationships, Patron Letters, and a Story column with live `arc: progress` rows; `/api/overview` reported `level=ok`, `23` online residents, `18` patrons, `6375` Shards, `12` letters, and `3` residents with relationships. Verified `bun test packages/server/src/runtime.test.ts`, `bun run typecheck`, `bun run check`, `bun run build`, and 90s `controller:smoke` over 23 residents.

- `[x]` **D3: Add benchmark run list and detail pages.**
  - Files: dashboard benchmark routes/components
  - Deliverable: list benchmark artifacts, filter by module/task, and inspect run timeline.
  - Verification: fixture artifacts render correctly.
  - Verified 2026-05-22 in `rs6-nullcity-residents-dashboard`: added benchmark artifact list/detail BFF endpoints, shared read models, `/benchmarks` and `/benchmarks/:runId` dashboard views, and fixture coverage for malformed-file skipping plus newest-first ordering. Validation passed with `bun test packages/server/src/runtime.test.ts`, `bun run typecheck`, `bun run check`, `bun run build`, `git diff --check`, and live API smokes against `http://127.0.0.1:8892/api/benchmarks` plus a detail artifact.
  - Verified 2026-05-22 in `rs6-nullcity-residents-dashboard`: benchmark detail evidence now renders structured action attempts with final status, effect-evidence count, source, cause, and module identity above the raw artifact. Browser smoke against a fixture action-effect benchmark showed the `SUCCESS use item on item 1 EFFECT` row, and focused dashboard tests/typechecks passed.
  - Verified 2026-05-22 in `rs6-nullcity-residents-dashboard`: benchmark detail lookup now opens artifacts stored in nested output directories such as `data/benchmarks/codex-combat-prayer-smoke/<run>.json`, matching the benchmark CLI output layout. Regression test covers nested artifact detail lookup; browser smoke opened a real autonomous `combat-prayer-10m` run detail and showed fight/loot/bury evidence rows.

- `[x]` **D4: Add module leaderboard.**
  - Files: dashboard benchmark components
  - Deliverable: compare modules by pass rate, progress, efficiency, safety, reliability, and cost.
  - Verification: fixture data ranks modules deterministically.
  - Verified 2026-05-22 in `rs6-nullcity-residents-dashboard`: added `/api/benchmarks/leaderboard`, deterministic module ranking by pass rate/progress/run count/recency, and a dashboard leaderboard panel that compares pass rate, average score, autonomous runs, average duration, safety incidents, cleanup failures, and inference count. Validation passed with dashboard runtime tests, `bun test`, `bun run typecheck`, `bun run check`, `bun run build`, `git diff --check`, and live `http://127.0.0.1:8893/api/benchmarks/leaderboard` smoke.

- `[x]` **D5: Surface last action result status in SPARK Activity.**
  - Files: `rs6-nullcity-residents-dashboard/packages/web/src/lib/activity.ts`, `rs6-nullcity-residents-dashboard/packages/web/src/lib/activity.test.ts`, `rs6-nullcity-residents-dashboard/packages/web/src/App.svelte`
  - Deliverable: resident detail Body panel shows whether the latest action succeeded, failed, or timed out, with concise reason text for QA.
  - Verification: activity regression tests, dashboard checks/build, and live dashboard/API smoke.
  - Verified 2026-05-26 in `rs6-nullcity-residents-dashboard`: SPARK Activity Body panel now separates `Last Action` from `Last Result`, shows `pending` for newer unreconciled actions, classifies success/timeout/failed, and redacts raw error text. Validation passed with dashboard tests, typecheck, check, build, browser proof, and live API proof. Follow-up: live 60s `res:agent` smoke exposed observed move timeouts, so server-side stuck recovery needs another pass.
  - Hardened 2026-05-26 in `rs6-nullcity-residents-dashboard`: runtime BFF now merges current trajectory `action_result` evidence and Activity matches final rows by request id, so controller `ok+requestId` ACKs render as pending until final success/timeout/failure arrives. Raw trajectory evidence is omitted. Verified with red/green runtime/activity tests, all dashboard tests (44), typecheck, check, build, browser proof, reviewer pass, and 120s live `res:agent` smoke.

## Workstream E: RuneScape Knowledge And Agent Skill

**Purpose:** Give resident modules a maintained "how to play RuneScape" knowledge base and a safe way to suggest improvements.

- `[x]` **E1: Create RuneScape game-skill index.**
  - Files: `docs/runescape-skill/README.md`, `docs/runescape-skill/starter-workflows.md`, `docs/runescape-skill/items.md`, `docs/runescape-skill/places.md`
  - Deliverable: agent-readable docs for tools, skill requirements, starter locations, common actions, and recovery tactics.
  - Verification: knowledge retriever tests can find entries for logs, tinderbox, shrimp, bones, Lumbridge, and basic combat.
  - Verified 2026-05-20 on `codex/body-waiter-coordinator` with `npm test -- --runInBand src/controller/knowledge/game-skill-entries.test.ts`.

- `[x]` **E2: Wire knowledge retrieval into standard module prompts.**
  - Files: `src/controller/knowledge/game-skill-context.ts`, `src/controller/thinking/hybrid-agent-prompts.ts`
  - Deliverable: Brain and Body prompts receive concise relevant knowledge snippets based on current goal and perception.
  - Verification: prompt tests assert firemaking/fishing/combat snippets appear when relevant and stay absent when irrelevant.
  - Verified in `docs/superpowers/plans/2026-05-20-runescape-game-skill-implementation.md`.

- `[x]` **E3: Add agent knowledge suggestion workflow.**
  - Files: `src/controller/knowledge/suggestions.ts`, `docs/controller-knowledge-runbook.md`
  - Deliverable: agents can suggest knowledge updates to a review queue; Codex/humans approve before docs change.
  - Verification: tests cover dedupe, storage mode, and review command output.
  - Verified in `docs/superpowers/plans/2026-05-20-runescape-game-skill-implementation.md`.

- `[x]` **E4: Add wiki import/update instructions for Railgun and local dev.**
  - Files: `docs/controller-knowledge-runbook.md`, `docs/runescape-skill/README.md`
  - Deliverable: OnionDAO can update knowledge snapshots reproducibly.
  - Verification: command examples are copy/pasteable and use configured data dirs.
  - Verified 2026-05-21 in this pass: runbook and RuneScape skill index now document local-vs-Railgun `RUNEBENCH_WIKI_DIR`, mounted wiki paths, durable knowledge dirs, and the rule that engine-local facts beat wiki snippets.

- `[x]` **E5: Clean up knowledge suggestion workflow attribution.**
  - Files: `src/controller/knowledge/game-skill-context.ts`, `src/controller/knowledge/game-skill-context.test.ts`
  - Deliverable: combat, prayer, follow, fishing, firemaking, and woodcutting attempts are suggested against the workflow that produced the action, not whichever visible workflow sorts first.
  - Verification: focused knowledge tests, then full typecheck, lint, build, and Jest suite.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: normalized action causes before classification, kept combat movement and prayer-driven attacks under `safe-combat`, kept bury-bones under `train-prayer`, and preserved follow attribution. Focused knowledge tests, typecheck, lint, build, and full Jest suite passed.
  - Hardened 2026-05-24 on `agents/wip`: speech-only, generic movement, unattributed failed actions, logout, and noop attempts no longer emit workflow hints. This keeps the self-improvement queue focused on real gameplay effects rather than status chatter, pathing noise, or lifecycle cleanup.

- `[x]` **E6: Trade-aware knowledge suggestion attribution.**
  - Files: `src/controller/knowledge/game-skill-context.ts`, `src/controller/knowledge/game-skill-context.test.ts`
  - Deliverable: trade request/offer/accept/decline attempts generate review suggestions against a trading workflow, not the first visible starter workflow.
  - Verification: focused knowledge tests plus typecheck, lint, format, build, and live autonomous `trading-giving-5m` smoke.
  - Verified 2026-05-23 on `agents/wip`: added trade workflow availability, trade/follow/woodcutting speech attribution, and focused regression coverage. `typecheck`, `lint`, `format`, `build`, focused knowledge+trading tests, and live autonomous `trading-giving-5m` passed (`score=1`, artifact `/tmp/oniondao-trading-giving-bench-e6-final/bench_20260523095325_trading_giving_5m.json`) with suggestions attributed to `follow-codex`, `train-woodcutting`, and `trade-request` instead of `make-fire`.
  - Verified follow-up 2026-05-23 on `agents/wip`: live trading proof exposed stale follow-mode chatter and make-fire/exploration-attributed movement during a trade wait. The fix holds follow/listen mode without Brain/Body drift and keeps direct trade approaches tied to `trade-request`; fresh autonomous `trading-giving-5m` passed with no woodcutting/explore/stuck lines in trajectory.

## Workstream F: Human-Like Behavior Layer

**Purpose:** Make the resident feel like a human-ish player instead of a static script.

- `[x]` **F1: Goal sharing cadence.**
  - Files: `src/controller/thinking/hybrid-agent-thinking-module.ts`, extracted Brain planner when available
  - Deliverable: agent periodically says what he is trying to do, why, and what he needs from nearby humans.
  - Verification: chat tests cover "I am going to chop logs", "I need a tinderbox/logs", and "I am stuck near a fence".
  - Partial 2026-05-21: `presence_beacon` already periodically reports location, active goal, and a concrete next step before Body inference; focused tests cover active-goal beacons, visible item opportunities, and starter fishing next-step speech. Direct workflow responses already explain missing tools such as axes, logs, tinderboxes, nets, and low-health blockers. Stuck movement now reports recognized visible fence blockers once before recovery. Remaining gap: benchmark/manual proof that nearby humans see the cadence during normal play.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: benchmark-seeded goals now begin the presence-beacon cadence after the first share interval even when Brain never had to announce the goal. Focused test covers this regression, and live autonomous `fishing-cooking-10m` passed while recording public status lines with location, goal, and next step in trajectory evidence (`/tmp/oniondao-fishing-cooking-beacon-bench-current/bench_20260521165903_fishing_cooking_10m.json`, score 1, `trajectorySays=6`).
  - Verified 2026-05-23 on `agents/wip`: woodcutting beacons no longer pair a tree-chopping goal with unrelated NPC talk as the next step. Regression test covers the dashboard mismatch from live QA; full checks passed, and refreshed live controller session `local-91643` showed goal-aligned woodcutting speech plus woodcutting/firemaking XP progress.
  - Verified 2026-05-24 on `agents/wip`: live post-revival soak showed strong action reliability but semantically repetitive "I am online..." presence beacons. Long-running beacons now rotate through observational local-context phrasing while preserving goal and next-step text. Focused tests cover stable direct/early status plus an exact varied phrase; full checks passed. Live controller `local-35899` then emitted "I am working my route. Nearby I see 27 trees..." and continued with 7/7 successful actions on the dashboard/action log.
  - Hardened 2026-05-24 on `agents/wip`: fresh scouting beacons now preview the exploration action (`scout the tree stand`, `check the landmark`, or `patrol toward`) before the later woodcutting/firemaking pivot window opens, so public chat better matches what the agent is visibly doing in the next few ticks.
  - Hardened 2026-05-24 on `agents/wip`: active return-to-anchor beacons now say the agent is returning to its findable point instead of advertising nearby trees/items, so long walk-back chains look intentional to human observers and dashboard readers. Live controller `local-56763` then ran 21/21 successful post-restart actions across movement, chopping, firemaking, scouting speech, and stuck recovery while the dashboard reported `onion.runescape.standard@0.1.0`.
  - Hardened 2026-05-24 on `agents/wip`: due Brain turns now suppress only the generic presence beacon, so organic Brain `say` output can surface knowledge/lore instead of being replaced by `I am online... Goal: ...`. Deterministic useful Body routines still outrank Brain when they have a concrete action.

- `[~]` **F2: Nearby human reaction.**
  - Files: standard module Body/Brain code and tests
  - Deliverable: agent hears public chat, responds to direct commands, asks clarifying questions, and follows simple requests.
  - Verification: perception/chat tests for command prefix, direct name mention, and non-command small talk.
  - Partial 2026-05-21: agent ignores its own resident chat but responds to another resident/player peer; resident speech now broadcasts to nearby resident perception events.
  - Partial 2026-05-22: direct-chat fallback now distinguishes small talk from unknown addressed commands, gives a useful capability hint instead of a vague acknowledgement, and tests both paths without Body inference.
  - Verified 2026-05-23 on `agents/wip`: fresh autonomous `follow-and-chat-5m` live benchmark passed (`runId=bench_20260523121235_follow_and_chat_5m`, `score=1`, `selectedModuleActions=10`, `selectedModuleInferences=5`, `movedTowardSpeaker=1`, `statusResponses=2`, `waitAcknowledgements=4`, `stuckProgressTicks=0`). Dashboard benchmark detail showed pass status, leaderboard, move/say evidence, metrics, and the follow/status/wait/resume summary.
  - Verified follow-up 2026-05-23 on `agents/wip`: follow/listen mode now keeps the resident on the human-visible follow goal instead of letting Brain announce unrelated skilling goals or Body explore while waiting. Focused regressions cover visible and temporarily missing follow targets with zero inference.

- `[x]` **F3: Stuck recovery.**
  - Files: Body routine extraction files
  - Deliverable: after repeated failed movement or unreachable target attempts, agent tries alternate target, steps back, returns to anchor, or asks for help.
  - Verification: tests simulate blocked tree/fence and assert recovery, not tiny-step loops.
  - Partial 2026-05-21: committed movement tracks stationary ticks, opens nearby doors/gates first, reports visible fence blockers once, then switches to a patrol recovery move. Remaining gap: broader alternate-path tests, help-request speech when no useful recovery exists, and live benchmark/manual proof.
  - Partial 2026-05-22: if the patrol recovery move itself makes no visible progress, the agent now says where it is stuck and asks nearby humans to lead it or open a route instead of silently looping recovery. Focused hybrid thinking test passed. Remaining gap: live/manual proof and broader alternate-path fixtures.
  - Verified 2026-05-23: dynamic stuck recovery phrasebook system integrated, fully typechecked, and verified via extensive unit and monolith tests passing flawlessly.
  - Hardened 2026-05-24 on `agents/wip`: live QA found a tree approach that kept changing position without reducing distance, so stationary-only stuck detection was too weak. Committed moves now track best target distance and switch to stuck recovery after a non-closing plateau, while focused regressions cover fresh lifecycle tracking, short detours, persisted old move state, and terminal woodcutting recovery. Live controller `local-4674` recovered from the stuck tree, chopped a new tree, lit logs, resumed scouting, and dashboard showed SPARK active.
  - Hardened 2026-05-24 on `agents/wip`: E3a showed `move_to(X,Y)` timeout followed by `continue_move(X,Y)` timeout. Runtime now records timed-out direct-coordinate moves as target cooldowns, and thinking clears active moves whose targets are cooled down instead of retrying them. Focused regressions cover both layers. A 10-minute live smoke on `local-73959` saw 70 actions, 69 success / 7 timeout results, and zero repeated same-target `continue_move` timeout pairs. Residual raw movement timeouts remain a BODY instrumentation follow-up.
  - Instrumented 2026-05-24 on `agents/wip`: residual coordinate `move_to` timeouts now record target, range, start/final position, start/final distance, improvement, and timeout budget in action-result evidence. Focused regression, full gates, full Jest, and live controller `local-69366` confirmed 3/3 sampled residual timeouts were slow-but-improving partial movement (`3 -> 2`, `6 -> 5`, `3 -> 2`) rather than dropped actions or repeated same-target retries.
  - Hardened 2026-05-24 on `agents/wip`: timed-out coordinate moves that clearly reduce target distance now resolve as `movement_progress` success instead of hard `timeout`, so valid one-tile fallback movement from the action adapter does not poison the target cooldown. Focused red/green regression, full gates, full Jest, and live controller `local-25657` passed after reviving `res:agent` via patron attention: 14/14 action results succeeded, including public speech, movement, woodcutting, and firemaking.
  - Hardened 2026-05-24 on `agents/wip`: live QA found coordinate-only movement cooldowns (`target:X,Y,0`) did not filter matching object targets, so woodcutting could reselect a timed-out tree. Failed-target filtering now checks both object-specific and coordinate keys. Focused red/green regression, full gates, full Jest, and live controller `local-22706` confirmed `res:agent` immediately chose fresh tree targets (`3187,3254`, `3191,3252`, `3200,3255`) instead of retrying `3190,3255`.
  - Hardened 2026-05-24 on `agents/wip`: presence-beacon "Next:" text now shares the target-failure filter used by Body routines, so observers do not see the agent announce an unreachable/timed-out tree after its action loop has already moved on. Focused red/green regression covers coordinate-only failed tree targets.
  - Hardened 2026-05-24 on `agents/wip`: committed movement now treats equal-distance tile changes as short detour progress, but caps repeated lateral movement so it still switches tactics after three no-closing detours. Stuck pre-inference recovery now rejects repeated landmark `say` reports, avoids target-failed/visibly occupied patrol coordinates, and falls through to Body inference instead of emitting an already-in-range no-op move when boxed in. Focused red/green regressions, hybrid suite, typecheck, lint, build, full Jest, subagent review, wall/dashboard smoke, and live controller `local-16396` passed: 7/9 action results succeeded, 9 unique move targets, 0 repeated continue-move timeout pairs, 0 repeated landmark stuck says.
  - Hardened 2026-05-26 on `agents/wip`: whole-city smoke found `res:agent` chaining broad `stuck_pre_inference_explore` hops in blocked Lumbridge terrain. Stuck pre-inference recovery now tries adjacent one-tile probes before wider patrol fallback and skips broad `explore_patrol` moves while stuck. Focused red/green regressions and full `npm run fin` passed.
  - `[x]` Hardened 2026-05-26 on `agents/wip`: live `res:agent` still showed timeout churn when every adjacent stuck probe was on exploration cooldown. Stuck mode now reuses a local adjacent fallback before widening to broader patrol targets. Focused red/green regression, full hybrid suite, `npm run fin` (2074 tests), build, post-restart smoke, and 120s live `res:agent` smoke passed with 4/4 observed action results successful and 0 observed timeouts.

- `[x]` **F4: Exploration loop.**
  - Files: Brain planner, Body routines, knowledge docs
  - Deliverable: agent walks to visible landmarks, reports what he sees, records useful places, and returns to anchor periodically.
  - Verification: local live test or simulation where dashboard shows meaningful movement and chat.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: `explore-report-5m` now seeds a local scouting goal instead of relying on Brain drift. Focused thinking test covers initial exploration movement without deep inference, and live autonomous benchmark passed (`status=passed`, `score=1`, `selectedModuleActions=3`, `positionChanged=1`, `informativeReports=1`, `trajectorySays=2`, artifact `/tmp/oniondao-explore-report-seeded-bench/bench_20260521172341_explore_report_5m.json`).
  - Hardened 2026-05-24 on `agents/wip`: scouting now treats scavenged ground-item pickups as exploration visits, so a short pickup cooldown expiring does not pull the resident back into the same coin spawn loop during a longer scouting/skill-practice arc. Focused red/green thinking and body-routine regressions passed. Live controller `local-25805` ran 5 minutes with 47 actions, moved from Lumbridge toward sheep fields, chatted goals, chopped/lit once, talked to NPCs, and had no repeated same-spawn pickups.
  - Hardened 2026-05-24 on `agents/wip`: exploration NPC sampling now cools down same-key NPC families after one talk target, so scouting does not burn a whole field visit trying to talk to every sheep. Focused body/thinking red-green tests passed. Live controller `local-2214` ran 5 minutes with 26 actions, no failures, no repeated same-family NPC talks, dashboard online, and continued chopping/firemaking/scouting afterward.
  - Hardened 2026-05-24 on `agents/wip`: presence-beacon "Next:" narration now uses the same pickup/exploration cooldown context as Body routines, so observers do not see stale goals like "pick up coins" or "talk to Sheep" after those targets have already been sampled. Focused beacon tests cover pickup cooldowns, exploration item cooldowns, NPC-family cooldowns, and object cooldowns.
  - Hardened 2026-05-24 on `agents/wip`: a 27-minute live soak found repeated `target_not_found` failures from free exploration clicking map doors/gates. Hybrid autonomous exploration now disables brittle openable interactions while preserving the dedicated stuck-open reflex; focused body/thinking tests cover the split, and live controller `local-4674` had zero free-open attempts or stale door/gate beacons during a follow-up smoke.
  - Hardened 2026-05-24 on `agents/wip`: exploration patrol no longer chooses a visibly object-occupied tile as the next patrol hop. Focused body-routine regression covers object-occupied candidate skipping, reducing blocked micro-hops during free scouting.
  - Hardened 2026-05-24 on `agents/wip`: scouting now treats visible tree stands, including higher-level trees such as oaks, as meaningful landmarks instead of falling back to tiny patrol hops or generic scenery classification. Focused body/thinking regressions and full gates passed; dashboard live QA kept `res:agent` active under the standard SPARK module with visible movement/progress telemetry.

- `[x]` **F5: Combat survival personality.**
  - Files: nervous rules, combat workflow, standard module
  - Deliverable: agent eats when hurt, attacks weak aggressors when reasonable, runs when outmatched, and explains danger.
  - Verification: combat fixture tests and one live local smoke if available.
  - Verified 2026-05-23: fully implemented with exposed combatLevel, weakest aggressor selection (lowest HP, lowest combat level, closest Chebyshev distance), decision classification (retaliate_confident, retaliate_after_eat, retreat_outmatched, retreat_low_hp), episode deduplication, and kill celebration. Tested F5-T1 through F5-T9 targeting all registers (achiever, mentor, endurer, default) successfully.

- `[x]` **F6: Default-SPARK idle initiative for quiet residents.** Some non-hybrid, non-anchored residents can tick without hooks and never hit watchdog fallback, so they are technically alive but invisible to observers.
  - Filed 2026-05-24 on `agents/wip`: live M8 verification on `local-93740` found `res:thrand` producing only begin/end tick evidence in a short soak while other residents spoke or moved. Design a bounded no-hook cadence for default-SPARK residents: occasional display-name status line, safe local patrol or anchor return when available, and dashboard-visible evidence without spamming public chat.
  - Started 2026-05-24 on `agents/wip`: Codex is adding a no-inference, low-cadence default idle pulse for no-hook ticks, using display-name speech plus a safe first-step movement candidate.
  - Verified 2026-05-24 on `agents/wip`: default-SPARK no-hook ticks now emit a cadence-gated `idle_initiative` speech/action without calling inference; cadence is persisted as `lastIdleInitiativeTick`. Focused red/green tests, typecheck, lint, build, full Jest, and live controller `local-73320` passed. Live root cause note: Thrand was also `attention_exhausted`; after `npm run controller:revive -- --resident res:thrand`, he said `Still here as Thrand; watching the area.` and performed an `idle_initiative` move.
  - `[x]` Hardened 2026-05-25 on `agents/wip`: hero idle pulse cadence is 30s so a 45s broad-smoke window does not miss Duke/Pip/Hans when empty completions add latency. Focused SPARK evidence test, `npm run fin` (1881 tests), build, and live 45s cohort smoke passed.
  - `[x]` Hybrid hardening 2026-05-25 on `agents/wip`: default Brain and inferred small-talk requests now cap at 20s unless a SOUL overrides them, preserving fast Brain priority while preventing slow thinking from hiding residents. Focused red/green tests, `npm run fin`, build, and live 45s cohort smoke passed.

- `[x]` **F7: Hero empty-completion recovery.** HD-042/F51 showed heroes alive but producing many `_none` decisions when default-SPARK idle reflection returned no useful JSON action.
  - Started 2026-05-24 on `agents/wip`: Codex is adding named `empty_completion` decision causes and a cadence-limited fallback into existing hero idle initiative when an empty completion lands on a due tick. Intended proof: focused SPARK/evidence tests, full gates, and a live post-restart trajectory sample showing heroes no longer emit `_none` for empty completions.
  - Verified 2026-05-24 on `agents/wip`: no-hook cooldown ticks now return `hook_noop`, empty JSON completions return `empty_completion`, and due empty completions can trigger the visible `idle_initiative` pulse. Fresh full Jest, typecheck, lint, build, and live controller `local-3590` passed; a 19-resident trajectory sample over 234 ticks each showed `none: 0` decision causes, with heroes still speaking and watchdog-moving when relevant.
  - Review hardening 2026-05-24: Lovelace found no-cause action/noop-candidate completions could still emit anonymous decisions outside the live sample. Codex added explicit fallback causes (`candidate_fallback`, `completion_action`, `plan_generated`, `completion_self_modification`, `completion_memory_update`, `completion`) with red/green tests. Fresh full Jest/typecheck/lint/build passed, and live controller `local-12513` showed `totalNone: 0` across 178 sampled decisions.


## Workstream G: Real Gameplay Workflows

**Purpose:** Expand from "can make a fire" to basic RuneScape loops.

- `[x]` **G1: Woodcutting plus firemaking loop.**
  - Deliverable: find level-appropriate tree, chop logs, make fire, repeat safely.
  - Success metric: produces at least one fire from self-chopped logs in benchmark or live test.
  - Verified 2026-05-21 on `nullcity`: autonomous `woodcutting-firemaking-10m` passed (`status=passed`, `score=1`, artifact `/tmp/oniondao-wood-fire-bench-post-stale-log-fix/bench_20260521072605_woodcutting_firemaking_10m.json`). This pass also suppresses stale fire-adjacent log pickups and stale "Next: pick up logs" beacons after firemaking consumes the logs.
  - Verified follow-up 2026-05-22 on `codex/q-stuck-recovery`: self-owned `rs:logs` are now treated as stale pickup bait in Body routines and presence-beacon next-step suggestions. Focused tests cover both paths, and a live controller loop moved to a tree, chopped, lit a fire, then resumed fresh woodcutting instead of chasing the consumed self-owned logs.

- `[x]` **G2: Fishing plus cooking loop.**
  - Deliverable: find fishing spot, use small net, catch shrimp, cook on range/fire when available.
  - Success metric: inventory changes from raw shrimp to cooked shrimp or clear failure explanation.
  - Partial 2026-05-21 on `claude/evidence-loop-p1`: added deterministic starter cooking behavior. `agent cook shrimp` uses carried raw shrimp/anchovies on a visible fire/range without inference, active starter-fishing goals cook raw catches before more net fishing, and missing heat is explained in chat. Focused thinking tests, typecheck, lint, build, and full Jest suite passed. Remaining gap: live or benchmark proof that raw fish changes to cooked fish in-game.
  - Partial 2026-05-21 on `claude/evidence-loop-p1`: added `fishing-cooking-10m` verifier/CLI wiring, autonomous selected-module proof requirements, false-positive coverage for externally supplied fish and cooked fish without a cooking action, benchmark-goal seeding, and scripted fallback to make a cooking fire when raw fish is ready. Focused benchmark/thinking tests and benchmark dry-run passed. Remaining gap: live autonomous benchmark proof against the local server.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: live autonomous `fishing-cooking-10m` passed against the local server with `onion.runescape.standard` (`status=passed`, `score=1`, artifact `/tmp/oniondao-fishing-cooking-bench/bench_20260521162350_fishing_cooking_10m.json`). The run showed the module netting fish, making a fire from carried logs and tinderbox, and attempting cooking actions under benchmark observation.
  - Verified 2026-05-23 on `agents/wip`: fresh autonomous `fishing-cooking-10m` live benchmark passed (`runId=bench_20260523124242_fishing_cooking_10m`, `score=1`, `selectedModuleActions=8`, `selectedModuleInferences=4`, `successfulNetActions=1`, `cookingSuccess=1`, `cookedFishGained=1`, `orderedActionChain=1`). Dashboard benchmark detail showed pass status, leaderboard, net/cooking evidence, metrics, and the cooked-food summary.
  - Hardened 2026-05-24 on `agents/wip`: blocked-range fishing/cooking recovery now keeps the resident on the catch-then-cook goal, starts disposable/QA anglers with an axe, only makes cooking fires after raw fish is present, and can chop visible trees for replacement cooking logs when carrying raw fish plus tinderbox plus axe. Live autonomous benchmark passed (`runId=bench_20260524232332_fishing_cooking_10m`, `score=1`, artifact `/tmp/oniondao-angler-self-sufficient-bench-2/bench_20260524232332_fishing_cooking_10m.json`).
  - Re-verified 2026-05-25 on `agents/wip`: after the live B3 fishing/cooking repairs, autonomous `fishing-cooking-10m` passed (`runId=bench_20260525212803_fishing_cooking_10m`, `score=1`, `selectedModuleActions=10`, `successfulNetActions=1`, `successfulCookingActions=2`, `orderedActionChain=1`, `externalFishSupplyActions=0`). Persistent `res:qa-angler` then passed a 10-minute smoke (`+998t`, `41` observed actions, `46` successful results, `0` fails), with trajectory evidence showing range cooking, eating cooked fish for space, returning to the fishing spot, and netting again.

- `[x]` **G3: Prayer starter loop.**
  - Deliverable: bury bones from inventory or safe defeated enemies.
  - Success metric: prayer XP/level evidence or action success event.
  - Verified 2026-05-21 on `nullcity`: `combat-prayer-10m` live autonomous smoke proved safe goblin combat, bones pickup, burial, Prayer XP, and survival under `onion.runescape.standard`.
  - Verified 2026-05-23 on `agents/wip`: initial fresh rerun timed out after walking to bones without picking them up; the interaction-pipeline approach fix (`e72bfcff`) made Body click distant loot and combat targets directly. Fresh autonomous `combat-prayer-10m` then passed (`runId=bench_20260523132944_combat_prayer_10m`, `score=1`, `duration=1m38s`, `selectedModuleActions=28`, `selectedModuleInferences=12`, `safeAttackActions=12`, `pickupBonesActions=2`, `buryActions=2`, `prayerXpIncreased=1`, `deathEvents=0`). Dashboard detail showed pass status plus attack, pickup, bury, and Prayer metrics.

- `[x]` **G4: Trading/giving items.**
  - Deliverable: request trade, offer simple item, accept/decline safely, describe trade state.
  - Success metric: test covers trade request, offer, accept, and decline.
  - Started 2026-05-23 on `agents/wip`: Codex is adding a dedicated benchmark/verifier so the scattered G4 action tests become a repeatable proof of visible trading behavior.
  - Verified 2026-05-23 on `agents/wip`: `trading-giving-5m` now covers request, safe item offer, two-stage accept, unsafe decline, CLI registration, and live autonomous proof against the local server (`score=1`, run `bench_20260523092537_trading_giving_5m`).
  - Verified 2026-05-23 on `agents/wip`: fresh dashboard-visible autonomous `trading-giving-5m` proof passed (`runId=bench_20260523134244_trading_giving_5m`, `score=1`, `duration=40s`, `selectedModuleActions=20`, `selectedModuleInferences=10`, `peerTradeCommands=2`, `tradeRequests=4`, `safeItemOffers=2`, `acceptStage1=2`, `acceptStage2=2`, `unsafeDeclines=2`, `tradeCompletedEvents=1`, `tradeCancelledEvents=1`). Dashboard API and browser detail showed pass status, trade metrics, module identity, and action evidence.
  - Verified follow-up 2026-05-23 on `agents/wip`: a fresh live run first timed out because the resident moved toward a trade speaker, forgot the trade command, then wandered/stuck. Pending direct-trade memory now completes `move_to -> trade_request`; rerun `bench_20260523142857_trading_giving_5m` passed (`score=1`, `stuckProgressTicks=0`, `safeItemOffers=2`, `acceptStage1=2`, `acceptStage2=2`, `unsafeDeclines=2`).

- `[~]` **G5: Follow and command loop.**
  - Deliverable: agent follows configured player, responds to "agent come here", "agent make fire", "agent stop", "agent status".
  - Success metric: local browser test with human client can see movement or chat within 10 seconds.
  - Partial 2026-05-21: `follow-and-chat-5m` proves the standard module reacts to a benchmark peer's exact per-run "agent follow me" prompt, moves, then answers that peer's "agent status" prompt in autonomous mode. Still needs browser/manual human-client confirmation and broader command-loop benchmark coverage.
  - Verified 2026-05-23 on `agents/wip`: added direct "help / what can you do" command discovery and upgraded `follow-and-chat-5m` to v0.3 requiring help response evidence. Fresh autonomous live run passed (`runId=bench_20260523145618_follow_and_chat_5m`, `score=1`, `helpCommands=2`, `helpResponses=4`, `stuckProgressTicks=0`), with `direct_chat_help`/`direct_chat_stop` action causes preserved for attribution. Remaining gap: browser/manual human-client confirmation.
  - Started 2026-05-24 on `agents/wip`: HD-035 will let `patron:ask` inject a live chat perception into the running resident, so a human/operator question can trigger immediate nervous-system and trajectory evidence instead of waiting for a later Brain wake.
  - Verified 2026-05-24 on `agents/wip`: HD-035 is wired through Controller MCP. `patron:ask` now persists a `patron_ask` Library event, injects a live `source=patron:ask` chat perception, triggers an immediate no-inference Nervous `say` acknowledgement, and filters CLI reply polling by `nervous:patron-ask-acknowledge` so unrelated speech is not misreported. Live controller `local-41249` proof: `hd035-second` ask returned the resident reply in the CLI, Library timeline, active trajectory action/result, and dashboard Nervous System panel (`rule patron-ask-acknowledge-hd035-second`). Remaining gap: manual web-client player confirmation for ordinary nearby chat.
  - Completed 2026-05-24 on `agents/wip`: added SDK-over-HTTP MCP integration coverage for `patron_ask`, matching the live proof path instead of only exercising the registered tool handler directly.

## Workstream H: Railgun And OnionDAO Operations

**Purpose:** Make this usable by the team, not just on one laptop.

- `[x]` **H1: Write SPARK module author guide.**
  - Files: `docs/spark-module-authoring.md`
  - Deliverable: how to create a reviewed in-repo module, choose manifest fields, write tests, run benchmarks, and open a PR.
  - Verification: guide links to real files and commands.
  - Verified 2026-05-21 in this pass: added concise reviewed-module authoring guide covering current boundaries, safe facades, manifest capabilities, tests, and verification commands.

- `[~]` **H2: Write Railgun deployment guide.**
  - Files: `docs/railgun-controller-deployment.md`
  - Deliverable: required env vars, gateway auth, log/artifact dirs, dashboard URL, controller start commands, safety rules.
  - Verification: security review confirms no tokenless public/private-network control.
  - Partial 2026-05-21 in this pass: added deployment guide and fixed the knowledge runbook sample to include `gateway.authToken`, `residents`, and `souls.dir`. Exact Railgun gateway/dashboard URLs, secret names, persistent artifact sink, and module distribution policy still need OnionDAO decisions.

- `[x]` **H3: Add module experiment workflow.**
  - Files: `docs/spark-module-experiments.md`
  - Deliverable: how OnionDAO members compare modules with benchmarks and dashboard artifacts.
  - Verification: dry run with fixture artifacts.
  - Verified 2026-05-21 in this pass: added experiment workflow doc with scripted-vs-autonomous warning, benchmark commands, comparison metrics, and artifact expectations. Existing benchmark CLI dry-run coverage remains in C5; autonomous ranking still depends on C6.

- `[x]` **H4: Define update process for this roadmap.**
  - Files: this file
  - Deliverable: every PR that changes agent behavior updates task status and links benchmark/test evidence.
  - Verification: PR checklist includes roadmap update.
  - Verified 2026-05-21 in this pass: this roadmap now includes an agent update protocol, verification commands, and a PR checklist requiring roadmap status plus benchmark/test evidence for behavior changes.

## Workstream I: Library Of Souls Evidence

**Purpose:** Turn resident actions, relationships, death, and recovery into durable story artifacts that humans and future agents can inspect without reading raw JSONL logs.

- `[x]` **I1: Record relationship milestones.**
  - Files: `src/controller/evidence/significance.ts`, `src/controller/evidence/library-updater.ts`, `src/controller/evidence/portrait-template.ts`
  - Deliverable: first peer encounters and repeated interactions become timeline events and portrait relationships.
  - Verification: focused evidence tests, then full typecheck, lint, build, and Jest suite.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: first peer encounters and repeated interactions now append Library timeline events, hydrate restart-safe relationship counters, and render portrait "Who they knew" entries. Focused evidence tests, typecheck, lint, build, and full Jest suite passed.

- `[x]` **I2: Record survival milestones.**
  - Files: `src/controller/evidence/significance.ts`, `src/controller/evidence/library-updater.ts`, `src/controller/evidence/portrait-template.ts`
  - Deliverable: dangerous HP drops followed by healing/recovery become timeline events and portrait life notes.
  - Verification: focused evidence tests, then full typecheck, lint, build, and Jest suite.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: dangerous HP losses now arm a survival milestone, later HP recovery appends a `near_death_survival` timeline event, and portraits summarize the life as "The survivor" with a notable event. Focused evidence tests, typecheck, lint, build, and full Jest suite passed.

- `[x]` **I3: Record unfulfilled wants at life end.**
  - Files: `src/controller/evidence/library-updater.ts`, `src/controller/evidence/portrait-template.ts`
  - Deliverable: resident wants spoken during a life become explicit `wants_unfulfilled` timeline events when that life ends.
  - Verification: focused evidence tests, then full typecheck, lint, build, and Jest suite.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: legacy events now append deduped `wants_unfulfilled` records for spoken wants in that life before closing the life, and portraits summarize them as "Still wanted ...". Focused evidence tests, typecheck, lint, build, full Jest suite, and `git diff --check` passed.

- `[x]` **I4 (I-β): Feed Library timeline memories back into resident prompts.**
  - Files: `src/controller/evidence/library-memories.ts`, `src/controller/memory/memory-store.ts`, `src/controller/thinking/hybrid-agent-*.ts`, `src/controller/spark/spark.ts`
  - Deliverable: recent `library/<resident>/timeline.jsonl` events are visible to both the standard RuneScape Brain/Body prompts and the legacy prompt envelope path.
  - Verification: red/green prompt integration tests, typecheck, lint, build, and full Jest suite.
  - Started 2026-05-23 on `agents/wip`: wire Claude's pure Library reader into the runtime prompt paths so a resident can remember recent story/patron events instead of only writing them.
  - Verified 2026-05-23 on `agents/wip`: `MemoryStore.retrieve()` now prepends bounded recent Library timeline memories; standard Hybrid Brain/Body prompts and the legacy SPARK envelope path render those memories. Focused red/green tests, typecheck, lint, format, build, full Jest, and `git diff --check` passed.

- `[x]` **I5: Prove Library memory recall through a benchmark.**
  - Files: `src/controller/benchmarks/**`, `src/controller/thinking/hybrid-agent-thinking-module.ts`
  - Deliverable: autonomous benchmark seeds prior Library events, asks the resident a normal nearby-player question, and verifies the resident recalls the seeded person/item/promise in public chat.
  - Verification: red/green benchmark verifier + CLI tests, focused thinking prompt test, dry-run, typecheck, lint, build, and full Jest suite when no parallel WIP tests are active.
  - Started 2026-05-23 on `agents/wip`: add a `memory-recall-3m` task and ensure non-command chat replies can see Library memories.
  - Verified 2026-05-23 on `agents/wip`: `memory-recall-3m` seeds Library memories, prompts normal nearby-player recall chat, rejects JSON-like prompt echo, and passed live autonomous score=1. Format, lint, typecheck, build, full Jest 1092/1092, and `git diff --check` passed.

- `[x]` **I6: Recover corrupt evidence indexes.**
  - Files: `src/controller/evidence/evidence-store.ts`, `src/controller/evidence/evidence-store.test.ts`
  - Deliverable: one malformed `evidence/index.json` cannot disable story/action/progress logging for a resident.
  - Verification: red/green evidence-store regression, full gates, and live controller restart without evidence init failure.
  - Verified 2026-05-24 on `agents/wip`: local QA found `res:father-aereck` evidence disabled by a zero-byte index; `EvidenceStore` now quarantines corrupt indexes and starts a fresh session. Focused red/green test, full gates, Jest 1493/1493, and live controller restart passed with a new active evidence index.

- `[x]` **I7: Prompt and record Brain-written memories.**
  - Files: `src/controller/thinking/hybrid-agent-prompts.ts`, `src/controller/thinking/hybrid-agent-thinking-module.ts`, `src/controller/resident-runtime.ts`, `src/controller/spark/spark.ts`
  - Deliverable: the standard Hybrid Brain can write sparse first-person memo notes when it learns, changes goal, responds to a player, completes a step, or changes tactic; runtime decision evidence records memo/update and goal-change telemetry for dashboard/verifier scans.
  - Verification: prompt regression, scripted Brain memo write, runtime trajectory evidence test, then typecheck/lint/build/Jest and a live controller soak that produces nonzero organic memo/plan-change evidence.
  - Verified 2026-05-24 on `agents/wip`: Codex resolved E2c/E2d from `docs/intelligence-verification-log.md` by adding the prompt contract and telemetry plumbing; fallback plan telemetry is included for Brain watchdog backoff. Focused prompt/thinking/runtime tests, typecheck, lint, build, full Jest 1513/1513, and live smoke passed. Live `local-77175` produced nonzero organic `memoUpdates` + `planChange`, wrote a first-person memo, said a goal/location line, chopped, and lit a fire with 5/5 action results successful.

## Workstream J: Patron / Human-Attention Loop

**Purpose:** Give Runescape players a concrete reason to care about residents — attention as a clock, refill verbs, standing tiers, letters, credit surfaces. Adapted from v2 Shards mechanics with RS-flavored in-world surfaces. Detailed item provenance in `docs/null-city-ideation-backlog.md` Theme 4. Spec: `docs/superpowers/specs/2026-05-22-patron-loop-design.md`.

- `[~]` **J1: Currency + attention decay clock.** Resident attention decays per tick; refill via in-game patron offering. Currency name + decay rate pinned in rs6.
  - Hardened 2026-05-23 on `agents/wip`: attention exhaustion now submits a single logout and suppresses normal thinking/body actions, and patron attention refill clears only the `attention_exhausted` marker so revived residents can resume play. Focused runtime + patron tests passed.
  - Tuned 2026-05-24 on `agents/wip`: the default `res:agent` starter soul now uses a long-lived local QA attention profile (`120000`, gentle) so the main visible test resident can run through meaningful dashboard/play sessions before needing patron refill.
  - Verified 2026-05-24 on `agents/wip`: Codex added explicit SOUL `respawnPolicy`; `res:agent` opts into `on_restart` and revives from persisted `attention_exhausted` state with its configured starter attention, while heroes/manual residents remain deceased by default. Focused schema/loader/runtime tests, typecheck, lint, format check, build, full Jest, and live controller smoke passed. Live `local-39142` revived from dead state, showed online on the dashboard, then said a goal, moved, chopped a tree, made a fire, and continued exploring with 8/8 successful actions.
- `[x]` **J2: Mercy infusion (refill) verb.** In-game NPC interaction (e.g., "pray for", "offer to") at resident chathead → +N attention for M units of currency.
  - *Completed: Implemented in PatronGateway.offerTo to deduct player shards, boost resident attention, and log standing points.*
- `[x]` **J3: Standing tier system.** Four-tier rs6 reputation thresholds (canonical 10/30/75 from v2, rs6 names TBD via maintainer decision).
  - *Completed: StandingLedger implemented with canonical thresholds (Stranger/Acquaintance/Ally/Officer).*
- `[x]` **J4: Letters system.** Four canonical kinds (`standing | epitaph | civic | broadcast`). In-game scroll/postbag delivery + web inbox parity. Denormalised sender snapshot preserved post-death.
  - Completed 2026-05-25 on `agents/wip`: `standing_tier_crossed` and `epitaph` dispatch already working. `civic_milestone / embassy_visit` letters now dispatched by `PatronGateway.witnessAt` whenever a patron witnesses a named resident. Added `broadcast` kind to letters-producer and wired it to send letters to all active patrons on resident death.
- `[x]` **J5: Credit surfaces near landmarks.** "Funded by / founded by / witnessed by" plaques readable in-game; mirrored on dashboard.
  - *Completed: Landmark witnessing implemented via witnessAt on PatronGateway, logging patron actions to library timeline.*
- `[x]` **J6: Visitor-born resident ritual.** Three-part cost (rs6-flavored kindling/inscription/vow) totaling ~24 currency + 24h cooldown per Handler.
  - *Completed: Birth sponsorship implemented via sponsorBirth in PatronGateway with three-part debits and 24h cooldown validation.*
- `[x]` **J7: Daily check-in + referral drips.** +1/day, +2/referral via staff scan.
  - Verified 2026-05-25 on `agents/wip`: `CheckInTracker` substrate was already complete; wired to CLI + persistent `PatronStore` (`patron-check-in.json`). `patron:checkin --human <id>` credits +1 Shard idempotently per UTC day; `patron:referral --human <referrer> --referred <new>` credits +2 Shards to referrer on first attendance (no double-credit, no self-referral). +7 tests (3 parser + 4 runPatronCli). Tests 1760/1760 + typecheck + lint + format green.
- `[x]` **J8: Patron event ingestion.** Wire patron offering / mercy infusion / birth sponsorship / parcel ratification events into the Evidence Layer's `patron` line shape (consumer side is Workstream I's library).
  - *Completed: Integrated in PatronGateway to record all actions to both the trajectory builder and the library timeline.*
- `[x]` **J9: Visible patron acknowledgement loop.** Residents should visibly thank patrons after out-of-band Shards/support events reach Library memory, without relying on the LLM to notice.
  - Started 2026-05-24 on `agents/wip`: HD-031 deterministic nervous-system patron-memory reflex; verify with focused tests, full gates, and live patron-offer smoke.
  - Verified 2026-05-24 on `agents/wip`: Codex added a memory-backed nervous reflex that thanks the latest unacknowledged patron gift, collapses backlog thanks into one line, and keeps survival reflexes higher priority. Focused tests, typecheck, lint, format, build, full Jest, and live `codex-hd031-smoke` patron-offer smoke passed; live controller `local-16152` produced 23/23 successful actions including the visible Shards thanks.
- `[x]` **J10: Live controller offer ingestion.** `patron:offer` should prefer the running controller MCP path so live runtime attention/evidence and visible thank-you reflexes update immediately; offline disk-only fallback remains for no-controller staff workflows.
  - Started 2026-05-25 on `agents/wip`: live QA proved grant→offer→inbox→wall passes, but the running resident did not ingest the offer or thank the patron because the CLI offer path used a mock runtime.
  - Verified 2026-05-25 on `agents/wip`: `patron:offer` now prefers the live controller MCP `patron_offer` tool when `CONTROLLER_MCP_*` is configured; the tool refreshes disk patron ledgers before offering, updates live resident attention/evidence, persists ledgers after success, and preserves offline fallback. Also hardened patron-thanks Nervous cooldowns across controller restarts where persisted runtime ticks and active perception ticks diverge. Validation: focused patron/MCP/host/nervous tests, full `npm run fin` (1900 tests), build, live controller restart, `controller:smoke` 23/23 OK, dashboard API 23 residents, wall snapshot 23 residents, inbox standing letter, and live proof: `codex-live-final-1779729348@onion` offer to Hans produced trajectory `patron_gift` at 17:16:02Z and visible chat "Thank you for the Shards..." at 17:16:02.968Z.
- `[x]` **J11: Batch patron registration (HD-011 mitigation).** `patron:bulk-register --file <path>` loads all handles from a plain-text file (one per line, blanks + comments stripped) into `controller.yml#patrons[]` atomically. Mitigates HD-011 re-upgrade: D3 in-world greetings (`fd575281`) require registry membership; a per-attendee one-liner is error-prone for 50+ visitors. Also added `patron:balance` + `patron:standing` self-service verbs (HD-016 partial) and updated `embassy-staff-runbook.md` pre-event section.
  - Verified 2026-05-25 on `agents/wip`: `patron:bulk-register --file /tmp/patrons.txt` registers all handles, skips blanks/comments, deduplicates, prints summary. +8 tests (4 parser + 4 integration). Tests 1914/1914 + typecheck + lint + format green.
  - Live re-verified 2026-05-26 on `agents/wip`: controller HTTP self-service routes are live on port 43596. `GET /v1/patron/balance?human=<known>` returned nonzero Shards, `GET /v1/patron/standing?human=<known>&faction=embassy` returned Officer standing, missing `human` returned 400, and a stranger returned Acquaintance next-tier guidance.

## Workstream K: Factions Adapted For Runescape

**Purpose:** rs6 needs its own four factions; v2's Solder Saints / Hatchery / Locksmiths / Ledgerwrights are Onion-DAO-flavored and don't translate to RuneScape lore. The four-faction shape + two tension axes + flagship NPCs + home rooms patterns transfer. Spec: `docs/superpowers/specs/2026-05-22-rs6-factions-design.md`. **This workstream requires maintainer creative input before any K-task can ship.**

- `[x]` **K1: Name the four rs6 factions.** Defaulted from Notion + drafted in spec: **The Foundry / The Bureau of Continuity / The Ledger / The Veil**. Mottos, colors, archetypes drafted. Maintainer to confirm or edit; an autonomous agent should USE the drafts to unblock work.
  - Verified 2026-05-25 on `agents/wip`: `src/controller/factions/factions.ts` exports `FactionId`, `FactionDefinition`, `FACTIONS` (4 entries), `FACTIONS_BY_ID`. All 4 factions have unique ids, display names, colors, and mottos. Catalog integrity tests (15 cases) all pass.
- `[x]` **K2: Define the two rs6 tension axes.** Drafted: **Making vs Remembering** (Foundry vs Bureau) + **Transparency vs Concealment** (Ledger vs Veil).
  - Verified 2026-05-25 on `agents/wip`: `TensionAxis`, `TensionPole` types exported. Each axis has exactly 2 factions, one at each pole. `TENSION_AXES` constant exported for consumers.
- `[x]` **K3: Seed four flagship NPCs.** Drafted (full soul fields) in spec: **Forgemaster Mother Anvil** (Foundry), **Archivist Severn** (Bureau), **First Witness Wren** (Ledger), **The Hush** (Veil). Maintainer to confirm voices; agent can ship them as-is via the seed script.
  - Verified 2026-05-25 on `agents/wip`: soul YAML files created for all 4 flagships in `src/controller/soul/starter-souls/`. `factionId` field added to `SoulFrontmatter` + `soulFrontmatterSchema` (z.string().min(1).optional()). Catalog integrity test added: verifies each `flagshipResidentSlug` file exists. Follow-up live-controller QA shortened runtime ids to gateway-valid names (`res:mother-anvil`, `res:severn-vesta`, `res:wren-calix`, `res:the-hush`) while preserving rich display names. Each soul has heroProfile (tier hero + anchor at POI coordinates), nervousSystem (4 rules: chat/hit/death/low-attention), faction-distinctive voice/goals/alignment. Workstream K complete (K1/K2/K3/K4/K5 all [x]).
- `[x]` **K4: Place the five rs6 rooms in-game.** Drafted coordinates (verify against RuneJS world): Atrium → Lumbridge Castle courtyard `(3222,3218,0)`; Foundry → Falador anvil `(3015,3357,0)`; Bureau → Lumbridge churchyard `(3242,3208,0)`; Ledger → Varrock Square `(3210,3424,0)`; Veil → Edgeville shadow `(3093,3493,0)`.
  - Verified 2026-05-25 on `agents/wip`: `PoiDefinition`, `POIS` (5 entries), `POIS_BY_ID` exported from `factions.ts`. Each faction's `homePoiId` resolves to a POI with matching `factionId`. One neutral atrium POI defined.
- `[x]` **K5: Visual treatment for The Veil.** Drafted: redacted-black `#0A0A0A` with `#660000` accent (carries forward v2's Locksmith treatment).
  - Verified 2026-05-25 on `agents/wip`: `VisualTreatment` type exported. Veil has `visualTreatment: 'redacted'`, `accentColor: '#660000'`. Non-Veil factions have `visualTreatment: 'standard'`. Tests assert this invariant.

## Workstream L: Cross-Resident Memory And Lore

**Purpose:** Residents that affect each other beyond independent action — interactions, projects, rumor. Largely unmined in v2. Spec: `docs/superpowers/specs/2026-05-22-cross-resident-lore-design.md` *(deferred until after J/K land — not load-bearing for June 1)*.

- `[x]` **L1: `interact_resident` action verbs.** `whisper`, `gift`, `assist_skill`, `challenge_duel` with typed preconditions.
  - Verified 2026-05-25 on `agents/wip`: implemented typed preconditions substrate (`interact-resident.ts`) and ResidentRuntime gating loop for whisper, gift, assist_skill, and challenge_duel. Added extensive unit testing for all validation rules.
- `[ ]` **L2: Resident-owned projects.** Long-running funded artifacts (shop, citadel room, herb patch). Pick three project archetypes for rs6 MVP.
- `[ ]` **L3: `world_events` or broadcast channel.** Shared data surface; ambient utterances propagate to adjacent rooms.
- `[ ]` **L4: Resident-perceived in-game events.** Player level-ups, PKs, quest completions, faction territory shifts in the perception envelope.

## Workstream M: Hero Residents And Story Arcs

**Purpose:** Named residents who become event focal points for human players. Spec: `docs/superpowers/specs/2026-05-22-hero-residents-design.md`.

- `[~]` **M1: Hero story-arc shape.** Pitch → fund → progress → resolve → letter. Resolution event template + faction effect.
  - Partial 2026-05-25 on `agents/wip`: Library portraits now compute a structured `storyArc` from timeline evidence and render a compact `## Current arc` section. The first classifier is monotonic inside a visible arc (`pitch -> fund -> progress -> resolve -> letter`), recognizes patron funding/progress/resolution/letter events, and avoids treating ordinary exploratory speech as a pitch.
  - Partial 2026-05-26 on `agents/wip`: `/v1/wall/snapshot` resident entries now expose `arcPhase` (pitch/fund/progress/resolve/letter) read from `library/<slug>/timeline.jsonl`; `public/wall/index.html` renders `arc: <phase>` label on each resident row. +3 red/green tests. Remaining: runtime resolution event template + faction effects (post-Chicago).
  - Partial 2026-05-25 in `rs6-nullcity-residents-dashboard`: roster rows now surface `storyArc` from Library portraits or current timelines and render a Story column with phase, latest evidence, and funding/progress counts. Verified with red/green dashboard tests, typecheck/check/build, live API proof, and browser DOM proof. Remaining: runtime resolution event template + faction effects (post-Chicago).
  - Portrait narrative quality hardened 2026-05-26 on `agents/wip` (commit ce85feab): `patronSentence` now describes ALL patron events ("alice gifted a tinderbox and witnessed this journey." instead of "alice recorded gift with a tinderbox."); `storyArcLine` drops raw evidence count columns; `isNotable` filters `say`/`patron_*` events already shown in dedicated sections; `eventSummary` adds `revival` case. +11 red/green tests. Tests 2085/2085 + typecheck + lint + format.
- `[x]` **M2: Lifespan tiers.** Flagships ~30 days, visitor-borns ~24 hours. Asymmetry is intentional.
  - Partial 2026-05-25 on `agents/wip`: live whole-city smoke found Hans had completed the generic endurer default after 50k ticks and was no longer ticking. Flagship hero endurers without explicit `targetTicks` now default to 4,320,000 ticks (~30 days at 0.6s/tick), and forced operator revival reopens old completed short endurer legacies when the new target has not been reached. Remaining: explicit visitor-born ~24h tier defaults.
  - Completed 2026-05-26 on `agents/wip`: visitor-born (novice) defaults to 144,000 endurer ticks (~24h at 0.6s/tick), and fixed patron sponsor schema validation errors (archetype/quirks/factionId).
- `[x]` **M3: `request_attention` action.** Hero NPC dialog or in-world begging surface; can also dispatch a letter to a recent patron.
  - Verified 2026-05-25 on `agents/wip`: nervous-system `requestAttentionReaction` fires after all soul rules as a fallback when hero `state.attention < floor + 5000`; cooldown 600 ticks; prefixes hero `publicName` in message; does not fire for residents without a declared floor. +7 tests (6 M3-named + 1 no-floor guard). Tests 1790/1790 + typecheck + lint + format.
  - `[x]` Follow-up 2026-05-25 on `agents/wip`: fixed post-restart tick-domain drift so newly written short attention-appeal cooldowns and long epitaph cooldowns stay active instead of replaying every tick. Focused red/green nervous-system tests, full `npm run fin` (1906 tests), build, fresh controller restart, 45s live smoke, dashboard API, and wall snapshot passed. Live `local-67694` showed 23 online residents; Hans/Duke/Pip/etc. produced authored SOUL/idle lines and movement instead of repeated embassy-offering appeal spam.
- `[x]` **M4: `prepare_epitaph` action.** When `lifespanTicks < threshold`, hero spends a tick writing its own epitaph that overrides the templated one at death.
  - `[x]` Follow-up 2026-05-25 on `agents/wip`: runtime death dispatch loads `prepared-epitaph.txt` before building patron epitaph letters, so M4 final testaments reach patron inboxes verbatim. Verified with red/green runtime coverage, focused memory/epitaph/runtime suites, `npm run fin` (1878/1878), `npm run build`, and live `res:agent` smoke.
- `[x]` **M5: `trade_resource` action.** Hero proactively offers a resource to a patron who's neglected them.
  - Completed 2026-05-26 on `agents/wip` (SHA 197e8e42): `canTradeResource` gate checks hero tier, inventory quantity, and target visibility; `hero-actions.ts` exposes the predicate; `resident-runtime.ts` + `spark.ts` wired the trade_resource action; focused tests. Antigravity M5 HANDOFF 02:10.
- `[x]` **M6: Hero-as-resource-gatherer at faction landmarks.** Heroes skill-train at rs6 zones their faction controls; output → faction stockpile.
  - Partial shipped 2026-05-25 on `agents/wip`: flagship faction heroes now get deterministic visible landmark work through both hybrid Brain/Body and standard Spark idle/watchdog paths. Foundry gathers fuel/searches for materials; Bureau witnesses bones; Ledger audits public space; Veil scouts/picks up useful items. Live `local-81692` trajectory proof showed all four flagships producing faction-specific actions (`faction_foundry_fuel_work`, `faction_bureau_witness_work`, `faction_ledger_audit_work`, `faction_veil_shadow_work`), with focused tests, `npm run fin` (1930/1930), build, post-restart smoke, and 90s controller smoke passing.
  - `[x]` Follow-up: persist resource output into a faction stockpile ledger and surface it in faction story/project loops. Shipped 2026-05-25 on `agents/wip`: persistent `FactionStockpileLedger` records successful faction action attempts, exposing cumulative totals and contribution history via MCP server (`faction-stockpile://current` resource) and `/v1/wall/snapshot` (exposes `factionStockpiles` key). Fully verified in Jest and full build pipeline.
- `[x]` **M7: Operator revive tooling for manual residents.** Add an explicit CLI/helper that can revive `attention_exhausted` manual heroes for local/event verification without changing long-term SOUL respawn policy.
  - Started 2026-05-24 on `agents/wip`: Codex is implementing HD-030 as an admin revive command instead of temporarily flipping hero SOULs to `on_restart`.
  - Verified 2026-05-24 on `agents/wip`: `npm run controller:revive -- --resident <name>` revives manual attention-exhausted residents, refuses non-manual/non-attention deaths unless `--force`, records Library revival evidence, clears stale move/stuck state, and active controllers now adopt operator-revived runtime state instead of overwriting it. Focused tests, full gates, dashboard HTTP/browser smoke, and live `local-36085` revival of Hans, Father Aereck, Wise Old Man, Duke Horacio, Pip, and Thrand passed.
- `[x]` **M8: Hero-aware default fallback behavior.** Default-SPARK heroes should not all say the same watchdog line or wander away from authored anchors.
  - Started 2026-05-24 on `agents/wip`: Codex is polishing E18/F18d by making default hero watchdog fallback speech include the public hero name and moving fallback patrols around `heroProfile.anchor` when present.
  - Verified 2026-05-24 on `agents/wip`: default-SPARK watchdog fallback now names `heroProfile.publicName` or `display`; anchored heroes patrol one tile around `heroProfile.anchor` with `range: 1`, while named non-anchored residents keep first-step candidate movement. Focused red/green tests, typecheck, lint, build, full Jest, code-review subagent, and live `local-93740` passed for Hans, Father Aereck, Wise Old Man, Duke Horacio, and Pip. Residual: F6 tracks quiet no-hook residents such as Thrand.

## Workstream N: Physical Event And Embassy

**Purpose:** IRL June 1 surfaces and their in-game counterparts. Most owned by Dev (dashboard) or shared with v2 (staff scanner, print queue), but rs6 needs its own placement decisions. Spec: `docs/superpowers/specs/2026-05-22-embassy-and-event-design.md`.

- `[x]` **N1: Pick the rs6 embassy POI in-game.** Location for handler interaction, ritual redemption, standing display.
  - Completed 2026-05-25 on `agents/wip`: canonical POI is the Lumbridge churchyard region `3238..3248, 3204..3214, level 0` with center `(3243,3209,0)`. Verified in `src/controller/embassy/embassy.ts`, `src/controller/embassy/embassy.test.ts`, D3 reception greeting docs, and live wall/dashboard smoke.
- `[~]` **N2: Wall-map projection coordination.** Decide whether rs6 events feed v2's wall ticker or rs6 gets its own wall view. Coordinate with Dev.
  - Started 2026-05-25 on `agents/wip`: Codex is codifying the rs6-local patron proof path with an admin smoke that verifies grant → offer → private inbox → redacted public wall snapshot.
  - Partial 2026-05-25 on `agents/wip`: rs6-local proof path is covered by `npm run patron:smoke`, including HTTP inbox and redacted wall snapshot checks. Remaining: explicit Dev decision on whether this replaces or feeds the v2 wall ticker.
- `[x]` **N3: In-game graveyard zone.** Tombstones examinable for name/faction/epitaph/cause/ticks-lived. Mirror on dashboard library page.
  - Completed 2026-05-25 on `agents/wip`: Tombstones dynamically spawned in Lumbridge graveyard (`objectId: 402`) and refreshed every 500 ticks. Tombstone examination/reading displays formatted biography message `<name>, <faction>. <epitaph>. Lived <N> ticks. Died of <cause>.` using coordinate lookup.
- `[ ]` **N4: IRL graveyard wall at the embassy.** Printed epitaphs at the physical embassy; refresh cadence + printing pipeline.
- `[x]` **N5: Mortician's Ribbon civic achievement.** Bestowed for humans witnessing N resident deaths (N TBD). In-game cape/title + lanyard variant.
  - Completed 2026-05-25 on `agents/wip`: `dispatchEpitaphs` now dispatches a `civic_milestone` Mortician's Ribbon letter alongside each epitaph letter. `produceMorticiansRibbonLetter` produces the letter with `lanyard-card` delivery channel. Per-death idempotency via LettersStore natural dedup (kind+dispatchedAt+subject+recipient). +4 new N5 tests; 1798/1798 + gates green. Commit `7b19be91`.
- `[x]` **N6: EVENT-D3 embassy reception greeting wire-in.** Registered patrons who chat while a hero resident is inside the Lumbridge churchyard embassy trigger a deterministic welcome and `PatronGateway.witnessAt(...)`.
  - Verified 2026-05-24 on `agents/wip`: `ResidentRuntime` runs `evaluateReceptionGreeting(...)` before the generic patron-thank reflex and before Brain inference, submits `say` with cause `embassy_reception_greeting`, records the witness only after the say action succeeds, and `ControllerHost` passes the live `PatronGateway` into each runtime. Focused red/green tests cover production wiring and the failed-say no-witness guard. Live use still requires `controller.yml#patrons[]` to contain the attendee handle and a built/restarted controller.
  - Hardened 2026-05-24 on `agents/wip`: D3 now ignores synthetic `source=patron:ask` chat events, preserving the CLI/MCP patron ask acknowledgement path after `controller.yml#patrons[]` is populated. Focused red/green tests cover the pure evaluator and runtime order-of-operations regression.

## Workstream O: Engineering And Tooling Polish

**Purpose:** Reusable infrastructure patterns from v2 and RuneBench that don't fit in other workstreams. Spec: *not needed* — items are independently scoped enough that no autonomous-dev spec is required.

- `[~]` **O1: Tick worker discipline.** Graceful SIGTERM, per-tick stats log line, `status='alive'` guard on decrement UPDATE.
  - Graceful SIGTERM: DONE (index.ts lines 35-36 handle SIGINT+SIGTERM since early sprint).
  - `status='alive'` guard: DONE (2026-05-25 O1-ALIVE-GUARD, `resident-runtime.ts`). Deceased residents no longer decay attention on subsequent ticks; prevents deeply-negative attention state and corrupted revival preconditions.
  - Per-tick stats log line: deferred (not a Chicago blocker).
- `[~]` **O2: Shard + attention ledger discipline.** Append-only ledgers with denormalised balance caches updated in same tx.
  - Partial 2026-05-25 on `agents/wip`: PatronStore now quarantines corrupt ledger files (rename to `.corrupt` + stderr warning) instead of silently returning empty ledgers — eliminates silent Shard/standing data loss if a file is truncated or invalid at restart. Also fixed `offerTo` and `sponsorBirth` `standingDelta.before` computation to snapshot BEFORE `recordSupport` (same fix applied to `witnessAt` in E31/HD-037). +21 tests (11 patron-store + 2 patron-gateway). Tests 1965/1965 + typecheck + lint + format green. Remaining: true append-only JSONL format (post-Chicago).
- `[x]` **O3: Static catalog in code audit.** Confirm rs6 factions/resources/achievements/rooms/emotions live in typed catalogs, not DB rows.
  - Verified 2026-05-24 on `agents/wip`: completed static catalog audit confirming compliance with Critical Design Invariant #6. Saved results in artifact `static_catalog_audit.md`.
- `[x]` **O4: Real-completion inference health check.** Health endpoint exercises a real LLM call, not just connect.
  - Verified 2026-05-24 on `agents/wip`: added real `/v1/health` inference probe on the controller HTTP surface. Checked and tested with focused tests. Passes typecheck, biome lint, and Jest.
- `[ ]` **O5: Layered Docker base image.** Pre-cache engine + deps to cut per-iteration build time.
- `[ ]` **O6: GitHub Pages auto-deploy from result JSON.** Static leaderboard / library snapshot rebuilt when results change.
- `[x]` **O7: `MODEL_CONFIG`-style precomputed UI metadata dictionary.** Single source for module IDs, faction colors, emotion presets.
  - Implemented 2026-05-25 on `agents/wip`: added `UI_METADATA` for factions, module manifests, and dashboard emotion presets; wall roster/stockpile faction colors now consume the catalog. Verified with focused tests plus full `npm run fin`.
- `[x]` **O8: env + CLI dual config audit.** Document conventions and apply across rs6 CLIs.
  - Implemented 2026-05-25 on `agents/wip`: audited and aligned all 7 main and helper CLI scripts for consistent environment variable defaults and precedence. CLI options always override env variable defaults. Added unit tests covering env variable overrides for all CLIs.
- `[x]` **O9: Watchdog fallback and LLM queue abort hygiene.** Prevent inference timeouts from freezing residents invisibly.
  - Verified 2026-05-24 on `agents/wip`: queued LLM aborts settle immediately, runtime consumes module watchdog fallbacks, hybrid Brain timeout backoff applies immediately, and default-SPARK heroes say a fallback line before attempting a safe step. Live `local-63709`: res:agent 9/9 action results succeeded; all six heroes produced `watchdog_fallback` speech, Hans moved twice successfully, and blocked hero steps were visible as movement timeouts instead of silent freezes. Remaining follow-up: O4 real-completion inference health check/provider failover.
  - Hardened 2026-05-24 on `agents/wip`: controller-created runtimes now derive `watchdog.thinkingMs` from the maximum configured LLM endpoint timeout plus a 5s grace window, so `controller.yml`'s 60s Qwen endpoint timeout is no longer shadowed by the old 45s runtime default. Focused host/runtime/config tests cover the wiring.
  - Hardened 2026-05-25 on `agents/wip`: live restart QA found Body/default-SPARK calls could still freeze visible play for the full 65s runtime watchdog while Qwen stalled. LLM requests now support per-call `timeoutMs`; hybrid Body and default SPARK use a 10s visible-cadence timeout, while Brain/small-talk now default to a 20s cap unless a SOUL overrides it. Focused red/green tests, full `npm run fin`, build, post-restart smoke, and live observe smoke passed.
  - `[x]` Hardened 2026-05-25 on `agents/wip`: live smoke showed per-request Brain timeout did not include LLM queue dwell, so queued residents still waited for the runtime watchdog. `LlmClient` now applies `timeoutMs` across queue plus HTTP time; focused red/green test, `npm run fin`, build, and live 45s cohort smoke passed.
- `[x]` **O10: Operator live resident smoke CLI.** Give Codex/Claude/Gemini and humans a quick command to verify real resident liveness from runtime state plus trajectory evidence.
  - Verified 2026-05-24 on `agents/wip`: added `npm run controller:smoke`, a tested admin summarizer for recent actions/results/speech/stuck issues. Defaults use configured residents from `controller.yml` so stale disposable benchmark folders do not pollute normal QA. Live smoke showed all 19 configured residents active, and `res:agent` passed `--fail-on-warn` with recent movement/speech/action evidence.
  - Hardened 2026-05-24 on `agents/wip`: live QA showed `qa-guardian` and `qa-survivor` repeatedly emitting `low_health_hold_position` while occasional speech/result rows made the smoke read OK. `controller:smoke` now warns on dominant no-action decision loops so "talking but inert" residents are visible to operators.
  - `[x]` HD-047 fixed 2026-05-26 on `agents/wip` (commit `0ad922e1`): `qa-guardian`/`qa-survivor` were emitting an identical "I am hurt at X,Y" say every 20 ticks while stranded at the Lumbridge recovery waypoint — ~32 repeats over 2879 ticks. Two fixes landed together: (a) `lowHealthHoldPositionAction` now detects at-waypoint stranded state and sets `cause = low_health_stranded` (distinct from generic `low_health_hold_position`), making the state observable in telemetry and smoke; (c) `CognitiveState.lastLowHealthSpeechTick` gates that speech to fire at most once per `interval × 10` ticks (~10 min at production cadence). Presence-beacon slot is consumed even on dedup-suppressed ticks to prevent re-checking on every interval. +1 updated test (cause rename) + 3 new red/green tests; `npm run fin` at 2088 tests green.
  - QA gap 2026-05-25 on `agents/wip`: a 30s all-resident smoke still warned on several low-cadence heroes and QA residents with no observed visible events, while `res:agent` passed the same 30s fail-on-warn window. Next slice should either tune per-resident visible cadence or add smoke profiles for "single hero", "all QA", and "whole city soak" instead of one strict 30s floor for every resident.
  - Hardened 2026-05-25 on `agents/wip`: `controller:smoke --allow-recent-visible` now supports cohort QA by accepting low-cadence residents that have recent visible evidence and continue ticking, while still warning on no tick progress and explicit action/say floors. Focused test, full live-smoke tests, and live 45s all-resident smoke passed.
  - `[x]` Hardened 2026-05-25 on `agents/wip`: live Pip proof showed trajectory evidence advancing while persisted runtime ticks stayed in a separate cumulative domain. Timed smoke now compares runtime and trajectory tick domains and reports the one that actually moved. Focused test, `npm run fin`, build, and live 45s cohort smoke passed.
  - `[x]` Hardened 2026-05-25 on `agents/wip`: default CLI cohort now matches `ControllerHost` desired residents by merging `controller.yml#residents` with discovered SOUL files. This keeps newly added faction flagships in operator smoke automatically while still excluding stale benchmark folders. Focused red/green test, full live-smoke tests, `npm run fin`, build, and live default smoke passed.
  - Live QA 2026-05-25 on `agents/wip`: 180s whole-city smoke found 22/23 residents visibly OK; Hans was the lone warning because M2's generic 50k-tick endurer default had marked him `deceased.cause=endured`. After the M2 fix, Hans 90s smoke passed (+144t, 6/6 success), whole-city 90s smoke passed for all 23 residents, and post-restart smoke reported all 23 alive with one known HD-011 patron-registry warning.
  - `[x]` Hardened 2026-05-25 on `agents/wip`: timed smoke now counts inert no-action decisions (`hook_noop`, `body_wait`, `budget_exhausted:*`) and warns when a resident is mostly ticking without enough visible events. This turns the overnight "alive but inert" QA finding into an acceptance check.
  - `[x]` Hardened 2026-05-25 on `agents/wip`: standard-SPARK heroes now use a 12s visible idle cadence instead of the old 30s wall-clock floor, preventing inference-paused hero residents from looking alive only in ticks while failing the inert-loop smoke window. Focused red/green SPARK evidence coverage, smoke detector coverage, lint, typecheck, diff check, post-restart smoke, and live 90s all-resident smoke passed; heroes produced 7-8 visible say/move cycles each.
  - QA finding 2026-05-26 on `agents/wip`: 5m whole-city smoke passed 23/23 and heroes spoke/moved frequently, but `qa-banker`, `qa-trader`, and `qa-survivor` still recovered from noisy cross-floor explore/talk targets near Lumbridge Castle. Next Body/stuck slice should reject cross-level free-exploration NPC/patrol targets unless routeable/same-level, and cool down repeated `target_not_found` NPC keys.
  - Hardened 2026-05-26 on `agents/wip`: live QA found `res:agent` could pass cohort smoke because older recent successes hid a bad observed window with only movement timeouts. Timed smoke now warns with `observed_actions_not_succeeding` whenever the live observation window has action attempts/results but no successful result.

## Workstream P: Deeper Game-Skill Knowledge

**Purpose:** Expand the agent's RuneScape knowledge so residents can act intelligently across all 23 RS skills, world geography, NPC inventory, items beyond starter, and basic quest awareness. Currently `docs/runescape-skill/` covers only ~5 starter skills. Spec: `docs/superpowers/specs/2026-05-22-deeper-game-skill-knowledge-design.md`. 6 plans (P-retrieval, P-skills-batch-1/2, P-world-geography, P-npcs-items, P-quests).

- `[x]` **P1: Retrieval improvements (perception+goal-filtered).** Token-budgeted retrieval to avoid prompt envelope bloat.
  - *Completed: Implemented perception + goal filter context scoring boosts (1.5x and 3.0x respectively) and enforced token budgets for retrieved knowledge entries.*
- `[x]` **P2: Skills batch 1 — promote `feat/skill-*.md` to consumed knowledge.** ~12 already-curated skill files get promoted into `docs/runescape-skill/skills/`.
  - *Completed: agility.md, combat.md, construction.md, cooking.md, crafting.md, farming.md, firemaking.md, fishing.md, fletching.md, herblore.md, mining.md, prayer.md, runecrafting.md, slayer.md, smithing.md, thieving.md, woodcutting.md. Remaining: none.*


- `[x]` **P3: Skills batch 2 — remaining skills.** Cover all 23 with per-skill mini-playbooks.
  - *Completed: Shipped magic.md and ranged.md, fully completing playbooks for all RuneScape skills.*
- `[x]` **P4: World geography.** Lumbridge, Varrock, Falador, Edgeville, Al Kharid; guilds; banks; wilderness boundary; travel routes.
  - *Completed: Added 7 regional geography playbooks under places/ and replaced places.md with an index.*
- `[x]` **P5: NPCs + items.** Combat NPCs, shopkeepers, key quest-givers; weapons/food/prayer items/tools by tier.
  - *Completed: Added regional playbooks under npcs/ and created the npcs.md index.*
- `[x]` **P6: Basic quest awareness.** Six starter quests (Cook's Assistant, Restless Ghost, etc.) so residents can opportunistically progress them.
  - *Completed: Added Cooks Assistant, Restless Ghost, and Romeo & Juliet walkthroughs under quests/.*

## Workstream Q: Smarter Behavior (F+G finish)

**Purpose:** Finish the behavior layer — non-command small talk, clarifying questions, deeper stuck recovery with help-request speech, combat survival personality, item trading, broader command vocabulary. Spec: `docs/superpowers/specs/2026-05-22-smarter-behavior-design.md`. 5 plans, one per sub-feature.

- `[x]` **Q1 (F2): Non-command small talk + clarifying questions.** Resident responds in character to public chat that's not a command; asks a clarifying question instead of guessing on ambiguous commands.
  - Verified 2026-05-22: focused direct-chat tests cover addressed small talk and unknown addressed commands without Body inference.
- `[x]` **Q2 (F3): Deeper stuck recovery with help-request speech.** When no useful local recovery exists, the resident says "I'm stuck near the eastern fence — can someone open the gate?"
  - Partial 2026-05-22: implemented generic coordinate-based help request after failed recovery movement; still needs richer blocker naming and live proof.
  - Verified 2026-05-22 on `codex/q-stuck-recovery`: local non-move actions now interrupt stale active movement, so a ready inventory/chat/trade action can proceed instead of being replaced by stuck recovery. Regression covers firemaking with logs+tinderbox while a stale far move is active; live controller recovered from a stale move, announced the firemaking next step, chopped logs, and lit a fire.
  - Verified 2026-05-22 on `codex/q-stuck-recovery`: ready firemaking actions now run before opportunistic loot pickup during active make-fire/woodcutting goals. Regression covers carried logs+tinderbox plus nearby coins; autonomous live `make-fire-5m` benchmark passed with standard SPARK and a successful `use_item_on_item`/`firemaking_fallback` action.
  - Verified 2026-05-22 on `codex/q-stuck-recovery`: temporary `routine_loop_break` recovery moves no longer replace active skill goals with `scout-nearby-area`. Regression covers stuck make-fire preserving `activeGoal`; live seeded `res:agent` kept `make-fire` after a `routine_loop_break`, and autonomous live `make-fire-5m` benchmark passed with standard SPARK.
  - Verified 2026-05-23: dynamic stuck recovery phrasebook system integrated with personality-specific voicing (achiever, mentor, endurer) and path-blocker (gate, fence, NPC) resolution. All tests pass.
  - Verified 2026-05-22 on `codex/q-stuck-recovery`: progress evidence state now records `lastMeaningfulProgressAt` and `stuckSince` on the resident runtime clock when persisted `state.tick` is ahead of gateway perception ticks. Regression covers the clock mismatch that made recent progress look ancient in Brain/Body prompts; autonomous real-gateway `make-fire-5m` benchmark passed with standard SPARK after the fix.
  - Hardened 2026-05-24 on `agents/wip`: live controller state showed the inverse clock skew (`stuckSince` ahead of persisted `state.tick`) after long no-decision perception stretches. `ResidentRuntime` now advances the persisted runtime clock on every handled perception before saving, so stuck/progress state cannot be written in the future. Focused red/green regression covers perception-only ticks.
  - Verified 2026-05-22 on `codex/q-stuck-recovery`: make-fire autonomous benchmark verifier now consumes selected-module final action-effect evidence from the runtime, so a completed tinderbox/logs action can end the task promptly instead of waiting for later perception proof and accumulating stale stuck ticks. Focused red/green tests cover verifier and runtime evidence plumbing; live autonomous `make-fire-5m` passed in 45s with `successfulActionEffects=1`, `finalStatus=success`, and `effectEvidenceCount=1` on the firemaking action.
  - QA gap 2026-05-24 on `agents/wip`: after a live controller restart, `res:agent` stayed online but entered a prolonged no-progress movement wait with `stuckSince` advancing and no fresh recovery action. Next slice should reproduce/fix stale active movement after restart.
  - Hardened 2026-05-24 on `agents/wip`: movement effect waits are capped at 30s and use a faster per-tile estimate so blocked moves recover within a dashboard-visible window instead of waiting up to 90s before stuck recovery. Focused runtime regression, full Jest, gates, and live controller smoke on `local-38976` passed: the agent timed out a blocked move, performed `stuck_move_recovery`, patrolled, picked up, lit a fire, spoke a beacon, recovered from a slow body decision, moved again, and chopped logs with Woodcutting XP/inventory evidence.
  - Audited 2026-05-24 on `agents/wip`: controller `local-98393` logged one `ECONTROL_REQUIRED` at startup with two immediate `session_closed` action results, then recovered without repeated control errors. A live liveness sample later showed `res:agent`, scout, trader, forager, priest, and woodcutter still advancing ticks and producing successful movement/firemaking/combat-seek actions, so no code patch was made for this artifact-only startup edge.
- `[x]` **Q3 (F5): Combat survival personality.** Eat when HP low, run when outmatched, narrate the decision.
  - Verified 2026-05-23: fully implemented and verified under full Jest coverage. Target selection prioritizes weakest visible aggressor using lowest hpFraction, lowest combatLevel, and closest Chebyshev distance. Combat decisions are classified (retaliate_confident, retaliate_after_eat, retreat_outmatched, retreat_low_hp), and character voicing matches the registered soul archetype. Action-effect survival (eating/retreating) takes precedence over speech, with robust safety and deduplication logic verified.
  - Verified 2026-05-22 by Codex live smoke: autonomous real-gateway `combat-prayer-10m` passed in 96s with `safeAttackActions=6`, `survivalActions=2`, `pickupBonesActions=2`, `buryActions=2`, `prayerXpIncreased=1`, `deathEvents=0`, and visible dashboard evidence for attack, retreat, loot, and bury actions.
  - Verified 2026-05-23 on `agents/wip`: non-combat low-HP recovery now eats carried food or prioritizes visible food pickup before routine beacons, and low-HP goal beacons mention the need for food or healing.
  - Verified 2026-05-23 on `agents/wip`: when hurt with no food and no visible food, the resident now returns toward its visibility anchor before roaming or skilling so humans can find it and it stops drifting deeper into danger.
  - Verified 2026-05-23 on `agents/wip`: emergency food recovery no longer treats raw fish as edible. When hurt, the resident cooks carried raw starter fish when heat is visible and can net visible starter fish when carrying a small net and no cooked food is available.
  - Verified 2026-05-23 on `agents/wip`: opportunistic pickup now suppresses non-food loot while hurt, so low-HP residents stop chasing coins/logs/bones unless the ground item is edible survival food.
  - Verified 2026-05-23 on `agents/wip`: low-HP/no-food residents now hold position near safety instead of continuing normal skilling loops, with an occasional visible "holding near safety" status line.
  - Verified 2026-05-23 on `agents/wip`: players and residents now receive passive Hitpoints regeneration every 100 game ticks, so low-HP hold can naturally recover into useful play instead of waiting forever when no food is visible.
  - Live audit 2026-05-24 on `agents/wip`: `qa-guardian` and `qa-survivor` were still holding low HP because the long-running game server process predated the compiled Hitpoints regeneration plugin. Restart game + controller before judging this behavior after code changes that add new server plugins.
- `[x]` **Q4 (G4): Trading/giving items.** Request trade, offer item, accept/decline by perceived value.
  - Verified 2026-05-22: completed and integrated in commits d8acbd78 / 1c52ef08 / 19e7809b / 8374a01b.
- `[x]` **Q5 (G5): Broader command vocabulary.** "make fire", "come here", "stop", "wait", "follow X", "stop following", polite rejection of unknown commands.
  - Partial 2026-05-22: direct `make fire` alias is covered; unknown addressed commands now get a polite supported-action hint.
  - Partial 2026-05-22: direct `follow me`, `follow X`, and `stop following` now update a persisted follow target; active follow movement runs without Body inference.
  - Started 2026-05-23 on `agents/wip`: extend `follow-and-chat-5m` so autonomous proof must cover follow, status, wait/stop pause, and resuming follow after a new direct command.
  - Verified 2026-05-23 on `agents/wip`: `follow-and-chat-5m` v0.2 now requires follow, status, wait-pause acknowledgement, peer movement, and resumed follow action. Live autonomous smoke passed with score 1 (`followActions=4`, `waitAcknowledgements=4`, `refollowActions=2`). Remaining gap: browser/manual human-client confirmation and unsafe-command edge fixtures.
  - Hardened 2026-05-25 on `agents/wip`: G5 unsafe-command fixtures and phrasebook voice regressions now pass in the full hybrid-thinking suite. `stop following` no longer gets swallowed by the generic `stop` parser, `come here`/`wait` replies preserve phrasebook voice, and combat/trade safety declines do not pull a resident away from survival or trade state. Full `npm run fin` passed (`2051/2051`), and live autonomous `follow-and-chat-5m` passed (`score=1`, `followActions=4`, `waitAcknowledgements=2`, `refollowActions=2`, `stuckProgressTicks=0`, artifact `/tmp/nullcity-g5-bench/bench_20260526040433_follow_and_chat_5m.json`).

## Workstream R: SPARK Module Extraction (finish B2-B5)

**Purpose:** Break the 2578-line `hybrid-agent-thinking-module.ts` monolith into four single-responsibility units plus a slim orchestrator. Foundation for all downstream behavior work — every other improvement is easier once this lands. Spec: `docs/superpowers/specs/2026-05-22-spark-module-extraction-design.md`. 5 plans (α/β/γ/δ/ε).

- `[x]` **R1: Extract `runescape-workflows.ts` (workflow cards).** Cleanest seam first.
  - Verified 2026-05-22: extracted, unit tested, and integrated previously.
- `[x]` **R2: Extract `runescape-body-routines.ts` (deterministic per-tick body decisions).**
  - Verified 2026-05-22: extracted, unit tested, and integrated previously.
- `[x]` **R3: Extract `runescape-nervous-rules.ts` (kernel-priority survival reflexes).**
  - Verified 2026-05-22: extracted, unit tested, and integrated previously.
- `[x]` **R4: Extract `runescape-brain-planner.ts` (high-level goal selection).**
  - Verified 2026-05-22: extracted, unit tested, and integrated previously.
- `[~]` **R5: Slim the orchestrator.** What remains in `hybrid-agent-thinking-module.ts` should be under 500 lines — pure wiring.

## Workstream RB-MCP: Controller MCP Routine Facade

- `[x]` **Plan RB-MCP-α — RoutineRunner skeleton (NO MCP yet)**
- `[x]` **Plan RB-MCP-β — MCP server boilerplate + token auth**
- `[x]` **Plan RB-MCP-γ — Wire run_routine tool to RoutineRunner**
- `[x]` **Plan RB-MCP-δ — Routine catalog expansion**
- `[x]` **Plan RB-MCP-ε — `run_workflow_card` + resources**
  - Verified 2026-05-23 on `agents/wip`: Exposed the `run_workflow_card` tool and registered three core resources (`workflow_cards`, `observe_resident_progress`, and `observe_resident_trajectory`) in `ControllerMcpServer`. All unit and integration tests passed cleanly (1318/1318).
  - Hardened 2026-05-23 on `agents/wip`: workflow-card resource entries now expose explicit MCP runnable metadata, resident progress/trajectory resource URIs encode names like `res:agent`, and `follow-codex` carries default `follow_player` params. Validation passed with focused MCP tests (`25/25`), typecheck, lint, format, build, diffcheck, full Jest (`1321/1321`), and a disposable HTTP MCP proof that read workflow/progress/trajectory resources and completed `run_workflow_card follow-codex`.

## Recently Completed

- `[x]` Workstream C1-C3, C5, and D1 created the first benchmark/schema/CLI and dashboard module-visibility loop.
- `[x]` SPARK facet runtime foundation made the standard module own Brain/Thinking plus Nervous compatibility facets while preserving kernel safety priority.
- `[x]` Dashboard benchmark pages D3/D4 added artifact list/detail views and a module leaderboard for comparing SPARK module runs.

## Immediate Recommended Next Slice

- `[x]` Build the consumption safety and proof loop next.
  - Started 2026-05-24 on `agents/wip`: add timed `controller:smoke` observation so live QA can prove residents produce new actions/speech/progress over a real window.
  - Verified 2026-05-24 on `agents/wip`: `controller:smoke --observe-seconds` now compares before/after trajectory entries by stable entry keys, handles trajectory rotation and controller tick resets, fails timed warnings by default, and reports observed action/result/speech deltas. Live `res:agent` 60s proof passed with +100 ticks, 3 new actions, 5 results, 4 successes, 1 timeout, and fresh scouting speech.
  - Safe facade foundation A2-A7 is now implemented as reviewed in-repo building blocks. Member-safe module authoring still needs the next public module contract slice to consume only those facades instead of `TrustedSparkModuleContext`.
  - Benchmark proof is now visible in the dashboard; the next proof-loop slice should make new autonomous benchmark runs easier to launch/compare from a single operator command or dashboard action.
  - Human-like next slice: finish F3 help-request behavior when no recovery move exists, then build a broader multi-loop routine that chains woodcutting, fishing, cooking, and status chat.
  - Verified 2026-05-23 on `agents/wip`: fresh autonomous `make-fire-5m` live benchmark passed against the running game (`runId=bench_20260523114243_make_fire_5m`, `score=1`, `selectedModuleActions=4`, `selectedModuleInferences=2`, `successfulActionEffects=1`, `firesObserved=1`). The dashboard benchmark detail page showed the run, pass status, leaderboard row, metrics, and `use_item_on_item` evidence after the artifact was copied into ignored `data/benchmarks/`.
  - Verified 2026-05-23 on `agents/wip`: RB-MCP routine context now passes validated params into runtime ticks, and `follow_player` uses `player` + `distance` to target the named visible player instead of silently chasing the nearest player. Focused routine/runtime/MCP tests, typecheck, lint, format, build, full Jest, diff check, and fresh live `follow-and-chat-5m` proof passed (`runId=bench_20260523151912_follow_and_chat_5m`, `score=1`); copied artifact to ignored `data/benchmarks/` for dashboard inspection.
  - Verified 2026-05-23 on `agents/wip`: hardened RB-MCP routine-param behavior for `chop_tree`, `safe_combat`, and stable `follow_player` so target movement/attacks report progress instead of premature completion, named combat targets are honored, low-HP safe combat preempts, and follow only completes after five in-range ticks. Validation passed with typecheck, lint, format, build, diffcheck, full Jest (`1290/1290`), live autonomous `combat-prayer-10m` (`runId=bench_20260523155157_combat_prayer_10m`, `score=1`, `actionsAttempted=18`, `attackActions=6`, `pickupBonesActions=2`, `buryActions=2`, `prayerSuccess=1`, `deathEvents=0`), and dashboard API/browser artifact smoke.
  - Verified 2026-05-23 on `agents/wip`: operator-facing RB-MCP `run_routine` now has a controller HTTP launch surface (`--mcp-http-port`, `CONTROLLER_MCP_HTTP_PORT`, default path `/controller/mcp`) and SDK-client smoke coverage. Validation passed with focused config/MCP tests (`22/22`), typecheck, lint, format, build, diffcheck, full Jest (`1310/1310`), reviewer rework for startup-error cleanup/response guards, and live disposable-controller proof: MCP client called `run_routine make_fire` on `res:bmk_mcp_mpik3dpe` over HTTP, routine returned `status=completed`, `ticksUsed=1`, `trajectoryHints=["tinderbox_used"]`, and the MCP call log recorded operator `codex-live-proof` with a `sha256:` params hash.
  - Verified 2026-05-23 on `agents/wip`: RB-MCP `run_workflow_card` and observer resources are now operator-readable over the HTTP MCP surface. Disposable SDK proof read `workflow-cards://current`, `resident-progress://res%3Aagent`, `resident-trajectory://res%3Aagent`, then ran `follow-codex` through `run_workflow_card`; the routine dispatched `follow_player` with `{player:"Codex",distance:3}` and returned `status=completed`.

## Agent Update Protocol

When an agent works on this roadmap:

1. Change one task from `[ ]` or `[~]` to `[>]` before editing code.
2. Add a short note below the task with date, branch/session, and intended verification.
3. When done, change it to `[x]` only after tests/build or a live experiment passes.
4. If blocked, change it to `[!]` and write the exact blocker plus the next decision needed.
5. Keep task edits narrow; do not rewrite unrelated roadmap sections.

## Verification Commands

Use these before marking roadmap implementation tasks done:

```bash
npm run typecheck
npm run lint
npm run build
npm test -- --runInBand
```

For dashboard/browser work, also run a local browser smoke test against the relevant dashboard route and capture the observed result in the task note.

## Agent Behavior PR Checklist

- [ ] Roadmap task status changed before and after implementation.
- [ ] Task note includes focused tests, full verification, and live/benchmark evidence when relevant.
- [ ] Module id/version appears in action or inference evidence for module-driven behavior.
- [ ] Scripted benchmark smokes are not presented as autonomous module proof.
- [ ] Human-facing docs are updated when workflow, deployment, or authoring behavior changes.
