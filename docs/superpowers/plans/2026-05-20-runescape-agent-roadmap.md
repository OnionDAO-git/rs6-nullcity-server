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

- `[ ]` **B2: Extract starter workflow cards.**
  - Files: `src/controller/spark/runescape-workflows.ts`, `src/controller/spark/runescape-workflows.test.ts`, `src/controller/thinking/hybrid-agent-thinking-module.ts`
  - Deliverable: woodcutting, firemaking, fishing, prayer, safe combat, follow/chat, and exploration workflow definitions live outside the hybrid module.
  - Verification: existing hybrid tests still pass; new workflow tests verify prerequisites and next actions.

- `[ ]` **B3: Extract deterministic Body routines.**
  - Files: `src/controller/spark/runescape-body-routines.ts`, `src/controller/spark/runescape-body-routines.test.ts`
  - Deliverable: "make fire", "walk to interaction range", "use tool on target", "eat food", and "recover from stuck" routines are separate from inference prompts.
  - Verification: tests simulate perception and assert typed `AgentAction` sequences.
  - Partial 2026-05-23 on `nullcity`: starter fishing Body routine now approaches distant visible Fishing spots to interaction range before netting, and interaction range checks treat diagonal adjacency as valid. Remaining extraction work still includes generalizing the typed routine library beyond fishing/firemaking.
  - Partial 2026-05-23 on `nullcity`: object and item-on-object action pipes now run matching hooks immediately when the resident is already in object interaction range instead of enqueueing a redundant walk task. Regression tests cover adjacent diagonal object/item-on-object targets and far targets that should still enqueue `WalkToObjectPluginTask`.

- `[ ]` **B4: Extract Brain goal planner.**
  - Files: `src/controller/spark/runescape-brain-planner.ts`, `src/controller/spark/runescape-brain-planner.test.ts`
  - Deliverable: high-level goals are selected from skill progress, inventory, nearby affordances, SOUL preferences, and benchmark task hints.
  - Verification: tests cover goal choice for firemaking, fishing, combat survival, follow/chat, and exploration.

- `[ ]` **B5: Extract Nervous survival rules into a module facet.**
  - Files: `src/controller/spark/runescape-nervous-rules.ts`, `src/controller/spark/runescape-nervous-rules.test.ts`, `src/controller/nervous-system/*`
  - Deliverable: survival behavior remains kernel-priority but can be supplied by first-party modules.
  - Verification: low HP, enemy attack, blocked/stuck, and dangerous area tests.

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

- `[>]` **D2: Add current goal and last thought/action panel.**
  - Files: dashboard resident observe route/components
  - Deliverable: humans can see active goal, recent action, evidence, final status, and failure reason.
  - Verification: Playwright/browser inspection with `res:agent`.
  - Partial 2026-05-21 on `nullcity`: resident detail Spark Activity now surfaces Thinking/Nervous/Body state, current goal, recent inference/action/feed, and explicitly distinguishes gateway-online residents that are still waiting for controller runtime state. Dashboard spawn now writes controller-discoverable SOUL files for autonomous residents, and the controller discovers valid SOUL files from `souls.dir` during reconcile.

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

## Workstream F: Human-Like Behavior Layer

**Purpose:** Make the resident feel like a human-ish player instead of a static script.

- `[x]` **F1: Goal sharing cadence.**
  - Files: `src/controller/thinking/hybrid-agent-thinking-module.ts`, extracted Brain planner when available
  - Deliverable: agent periodically says what he is trying to do, why, and what he needs from nearby humans.
  - Verification: chat tests cover "I am going to chop logs", "I need a tinderbox/logs", and "I am stuck near a fence".
  - Partial 2026-05-21: `presence_beacon` already periodically reports location, active goal, and a concrete next step before Body inference; focused tests cover active-goal beacons, visible item opportunities, and starter fishing next-step speech. Direct workflow responses already explain missing tools such as axes, logs, tinderboxes, nets, and low-health blockers. Stuck movement now reports recognized visible fence blockers once before recovery. Remaining gap: benchmark/manual proof that nearby humans see the cadence during normal play.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: benchmark-seeded goals now begin the presence-beacon cadence after the first share interval even when Brain never had to announce the goal. Focused test covers this regression, and live autonomous `fishing-cooking-10m` passed while recording public status lines with location, goal, and next step in trajectory evidence (`/tmp/oniondao-fishing-cooking-beacon-bench-current/bench_20260521165903_fishing_cooking_10m.json`, score 1, `trajectorySays=6`).

- `[~]` **F2: Nearby human reaction.**
  - Files: standard module Body/Brain code and tests
  - Deliverable: agent hears public chat, responds to direct commands, asks clarifying questions, and follows simple requests.
  - Verification: perception/chat tests for command prefix, direct name mention, and non-command small talk.
  - Partial 2026-05-21: agent ignores its own resident chat but responds to another resident/player peer; resident speech now broadcasts to nearby resident perception events.
  - Partial 2026-05-22: direct-chat fallback now distinguishes small talk from unknown addressed commands, gives a useful capability hint instead of a vague acknowledgement, and tests both paths without Body inference.

- `[x]` **F3: Stuck recovery.**
  - Files: Body routine extraction files
  - Deliverable: after repeated failed movement or unreachable target attempts, agent tries alternate target, steps back, returns to anchor, or asks for help.
  - Verification: tests simulate blocked tree/fence and assert recovery, not tiny-step loops.
  - Partial 2026-05-21: committed movement tracks stationary ticks, opens nearby doors/gates first, reports visible fence blockers once, then switches to a patrol recovery move. Remaining gap: broader alternate-path tests, help-request speech when no useful recovery exists, and live benchmark/manual proof.
  - Partial 2026-05-22: if the patrol recovery move itself makes no visible progress, the agent now says where it is stuck and asks nearby humans to lead it or open a route instead of silently looping recovery. Focused hybrid thinking test passed. Remaining gap: live/manual proof and broader alternate-path fixtures.
  - Verified 2026-05-23: dynamic stuck recovery phrasebook system integrated, fully typechecked, and verified via extensive unit and monolith tests passing flawlessly.

- `[x]` **F4: Exploration loop.**
  - Files: Brain planner, Body routines, knowledge docs
  - Deliverable: agent walks to visible landmarks, reports what he sees, records useful places, and returns to anchor periodically.
  - Verification: local live test or simulation where dashboard shows meaningful movement and chat.
  - Verified 2026-05-21 on `claude/evidence-loop-p1`: `explore-report-5m` now seeds a local scouting goal instead of relying on Brain drift. Focused thinking test covers initial exploration movement without deep inference, and live autonomous benchmark passed (`status=passed`, `score=1`, `selectedModuleActions=3`, `positionChanged=1`, `informativeReports=1`, `trajectorySays=2`, artifact `/tmp/oniondao-explore-report-seeded-bench/bench_20260521172341_explore_report_5m.json`).

- `[x]` **F5: Combat survival personality.**
  - Files: nervous rules, combat workflow, standard module
  - Deliverable: agent eats when hurt, attacks weak aggressors when reasonable, runs when outmatched, and explains danger.
  - Verification: combat fixture tests and one live local smoke if available.
  - Verified 2026-05-23: fully implemented with exposed combatLevel, weakest aggressor selection (lowest HP, lowest combat level, closest Chebyshev distance), decision classification (retaliate_confident, retaliate_after_eat, retreat_outmatched, retreat_low_hp), episode deduplication, and kill celebration. Tested F5-T1 through F5-T9 targeting all registers (achiever, mentor, endurer, default) successfully.


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

- `[x]` **G3: Prayer starter loop.**
  - Deliverable: bury bones from inventory or safe defeated enemies.
  - Success metric: prayer XP/level evidence or action success event.
  - Verified 2026-05-21 on `nullcity`: `combat-prayer-10m` live autonomous smoke proved safe goblin combat, bones pickup, burial, Prayer XP, and survival under `onion.runescape.standard`.

- `[ ]` **G4: Trading/giving items.**
  - Deliverable: request trade, offer simple item, accept/decline safely, describe trade state.
  - Success metric: test covers trade request, offer, accept, and decline.

- `[~]` **G5: Follow and command loop.**
  - Deliverable: agent follows configured player, responds to "agent come here", "agent make fire", "agent stop", "agent status".
  - Success metric: local browser test with human client can see movement or chat within 10 seconds.
  - Partial 2026-05-21: `follow-and-chat-5m` proves the standard module reacts to a benchmark peer's exact per-run "agent follow me" prompt, moves, then answers that peer's "agent status" prompt in autonomous mode. Still needs browser/manual human-client confirmation and broader command-loop benchmark coverage.

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

## Workstream J: Patron / Human-Attention Loop

**Purpose:** Give Runescape players a concrete reason to care about residents — attention as a clock, refill verbs, standing tiers, letters, credit surfaces. Adapted from v2 Shards mechanics with RS-flavored in-world surfaces. Detailed item provenance in `docs/null-city-ideation-backlog.md` Theme 4. Spec: `docs/superpowers/specs/2026-05-22-patron-loop-design.md`.

- `[ ]` **J1: Currency + attention decay clock.** Resident attention decays per tick; refill via in-game patron offering. Currency name + decay rate pinned in rs6.
- `[ ]` **J2: Mercy infusion (refill) verb.** In-game NPC interaction (e.g., "pray for", "offer to") at resident chathead → +N attention for M units of currency.
- `[ ]` **J3: Standing tier system.** Four-tier rs6 reputation thresholds (canonical 10/30/75 from v2, rs6 names TBD via maintainer decision).
- `[ ]` **J4: Letters system.** Four canonical kinds (`standing | epitaph | civic | broadcast`). In-game scroll/postbag delivery + web inbox parity. Denormalised sender snapshot preserved post-death.
- `[ ]` **J5: Credit surfaces near landmarks.** "Funded by / founded by / witnessed by" plaques readable in-game; mirrored on dashboard.
- `[ ]` **J6: Visitor-born resident ritual.** Three-part cost (rs6-flavored kindling/inscription/vow) totaling ~24 currency + 24h cooldown per Handler.
- `[ ]` **J7: Daily check-in + referral drips.** +1/day, +2/referral via staff scan.
- `[ ]` **J8: Patron event ingestion.** Wire patron offering / mercy infusion / birth sponsorship / parcel ratification events into the Evidence Layer's `patron` line shape (consumer side is Workstream I's library).

## Workstream K: Factions Adapted For Runescape

**Purpose:** rs6 needs its own four factions; v2's Solder Saints / Hatchery / Locksmiths / Ledgerwrights are Onion-DAO-flavored and don't translate to RuneScape lore. The four-faction shape + two tension axes + flagship NPCs + home rooms patterns transfer. Spec: `docs/superpowers/specs/2026-05-22-rs6-factions-design.md`. **This workstream requires maintainer creative input before any K-task can ship.**

- `[~]` **K1: Name the four rs6 factions.** Defaulted from Notion + drafted in spec: **The Foundry / The Bureau of Continuity / The Ledger / The Veil**. Mottos, colors, archetypes drafted. Maintainer to confirm or edit; an autonomous agent should USE the drafts to unblock work.
- `[~]` **K2: Define the two rs6 tension axes.** Drafted: **Making vs Remembering** (Foundry vs Bureau) + **Transparency vs Concealment** (Ledger vs Veil).
- `[~]` **K3: Seed four flagship NPCs.** Drafted (full soul fields) in spec: **Forgemaster Mother Anvil** (Foundry), **Archivist Severn** (Bureau), **First Witness Wren** (Ledger), **The Hush** (Veil). Maintainer to confirm voices; agent can ship them as-is via the seed script.
- `[~]` **K4: Place the five rs6 rooms in-game.** Drafted coordinates (verify against RuneJS world): Atrium → Lumbridge Castle courtyard `(3222,3218,0)`; Foundry → Falador anvil `(3015,3357,0)`; Bureau → Lumbridge churchyard `(3242,3208,0)`; Ledger → Varrock Square `(3210,3424,0)`; Veil → Edgeville shadow `(3093,3493,0)`.
- `[~]` **K5: Visual treatment for The Veil.** Drafted: redacted-black `#0A0A0A` with `#660000` accent (carries forward v2's Locksmith treatment).

## Workstream L: Cross-Resident Memory And Lore

**Purpose:** Residents that affect each other beyond independent action — interactions, projects, rumor. Largely unmined in v2. Spec: `docs/superpowers/specs/2026-05-22-cross-resident-lore-design.md` *(deferred until after J/K land — not load-bearing for June 1)*.

- `[ ]` **L1: `interact_resident` action verbs.** `whisper`, `gift`, `assist_skill`, `challenge_duel` with typed preconditions.
- `[ ]` **L2: Resident-owned projects.** Long-running funded artifacts (shop, citadel room, herb patch). Pick three project archetypes for rs6 MVP.
- `[ ]` **L3: `world_events` or broadcast channel.** Shared data surface; ambient utterances propagate to adjacent rooms.
- `[ ]` **L4: Resident-perceived in-game events.** Player level-ups, PKs, quest completions, faction territory shifts in the perception envelope.

## Workstream M: Hero Residents And Story Arcs

**Purpose:** Named residents who become event focal points for human players. Spec: `docs/superpowers/specs/2026-05-22-hero-residents-design.md`.

- `[ ]` **M1: Hero story-arc shape.** Pitch → fund → progress → resolve → letter. Resolution event template + faction effect.
- `[ ]` **M2: Lifespan tiers.** Flagships ~30 days, visitor-borns ~24 hours. Asymmetry is intentional.
- `[ ]` **M3: `request_attention` action.** Hero NPC dialog or in-world begging surface; can also dispatch a letter to a recent patron.
- `[ ]` **M4: `prepare_epitaph` action.** When `lifespanTicks < threshold`, hero spends a tick writing its own epitaph that overrides the templated one at death.
- `[ ]` **M5: `trade_resource` action.** Hero proactively offers a resource to a patron who's neglected them.
- `[ ]` **M6: Hero-as-resource-gatherer at faction landmarks.** Heroes skill-train at rs6 zones their faction controls; output → faction stockpile.

## Workstream N: Physical Event And Embassy

**Purpose:** IRL June 1 surfaces and their in-game counterparts. Most owned by Dev (dashboard) or shared with v2 (staff scanner, print queue), but rs6 needs its own placement decisions. Spec: `docs/superpowers/specs/2026-05-22-embassy-and-event-design.md`.

- `[ ]` **N1: Pick the rs6 embassy POI in-game.** Location for handler interaction, ritual redemption, standing display.
- `[ ]` **N2: Wall-map projection coordination.** Decide whether rs6 events feed v2's wall ticker or rs6 gets its own wall view. Coordinate with Dev.
- `[ ]` **N3: In-game graveyard zone.** Tombstones examinable for name/faction/epitaph/cause/ticks-lived. Mirror on dashboard library page.
- `[ ]` **N4: IRL graveyard wall at the embassy.** Printed epitaphs at the physical embassy; refresh cadence + printing pipeline.
- `[ ]` **N5: Mortician's Ribbon civic achievement.** Bestowed for humans witnessing N resident deaths (N TBD). In-game cape/title + lanyard variant.

## Workstream O: Engineering And Tooling Polish

**Purpose:** Reusable infrastructure patterns from v2 and RuneBench that don't fit in other workstreams. Spec: *not needed* — items are independently scoped enough that no autonomous-dev spec is required.

- `[ ]` **O1: Tick worker discipline.** Graceful SIGTERM, per-tick stats log line, `status='alive'` guard on decrement UPDATE.
- `[ ]` **O2: Shard + attention ledger discipline.** Append-only ledgers with denormalised balance caches updated in same tx.
- `[ ]` **O3: Static catalog in code audit.** Confirm rs6 factions/resources/achievements/rooms/emotions live in typed catalogs, not DB rows.
- `[ ]` **O4: Real-completion inference health check.** Health endpoint exercises a real LLM call, not just connect.
- `[ ]` **O5: Layered Docker base image.** Pre-cache engine + deps to cut per-iteration build time.
- `[ ]` **O6: GitHub Pages auto-deploy from result JSON.** Static leaderboard / library snapshot rebuilt when results change.
- `[ ]` **O7: `MODEL_CONFIG`-style precomputed UI metadata dictionary.** Single source for module IDs, faction colors, emotion presets.
- `[ ]` **O8: env + CLI dual config audit.** Document conventions and apply across rs6 CLIs.

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
  - Verified 2026-05-22 on `codex/q-stuck-recovery`: make-fire autonomous benchmark verifier now consumes selected-module final action-effect evidence from the runtime, so a completed tinderbox/logs action can end the task promptly instead of waiting for later perception proof and accumulating stale stuck ticks. Focused red/green tests cover verifier and runtime evidence plumbing; live autonomous `make-fire-5m` passed in 45s with `successfulActionEffects=1`, `finalStatus=success`, and `effectEvidenceCount=1` on the firemaking action.
- `[x]` **Q3 (F5): Combat survival personality.** Eat when HP low, run when outmatched, narrate the decision.
  - Verified 2026-05-23: fully implemented and verified under full Jest coverage. Target selection prioritizes weakest visible aggressor using lowest hpFraction, lowest combatLevel, and closest Chebyshev distance. Combat decisions are classified (retaliate_confident, retaliate_after_eat, retreat_outmatched, retreat_low_hp), and character voicing matches the registered soul archetype. Action-effect survival (eating/retreating) takes precedence over speech, with robust safety and deduplication logic verified.
  - Verified 2026-05-22 by Codex live smoke: autonomous real-gateway `combat-prayer-10m` passed in 96s with `safeAttackActions=6`, `survivalActions=2`, `pickupBonesActions=2`, `buryActions=2`, `prayerXpIncreased=1`, `deathEvents=0`, and visible dashboard evidence for attack, retreat, loot, and bury actions.
- `[x]` **Q4 (G4): Trading/giving items.** Request trade, offer item, accept/decline by perceived value.
  - Verified 2026-05-22: completed and integrated in commits d8acbd78 / 1c52ef08 / 19e7809b / 8374a01b.
- `[~]` **Q5 (G5): Broader command vocabulary.** "make fire", "come here", "stop", "wait", "follow X", "stop following", polite rejection of unknown commands.
  - Partial 2026-05-22: direct `make fire` alias is covered; unknown addressed commands now get a polite supported-action hint.
  - Partial 2026-05-22: direct `follow me`, `follow X`, and `stop following` now update a persisted follow target; active follow movement runs without Body inference.
  - Started 2026-05-23 on `agents/wip`: extend `follow-and-chat-5m` so autonomous proof must cover follow, status, wait/stop pause, and resuming follow after a new direct command.
  - Verified 2026-05-23 on `agents/wip`: `follow-and-chat-5m` v0.2 now requires follow, status, wait-pause acknowledgement, peer movement, and resumed follow action. Live autonomous smoke passed with score 1 (`followActions=4`, `waitAcknowledgements=4`, `refollowActions=2`). Remaining gap: browser/manual human-client confirmation and unsafe-command edge fixtures.

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

## Recently Completed

- `[x]` Workstream C1-C3, C5, and D1 created the first benchmark/schema/CLI and dashboard module-visibility loop.
- `[x]` SPARK facet runtime foundation made the standard module own Brain/Thinking plus Nervous compatibility facets while preserving kernel safety priority.
- `[x]` Dashboard benchmark pages D3/D4 added artifact list/detail views and a module leaderboard for comparing SPARK module runs.

## Immediate Recommended Next Slice

- `[ ]` Build the consumption safety and proof loop next.
  - Safe facade foundation A2-A7 is now implemented as reviewed in-repo building blocks. Member-safe module authoring still needs the next public module contract slice to consume only those facades instead of `TrustedSparkModuleContext`.
  - Benchmark proof is now visible in the dashboard; the next proof-loop slice should make new autonomous benchmark runs easier to launch/compare from a single operator command or dashboard action.
  - Human-like next slice: finish F3 help-request behavior when no recovery move exists, then build a broader multi-loop routine that chains woodcutting, fishing, cooking, and status chat.

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
