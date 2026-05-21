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
- `[~]` Benchmark harness foundation exists; scripted and autonomous make-fire/explore/follow-chat smokes exist, but dashboard benchmark pages are still pending.

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

- `[~]` **C4: Implement starter benchmark suite.**
  - Tasks: `woodcutting-firemaking-10m`, `starter-fishing-5m`, `combat-prayer-10m`, `explore-report-5m`, `follow-and-chat-5m`
  - Deliverable: every task has a verifier, scoring rubric, and fixture tests.
  - Verification: benchmark task tests pass locally and artifacts are written to the configured output dir.
  - Partial 2026-05-20 on `codex/body-waiter-coordinator`: added `explore-report-5m` verifier/CLI wiring and live smoke (`status=passed`, `score=1`, artifact `data/benchmarks/bench_20260521002220_explore_report_5m.json`). Remaining tasks: woodcutting-firemaking, starter-fishing, combat-prayer, follow-and-chat.
  - Partial 2026-05-21 on `codex/body-waiter-coordinator`: added `follow-and-chat-5m`, disposable benchmark peer support, exact per-run peer chat stimuli, and live autonomous smoke (`status=passed`, `score=1`, `selectedModuleActions=2`, `selectedModuleInferences=2`, `statusResponses=1`, `movedTowardSpeaker=1`, artifact `/tmp/oniondao-autonomous-follow-chat/bench_20260521044246_follow_and_chat_5m.json`). Remaining tasks: woodcutting-firemaking, starter-fishing, combat-prayer. Local gateway still reports delete-disabled cleanup as a metric.

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

- `[ ]` **D2: Add current goal and last thought/action panel.**
  - Files: dashboard resident observe route/components
  - Deliverable: humans can see active goal, recent action, evidence, final status, and failure reason.
  - Verification: Playwright/browser inspection with `res:agent`.

- `[ ]` **D3: Add benchmark run list and detail pages.**
  - Files: dashboard benchmark routes/components
  - Deliverable: list benchmark artifacts, filter by module/task, and inspect run timeline.
  - Verification: fixture artifacts render correctly.

- `[ ]` **D4: Add module leaderboard.**
  - Files: dashboard benchmark components
  - Deliverable: compare modules by pass rate, progress, efficiency, safety, reliability, and cost.
  - Verification: fixture data ranks modules deterministically.

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

## Workstream F: Human-Like Behavior Layer

**Purpose:** Make the resident feel like a human-ish player instead of a static script.

- `[~]` **F1: Goal sharing cadence.**
  - Files: `src/controller/thinking/hybrid-agent-thinking-module.ts`, extracted Brain planner when available
  - Deliverable: agent periodically says what he is trying to do, why, and what he needs from nearby humans.
  - Verification: chat tests cover "I am going to chop logs", "I need a tinderbox/logs", and "I am stuck near a fence".
  - Partial 2026-05-21: `presence_beacon` already periodically reports location, active goal, and a concrete next step before Body inference; focused tests cover active-goal beacons, visible item opportunities, and starter fishing next-step speech. Direct workflow responses already explain missing tools such as axes, logs, tinderboxes, nets, and low-health blockers. Stuck movement now reports recognized visible fence blockers once before recovery. Remaining gap: benchmark/manual proof that nearby humans see the cadence during normal play.

- `[~]` **F2: Nearby human reaction.**
  - Files: standard module Body/Brain code and tests
  - Deliverable: agent hears public chat, responds to direct commands, asks clarifying questions, and follows simple requests.
  - Verification: perception/chat tests for command prefix, direct name mention, and non-command small talk.
  - Partial 2026-05-21: agent ignores its own resident chat but responds to another resident/player peer; resident speech now broadcasts to nearby resident perception events. Still needs non-command small talk and clarifying-question tests.

- `[~]` **F3: Stuck recovery.**
  - Files: Body routine extraction files
  - Deliverable: after repeated failed movement or unreachable target attempts, agent tries alternate target, steps back, returns to anchor, or asks for help.
  - Verification: tests simulate blocked tree/fence and assert recovery, not tiny-step loops.
  - Partial 2026-05-21: committed movement tracks stationary ticks, opens nearby doors/gates first, reports visible fence blockers once, then switches to a patrol recovery move. Remaining gap: broader alternate-path tests, help-request speech when no useful recovery exists, and live benchmark/manual proof.

- `[ ]` **F4: Exploration loop.**
  - Files: Brain planner, Body routines, knowledge docs
  - Deliverable: agent walks to visible landmarks, reports what he sees, records useful places, and returns to anchor periodically.
  - Verification: local live test or simulation where dashboard shows meaningful movement and chat.

- `[ ]` **F5: Combat survival personality.**
  - Files: nervous rules, combat workflow, standard module
  - Deliverable: agent eats when hurt, attacks weak aggressors when reasonable, runs when outmatched, and explains danger.
  - Verification: combat fixture tests and one live local smoke if available.

## Workstream G: Real Gameplay Workflows

**Purpose:** Expand from "can make a fire" to basic RuneScape loops.

- `[ ]` **G1: Woodcutting plus firemaking loop.**
  - Deliverable: find level-appropriate tree, chop logs, make fire, repeat safely.
  - Success metric: produces at least one fire from self-chopped logs in benchmark or live test.

- `[ ]` **G2: Fishing plus cooking loop.**
  - Deliverable: find fishing spot, use small net, catch shrimp, cook on range/fire when available.
  - Success metric: inventory changes from raw shrimp to cooked shrimp or clear failure explanation.

- `[ ]` **G3: Prayer starter loop.**
  - Deliverable: bury bones from inventory or safe defeated enemies.
  - Success metric: prayer XP/level evidence or action success event.

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

## Recently Completed

- `[x]` Workstream C1-C3, C5, and D1 created the first benchmark/schema/CLI and dashboard module-visibility loop.
- `[x]` SPARK facet runtime foundation made the standard module own Brain/Thinking plus Nervous compatibility facets while preserving kernel safety priority.

## Immediate Recommended Next Slice

- `[ ]` Build the consumption safety and proof loop next.
  - Safe facade foundation A2-A7 is now implemented as reviewed in-repo building blocks. Member-safe module authoring still needs the next public module contract slice to consume only those facades instead of `TrustedSparkModuleContext`.
  - Starter gameplay benchmarks C4/G1-G3: add autonomous woodcutting-firemaking, starter-fishing, and combat-prayer tasks now that make-fire, explore-report, and follow-and-chat have live proof.
  - Benchmark cleanup C7: reduce `EDELETE_DISABLED` noise for disposable benchmark residents before the benchmark suite becomes a daily comparison tool.
  - Dashboard benchmark pages D3: humans need artifact list/detail views to inspect module experiments without spelunking JSON files.
  - Human-like next slice: F1 goal sharing cadence, then F3/F4/G1 stuck recovery and self-supplied woodcutting/firemaking.

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
