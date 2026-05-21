# RuneBench Systems Design For NullCity Residents

Status: revised draft after local analysis of RuneBench/rs-sdk and specialist review.
This is a design and task list only; it does not implement the work.

Historical note: this file is useful background, not the active task tracker. Some sections describe work that has since shipped or changed shape. Use `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` as the source of truth before executing anything here.

Review input incorporated:

- RuneBench/rs-sdk fidelity review: keep the BotSDK lifecycle, typed MCP facade, action porcelain, benchmarks, reward traces, and disposable benchmark isolation.
- NullCity runtime review: solve action ownership, effect-level waiting, and controller/dashboard boundaries before adding more Brain/Body prompt power.
- Dashboard/telemetry review: define evidence-backed progress, trajectory, benchmark, and suggested-intervention contracts.

References:

- RuneBench clone: `/Users/james/Code/OnionDAO/.codex-artifacts/reference/RuneBench`
- rs-sdk clone: `/Users/james/Code/OnionDAO/.codex-artifacts/reference/rs-sdk`
- Current server specs: `feat/residents.md`, `feat/controller.md`
- Current prompt slice: `feat/runebench-agent-design.md`, `src/controller/thinking/runebench-playbook.ts`
- Dashboard spec: `/Users/james/Code/OnionDAO/rs6-nullcity-residents-dashboard/SPEC.md`

## Summary

RuneBench succeeds because it gives coding agents five things our resident needs:

1. A reliable SDK lifecycle around state freshness, reconnects, and request correlation.
2. A high-level action layer that waits for gameplay effects, not just protocol acknowledgments.
3. A short probe loop: act once, observe, then extend into longer routines.
4. Local searchable game knowledge and typed tool documentation.
5. Telemetry, trajectories, and benchmark verifiers that say whether gameplay is improving.

We should not copy RuneBench's arbitrary `execute_code` tool as the primary resident brain. It is powerful, but too unconstrained for a live autonomous character in a persistent world with humans. Instead, we should translate RuneBench into a resident-native stack:

```text
Brain/Body inference
  -> Tool catalog and workflow cards
  -> Routine runner
  -> ResidentActions porcelain
  -> ActionCoordinator
  -> ResidentSDK + ResidentBody waiters
  -> Gateway AgentAction protocol
  -> Evidence-backed progress/trajectory/benchmark telemetry
  -> Dashboard
```

The important design shift is that "AI intelligence" sits on top of a dependable body. Brain chooses ambitions, Body chooses the next move, the nervous system can interrupt, and the action layer makes each move observable enough that a human can tell whether the agent is actually playing.

## Design Principles

- Preserve the existing NullCity boundary: controller intelligence submits public `AgentAction`; the engine remains authoritative.
- Treat server `availableActions` as raw affordances. Controller tools enrich them; they do not rediscover or bypass them.
- Make every effect claim evidence-backed: event-backed, perception-delta-backed, action-result-backed, or explicitly heuristic.
- Run one owned gameplay action at a time unless a future protocol supports safe parallelism.
- Keep Brain/Body prompt changes behind proven non-LLM routines and benchmarks.
- Isolate benchmarks from persistent human-visible resident identities.
- Keep arbitrary code execution out of the autonomous resident loop.

## 2026-05-20 Design Iteration: Request Correlation And Body Ownership

Specialist feedback split the next slice into three concerns:

- Simulation review: run a live three-resident experiment that covers movement, object interaction, and chat, then inspect action/perception logs rather than trusting the dashboard alone.
- Runtime review: build request-id correlation, body waiters, and a single-owner action coordinator before adding more Brain/Body prompt cleverness.
- Benchmark/progress review: keep effect evidence separate from submit acknowledgements, and treat `ok: true` as "the server accepted/applied a low-level action", not "the goal progressed".

Experiment results:

- Baseline before request correlation: one `work_loop` resident for 20s produced 9 submitted actions, 42 action results, and 33 unmatched results.
- First three-resident run after request correlation exposed noisy internal brain noops. Residents moved and chatted, but each resident also emitted 149 uncorrelated noop results during 90s.
- Second run confirmed the source: gateway-created residents use `IdleBrain`, which returned a noop whenever no survival action was needed.
- After changing `IdleBrain` and default `ScriptedBrain` to stay quiet unless they have a real action, the fresh 45s run produced clean correlation:
  - `res:bmk_idle_walk001`: 19 submitted movement actions, 19 correlated results, 38 unique observed positions, 13 arrival events.
  - `res:bmk_idle_work001`: 19 submitted object interactions, 19 correlated results, but no position or inventory progress.
  - `res:bmk_idle_chat001`: 19 submitted chat actions, 19 correlated results, 19 chat events.
  - Missing request-id results: 0.

Design adjustments from the experiment:

- Idle resident brains should be survival-only. "Doing nothing" must not emit `noop` action results.
- Request correlation is necessary and now works, but it is not the gameplay success signal.
- The worker resident shows the next gap clearly: object `interact` returns `ok: true` without proving useful effect. Phase 3 porcelain actions must wait for inventory, XP, event, position, or target-state evidence.
- Dashboard/debug surfaces should show both action acceptance and meaningful progress, otherwise a stuck agent still looks busy.

Follow-up behavior slice:

- Added initial `ResidentActions` helpers for `walkTo` and `say`. These submit exactly one action through `ActionCoordinator`, then wait for matching perception/event evidence before returning success.
- Routed runtime Body `move_to` and `say` actions through effect waiters. This makes the live resident behave more like a human player: after choosing to move or speak, it watches for arrival/chat evidence instead of immediately deciding again from the submit acknowledgement.
- This is intentionally narrow. Skill interactions still need workflow-specific effect checks, especially logs received, logs consumed, XP gained, target unavailable, and combat state changes.

## What To Add From RuneBench

### 1. ResidentBody Event And Perception Waiters

Current issue: `GatewayClient.submitAction()` resolves on the request acknowledgment, while later `action_result`, `event`, and `perception` messages arrive separately. A RuneBench-style action layer cannot be correct until it can wait for gameplay evidence.

Add or extend:

- `src/controller/body/body.ts`
- `src/controller/body/body-events.ts`
- `src/controller/body/body-waiter.ts`

Responsibilities:

- Expose `waitForPerception(predicate, timeoutMs)`.
- Expose `waitForEvent(predicate, timeoutMs)`.
- Record perception timestamps and state age.
- Keep a bounded recent event buffer with monotonic sequence numbers.
- Notify waiters synchronously when `observePerception()` or `observeEvent()` is called.
- Provide test hooks for synthetic perceptions/events.

This is the first layer to build because all higher-level actions depend on it.

### 2. ActionCoordinator

Current risk: NervousSystem, live Body inference, manual routines, benchmarks, and future MCP/dashboard controls can all submit actions. That can interleave intents and make the resident look broken.

Add:

- `src/controller/actions/action-coordinator.ts`
- `src/controller/actions/action-attempt.ts`
- `src/controller/actions/action-coordinator.test.ts`

Action producer priority:

1. `nervous-system`
2. `manual-admin`
3. `active-routine`
4. `body`

Responsibilities:

- Own the single in-flight action attempt.
- Correlate an `attemptId`, optional gateway `requestId`, producer, routine id, goal id, and cause.
- Capture before/after perception snapshots and recent events.
- Store acknowledgment result separately from gameplay evidence.
- Support cancellation and urgent interrupts.
- Expose `currentActivity`, busy status, cooldown/backoff, and last failure.
- Prevent lower-priority producers from submitting while a higher-priority action or routine owns the body.

Core model:

```ts
interface ActionAttempt {
  attemptId: string;
  resident: string;
  producer: 'nervous-system' | 'manual-admin' | 'active-routine' | 'body';
  action: AgentAction;
  submittedAt: string;
  submittedAtTick?: number;
  goalId?: string;
  routineRunId?: string;
  traceId?: string;
  beforePerception?: Perception;
  ackResult?: ActionResult;
  evidence: Evidence[];
  finalStatus:
    | 'accepted'
    | 'success'
    | 'failure'
    | 'blocked'
    | 'timeout'
    | 'cancelled_before_submit'
    | 'interrupted_after_submit';
  finalReason?: string;
}
```

Cancellation semantics:

- `cancelled_before_submit` means the coordinator cancelled the routine/waiter/future submission before an `AgentAction` was handed to the gateway.
- `interrupted_after_submit` means a higher-priority producer took over after the action was submitted. The coordinator stops waiting or starts recovery, but it does not claim the already-submitted server action was rolled back.
- Phase 1 should expose enough gateway request correlation to link a submitted `AgentAction` to later `action_result` frames. If the current `GatewayClient.submitAction()` hides the request id, add a controller-facing submission method that returns `{ requestId, ackResult }` or emits an equivalent `ActionAttempt` update.

### 3. ResidentSDK Lifecycle And State Surface

RuneBench/rs-sdk `BotSDK` is valuable because it owns lifecycle and state freshness, not merely action submission. Our equivalent should live in the controller and wrap `ResidentBody + ActionCoordinator`.

Add:

- `src/controller/sdk/resident-sdk.ts`
- `src/controller/sdk/resident-state.ts`
- `src/controller/sdk/resident-lifecycle.ts`
- `src/controller/sdk/index.ts`

Responsibilities:

- Read latest perception from `ResidentBody`.
- Expose state freshness: `getStateAgeMs()`, `waitForReady()`, `waitForFreshState(maxAgeMs)`.
- Expose subscription hooks: `onStateUpdate`, `onEvent`, `onAttemptUpdate`.
- Query inventory, skills, nearby NPCs, nearby objects, nearby ground items, dialogue, combat, trade, equipment, and position.
- Submit through `ActionCoordinator`, never directly to `ResidentBody`.
- Wait for action result, event kind, perception predicate, inventory delta, XP delta, position arrival, dialogue state, or combat state.
- Normalize failures as `{ ok: false, reason, message, evidence }`.
- Keep no direct game engine imports.

### 4. ResidentActions Porcelain

RuneBench `BotActions` is the strongest practical piece to steal. Its methods compose low-level actions and wait for effects.

Add:

- `src/controller/actions/resident-actions.ts`
- `src/controller/actions/action-result.ts`
- `src/controller/actions/targets.ts`
- `src/controller/actions/workflows.ts`

V1 generic primitives should align with the current `AgentAction` schema:

- `walkTo(position, range?)`
- `face(target)`
- `interact(target, option)`
- `useItemOnTarget(itemSlot, target)`
- `useItemOnItem(itemSlot, targetSlot)`
- `itemAction(slot, option)`
- `equip(slot)`
- `unequip(equipmentSlot)`
- `drop(slot)`
- `eat(slot)`
- `attack(target)`
- `say(text)`
- `whisper(to, text)`
- `dialogueContinue()`
- `dialogueChoice(optionIndex)`
- `tradeRequest(target)`
- `tradeOfferItem(inventorySlot, amount)`
- `tradeRemoveItem(offerSlot, amount)`
- `tradeAcceptStage1()`
- `tradeAcceptStage2()`
- `tradeDecline()`

V1 skill workflows layered on top:

- `openDoorOrGate(target?)`
- `talkTo(target)`
- `pickupItem(target)`
- `chopTree(target?)`
- `burnLogs(logsSlot?)`
- `buryBones(slot?)`
- `eatFood(target?)`
- `attackSafeNpc(target?)`
- `walkTowardReachableTarget(target, options?)`

Later, only after server features are proven:

- `openBank`, `depositItem`, `withdrawItem`
- `openShop`, `buyFromShop`, `sellToShop`
- `fish`, `mineRock`, `cookFood`, `fletchLogs`, `smithAtAnvil`
- Prayer toggles and spell/prayer selection helpers

Each porcelain method must:

- Require one action owner through `ActionCoordinator`.
- Set a timeout.
- Emit typed evidence and final status.
- Avoid unsafe combat when HP/food/safety checks fail.
- Return blocked reasons that Body and dashboard can reuse.

### 5. Tool Catalog And Workflow Cards

RuneBench gives agents API docs as MCP resources. Our resident inference needs the same idea, but compact, typed, and grounded in local perception.

Add:

- `src/controller/tools/tool-catalog.ts`
- `src/controller/tools/workflow-cards.ts`
- `src/controller/tools/tool-catalog.test.ts`

Boundary:

- Server `availableActions` is the raw affordance layer: nearby targets, visible options, action payload shapes.
- Controller `ToolCatalog` is the semantic layer: "can chop tree now", "can burn logs now", "blocked by dialogue", "need axe", "need reachable tree", "target likely behind obstacle".

Responsibilities:

- Convert current perception and `availableActions` into available semantic tools.
- Include required item/tool, target, risk, expected evidence, and failure/recovery hints.
- Generate compact prompt text for Brain/Body.
- Generate dashboard suggestions from the same cards.

Example workflow card shape:

```ts
interface WorkflowCard {
  id: string;
  label: string;
  goalKinds: string[];
  available: boolean;
  blockedReason?: string;
  requiredItems?: string[];
  target?: unknown;
  suggestedAction?: AgentAction;
  evidenceKinds: EvidenceKind[];
  recoveryHints: string[];
}
```

### 6. Local Knowledge From Config

RuneBench agents get markdown wiki pages. We should generate resident-readable knowledge from local config, action options, item definitions, and skill specs.

Add:

- `src/controller/knowledge/generate-knowledge.ts`
- `src/controller/knowledge/knowledge-index.ts`
- `src/controller/knowledge/retrieve-knowledge.ts`
- `data/controller/knowledge/` generated output

Initial generated docs:

- `skills/woodcutting.md`
- `skills/firemaking.md`
- `skills/combat.md`
- `skills/prayer.md`
- `items/tools.md`
- `items/food.md`
- `world/objects.md`
- `world/safe-npcs.md`
- `world/action-options.md`
- `world/failure-messages.md`

Each generated doc should include:

- Entity names and ids where stable.
- Visible option text such as `Chop down`, `Light`, `Bury`, `Attack`, `Talk-to`.
- Required tools/items.
- Expected success evidence.
- Known failure messages and recovery hints.
- Mapping to `AgentAction` kinds.

Brain retrieves a few relevant snippets based on active goal and perception. Body receives only compact workflow reminders, not a large wiki dump.

### 7. Evidence-Backed Progress Tracker

RuneBench's `skill_tracker.ts`, `check_skill_xp.ts`, and `check_xp_rate.ts` make progress visible. Our dashboard needs to answer "is this working?" without reading terminal logs.

Add:

- `src/controller/progress/progress-types.ts`
- `src/controller/progress/progress-tracker.ts`
- `src/controller/progress/progress-log.ts`
- `src/controller/progress/progress-metrics.ts`
- `src/controller/progress/progress-tracker.test.ts`

Live telemetry rule:

- Live progress comes from perception snapshots, public events, action results, and controller-derived deltas.
- Save-file or bank scraping is verifier-only, not live dashboard state.

Core types:

```ts
type EvidenceKind = 'perception' | 'event' | 'action_result' | 'derived' | 'heuristic';

interface Evidence {
  source: EvidenceKind;
  detail: unknown;
}

interface ProgressSample {
  t: string;
  tick?: number;
  resident: string;
  position?: unknown;
  inventorySummary?: Record<string, number>;
  equipmentSummary?: Record<string, number>;
  skills?: Record<string, { level?: number; xp?: number }>;
  hpFraction?: number;
  combat?: unknown;
  activeGoalId?: string;
  currentActivity?: string;
}

interface ProgressEvent {
  t: string;
  tick?: number;
  resident: string;
  kind: 'xp' | 'inventory' | 'position' | 'combat' | 'chat' | 'goal' | 'routine' | 'stuck';
  meaningful: boolean;
  confidence: number;
  goalId?: string;
  routineRunId?: string;
  actionAttemptId?: string;
  actionKind?: string;
  delta?: unknown;
  evidence: Evidence[];
}

interface ProgressSummary {
  lastSampleAt?: string;
  lastMeaningfulProgressAt?: string;
  lastSuccessfulEffectAt?: string;
  noProgressMs?: number;
  xpDeltaBySkill: Record<string, number>;
  inventoryDeltaByItem: Record<string, number>;
  counters: Record<string, number>;
  stuck?: {
    active: boolean;
    reason?: string;
    attemptsSinceProgress?: number;
    lastRecoveryAction?: string;
  };
  recentEvents: ProgressEvent[];
}
```

Derived metrics:

- XP delta by skill.
- Logs gained/lost.
- Fires lit count where evidence exists.
- Bones buried count.
- Safe kills count where observable.
- Action attempts per successful effect.
- No-action duration.
- Actions-failing duration.
- Actions-succeeding-but-no-goal-progress duration.
- Busy/waiting duration.

Store controller-owned JSONL under `data/controller/logs/<resident>/progress/<YYYY-MM-DD>.jsonl`.

### 8. Trajectory Viewer Data

RuneBench extracts trajectories so humans can understand a run. We need the same for live debugging and benchmark review.

Add:

- `src/controller/trajectory/trajectory-builder.ts`
- `src/controller/trajectory/trajectory-types.ts`

Core type:

```ts
interface TrajectoryItem {
  t: string;
  tick?: number;
  source: 'brain' | 'body' | 'nervous-system' | 'action' | 'progress' | 'chat' | 'benchmark';
  label: string;
  traceId?: string;
  goalId?: string;
  routineRunId?: string;
  actionAttemptId?: string;
  outcome?: 'success' | 'failure' | 'blocked' | 'waiting' | 'progress';
  detail?: unknown;
}
```

Inputs:

- inference logs
- action attempts
- public chat produced by resident
- progress events
- benchmark events
- runtime state changes

Output:

- A compact timeline with "interesting moment" labels such as `goal-changed`, `first-log`, `fire-lit`, `stuck-recovery`, `unsafe-combat-avoided`, `chat-command-followed`.

Correlation IDs:

- `traceId` groups one Brain/Body/routine turn.
- `goalId` links strategy to execution.
- `routineRunId` links actions to routines and benchmarks.
- `actionAttemptId` links a submitted action to evidence and progress.

### 9. Generated Local Benchmarks

RuneBench's generated tasks are product tests for agent competence. We should create local resident benchmarks that can run on our world without mutating the main `res:agent` identity.

Add:

- `src/controller/bench/benchmark-types.ts`
- `src/controller/bench/benchmark-definitions.ts`
- `src/controller/bench/generate-benchmarks.ts`
- `src/controller/bench/run-benchmark.ts`
- `src/controller/bench/verifiers/*.ts`
- `feat/agent-benchmarks.md`

Isolation requirement:

- Benchmarks create disposable residents with legal resident names such as `res:bmk_fire_a1b2` or `res:bmk_wc_a1b2`.
- The resident name must satisfy the existing `res:[a-z0-9_]{1,20}` contract.
- Benchmark identity is metadata, not a separate name namespace.
- Bench residents get seeded spawn position, inventory, and equipment.
- Bench residents do not share long-term resident memory/soul state.
- Bench runners force disconnect and delete the resident or restore a save snapshot after the run.
- Benchmarks never mutate the user's live `res:agent` unless a human explicitly opts in for manual testing.

Core types:

```ts
interface BenchmarkTask {
  id: string;
  title: string;
  maxDurationMs: number;
  residentSeed: {
    spawnPosition?: unknown;
    initialInventory?: unknown[];
    initialEquipment?: unknown[];
  };
  routine?: string;
  successCriteria: string[];
  safetyCriteria: string[];
}

interface BenchmarkRun {
  id: string;
  kind: 'benchmark';
  taskId: string;
  resident: string;
  residentDisplayName?: string;
  startedAt: string;
  endedAt?: string;
  status: 'running' | 'passed' | 'failed' | 'errored' | 'cancelled';
  verifier?: VerifierResult;
  artifacts: TraceArtifact[];
}

interface VerifierResult {
  passed: boolean;
  score: number;
  reward: RewardBreakdown;
  criteria: Array<{ id: string; passed: boolean; evidence: Evidence[] }>;
  failureReason?: string;
}

interface RewardBreakdown {
  samples: unknown[];
  finalState?: unknown;
  xpDeltaBySkill: Record<string, number>;
  peakXpPerHourBySkill?: Record<string, number>;
  attempts: number;
  successfulEffects: number;
  noProgressMs: number;
  deaths: number;
  taskSpecific: Record<string, number>;
}

interface TraceArtifact {
  kind: 'progress_jsonl' | 'trajectory_json' | 'reward_json' | 'log_excerpt';
  path: string;
}
```

First benchmark tasks:

1. `make-fire-5m`
   - Seed: tinderbox and axe.
   - Success: at least one successful firemaking effect.
   - Prefer evidence: logs consumed plus Firemaking XP delta.

2. `woodcutting-firemaking-10m`
   - Seed: tinderbox and axe near reachable trees.
   - Success: logs gathered and at least one firemaking effect.

3. `combat-prayer-10m`
   - Seed: basic food/equipment near safe NPCs.
   - Success: safe NPC attacked, bones picked up, bones buried, no death.

4. `explore-report-5m`
   - Success: resident visits at least three distinct nearby landmarks and says one useful report.

5. `follow-and-chat-5m`
   - Success: resident stays near a named player and responds to direct commands within latency threshold.

Verifier evidence classes:

- `event-backed`: direct event exists.
- `perception-delta-backed`: inferred from before/after snapshots.
- `action-result-backed`: protocol result supports the claim.
- `heuristic`: useful but lower confidence, must be labeled.

### 10. Dashboard And Debug API

The dashboard is where RuneBench's telemetry should become usable.

Controller owns progress and trajectory read models. The dashboard should read them through a controller or dashboard-server API, not by importing controller internals or parsing server action logs directly.

Add to `rs6-nullcity-residents-dashboard` shared types:

- `ProgressSummary`
- `ProgressEvent`
- `TrajectoryItem`
- `TrajectorySummary`
- `BenchmarkTask`
- `BenchmarkRun`
- `VerifierResult`
- `SuggestedIntervention`

Suggested intervention type:

```ts
interface SuggestedIntervention {
  id: string;
  label: string;
  reason: string;
  action: 'watch' | 'teleport_human' | 'teleport_agent' | 'cancel_routine' | 'run_routine' | 'send_chat' | 'give_item';
  requiresControl: boolean;
  risk: 'low' | 'medium' | 'high';
  sourceEvidence: Evidence[];
}
```

Add API endpoints:

- `GET /api/runtime/:resident/progress`
- `GET /api/runtime/:resident/trajectory`
- `GET /api/runtime/:resident/routine`
- `GET /api/runtime/:resident/interventions`
- `GET /api/benchmarks/runs`
- `GET /api/benchmarks/runs/:id`

Dashboard panels:

- Progress summary: last meaningful progress, XP/inventory deltas, no-progress reason.
- Current activity: action owner, routine, current porcelain action, elapsed time.
- Trajectory timeline.
- Benchmark run summary and reward breakdown.
- Stuck detector badge.
- Suggested intervention panel.

The observe page should distinguish:

- Agent offline.
- Agent online but idle.
- Agent trying actions that fail.
- Agent actions accepted but no goal progress.
- Agent busy/waiting.
- Agent making meaningful progress.

### 11. Typed MCP Facade Upgrade

RuneBench/rs-sdk uses MCP resources and tools as a discoverable control plane. We should keep that idea, but avoid arbitrary `execute_code` for live autonomy.

Keep server MCP low-level:

- `observe_resident`
- `submit_action`
- `wait_for_event`

Add typed resources/tools through controller/admin where possible:

- `resident_api` resource
- `workflow_cards` resource
- `observe_resident_progress` tool
- `observe_resident_trajectory` tool
- `run_workflow_card` tool
- `run_routine` tool for whitelisted routines

`run_routine` accepts `{ resident, routine, params, maxTicks }` for whitelisted routines like `make_fire`, `chop_tree`, `bury_bones`, `safe_combat`, and `follow_player`.

If the server MCP facade gets `run_routine`, it should be a thin remote call to the controller. Do not pull controller-owned ResidentActions into the server package.

Optional later:

- Local-only experimental `execute_code`, disabled by default, never used by the autonomous resident loop, and unavailable in shared worlds.

## Architecture

```text
ResidentRuntime
  |-- NervousSystem
  |-- ThinkingModule
  |    |-- Brain prompt
  |    |-- Body prompt
  |    |-- ToolCatalog + KnowledgeRetriever
  |-- ActionCoordinator
  |    |-- current activity
  |    |-- single in-flight ActionAttempt
  |    |-- cancellation / urgent interrupt
  |-- ResidentBody
  |    |-- latest perception
  |    |-- event buffer
  |    |-- waitForPerception / waitForEvent
  |-- ResidentSDK
  |    |-- lifecycle and state freshness
  |    |-- perception queries
  |    |-- effect waiters
  |-- ResidentActions
  |    |-- generic AgentAction porcelain
  |    |-- skill workflows
  |-- ProgressTracker
  |    |-- samples
  |    |-- progress events
  |    |-- stuck detector
  |-- TrajectoryBuilder
       |-- timeline for dashboard and benchmarks
```

## Data Flow

1. Gateway sends perception/event to `ResidentRuntime`.
2. `ResidentBody` stores latest perception/events and notifies waiters.
3. `ProgressTracker` samples deltas and records meaningful progress.
4. `NervousSystem` may request an urgent action through `ActionCoordinator`.
5. If no higher-priority action owns the body, Brain receives:
   - active goal
   - perception summary
   - progress summary
   - retrieved knowledge snippets
   - tool catalog summary
6. Body receives:
   - active goal
   - perception summary
   - workflow cards
   - recent failures/stuck state
7. Body emits one action request or routine selection.
8. `ActionCoordinator` accepts, rejects, queues, or cancels according to priority.
9. `ResidentActions` or Body submits exactly one public `AgentAction`.
10. `ResidentSDK`/waiters evaluate gameplay evidence over future perceptions/events.
11. `ProgressTracker` and `TrajectoryBuilder` record the result.
12. Dashboard reads progress, routine, trajectory, and benchmark API models.

## Brain, Body, Nervous System Integration

The integration should be staged.

V1:

- NervousSystem remains pre-coded and highest priority.
- Body can still emit one low-level action when no routine owns the body.
- Whitelisted routines use `ResidentActions`.
- Brain can choose a goal and ask for a routine only after the routine passes local benchmarks.

V2:

- Brain uses knowledge retrieval to set ambitions.
- Body uses workflow cards to choose the next practical action.
- Routines become "muscle memory" that Body can call by id.
- NervousSystem writes recovery hints back into progress state after repeated failures.

Do not make Brain/Body rely on the new tool catalog until:

- action waiters work,
- the coordinator prevents races,
- make-fire benchmark passes,
- dashboard can show progress and stuck reasons.

## Safety And Constraints

- No arbitrary code execution in autonomous resident v1.
- All high-level actions eventually submit public `AgentAction`.
- Every porcelain action has a timeout and evidence-based result.
- Routines submit one action at a time and can be cancelled.
- MCP `run_routine` is local/admin-only.
- Brain may choose goals, but cannot bypass NervousSystem safety rules.
- Human direct chat commands remain high priority.
- Benchmark residents are disposable unless explicitly requested otherwise.
- Live telemetry never reads save files directly.

## Task List

### Phase 1: Body Waiters And ActionCoordinator

- Done: add `ResidentBody.waitForPerception(predicate, timeoutMs)`.
- Done: add `ResidentBody.waitForEvent(predicate, timeoutMs)`.
- Done: add sequence numbers/timestamps for perception and event updates.
- Done: add `ActionAttempt` and `ActionCoordinator`.
- Done: route NervousSystem and ThinkingModule submissions through the coordinator.
- Done: add cancellation and priority tests.
- Done: add request-id correlation for later `action_result` frames, with gateway/client/session tests.
- Done: make idle resident brains quiet so live action streams are not polluted by internal noops.
- Remaining: persist/stream attempt lifecycle updates for dashboard and future SDK consumers.

Acceptance:

- A test can wait for a synthetic inventory delta.
- A test can time out with a structured failure reason.
- A lower-priority Body action cannot interleave with an active routine action.
- A nervous-system interrupt can cancel or preempt a routine action.
- Tests distinguish `cancelled_before_submit` from `interrupted_after_submit`.
- Tests distinguish gateway acknowledgement from later gameplay/effect evidence.
- No game engine internals are imported.

### Phase 2: ResidentSDK Lifecycle

- Create `resident-state.ts` with typed helpers for inventory, skills, actors, objects, ground items, equipment, dialogue, trade, and combat.
- Create `resident-lifecycle.ts` for ready/freshness/reconnect state.
- Create `resident-sdk.ts` around `ResidentBody + ActionCoordinator`.
- Add event subscription and `waitForFreshState(maxAgeMs)`.
- Add structured result types.

Acceptance:

- Tests can simulate stale/fresh perception states.
- Tests can submit a fake action and observe an `ActionAttempt` lifecycle.
- SDK exposes state helpers without engine imports.

### Phase 3: Initial ResidentActions Porcelain

- Started: implement generic primitives aligned to current `AgentAction` schema.
- Done: `walkTo()` waits for future position evidence.
- Done: `say()` waits for matching chat event evidence.
- Remaining: effect-aware `interact`, `pickupItem`, `useItemOnItem`, `itemAction`, `eat`, and `attack` helpers.
- Implement first workflows: `walkTo`, `pickupItem`, `useItemOnItem`, `chopTree`, `burnLogs`, `buryBones`, `eatFood`, `attackSafeNpc`.
- Each workflow returns `{ ok, reason, message, evidence }`.
- Each workflow labels evidence confidence.

Acceptance:

- `chopTree()` waits for logs, XP, or labeled tree-state evidence.
- `burnLogs()` waits for logs consumed and/or Firemaking XP.
- `pickupItem()` waits for inventory or ground-item delta.
- `attackSafeNpc()` refuses unsafe combat when HP is low and no food is visible.

### Phase 4: Progress And Trajectory

- Add progress types, JSONL log, metrics, and summaries.
- Add trajectory types and builder.
- Add correlation ids across Brain, Body, routine, action attempt, progress, chat, and benchmark events.
- Add stuck detector states.

Acceptance:

- A make-fire session produces a timeline with chop/use-item/progress markers.
- Dashboard/runtime can show "last meaningful progress".
- Stuck state distinguishes no action, action failure, no goal progress, and busy/waiting.

### Phase 5: Local Benchmarks

- Define benchmark task/run/verifier/reward/artifact types.
- Implement disposable resident creation/cleanup.
- Implement `make-fire-5m` first.
- Add `woodcutting-firemaking-10m`, `combat-prayer-10m`, `explore-report-5m`, and `follow-and-chat-5m` after make-fire passes.
- Add CLI for one benchmark run.

Acceptance:

- `make-fire-5m` can pass on the current server with a disposable resident.
- Benchmark output includes `reward.json`, trajectory JSON, and progress JSONL.
- Failed runs produce a human-readable failure reason and evidence.

### Phase 6: Tool Catalog And Workflow Cards

- Move `runebench-playbook.ts` toward structured workflow cards.
- Generate prompt text from structured cards instead of hard-coded strings.
- Include current availability: "can do now", "need item", "need target", "blocked by busy/dialogue/risk".
- Add dashboard suggested interventions from cards and progress state.

Acceptance:

- Body prompt says "you can chop this tree now" only when a visible actionable tree exists.
- Body prompt says "you need logs first" when tinderbox exists but logs do not.
- Dashboard suggestions cite evidence and do not invent unavailable actions.

### Phase 7: Knowledge Generation And Retrieval

- Generate markdown from local config, skill specs, visible option strings, and failure messages.
- Add a bounded retrieval function keyed by active goal and visible entities.
- Include retrieval snippets in Brain and Body prompts. Brain uses them to select realistic goals; Body uses them to pick valid immediate tool/action calls.
- Keep entries source-labeled and prefer engine-local facts over external wiki facts when they disagree.
- Treat the RuneBench wiki clone as an optional reference cache. Import only selected bounded snippets for NPC/shop/quest context; do not commit a bulk wiki scrape.

Acceptance:

- A woodcutting goal retrieves ordinary tree/axe/log guidance.
- A combat-prayer goal retrieves safe target, food, and bones guidance.
- Prompt size remains bounded.

Implemented starter slice:

- `src/controller/knowledge/knowledge-retriever.ts` defines source-labeled engine knowledge entries for firemaking, woodcutting, fishing, mining, prayer, safe starter combat, following/reporting, and tool shops.
- `buildBrainPrompt()` and `buildBodyPrompt()` retrieve compact relevant snippets from active goal + perception and inject them under "Relevant game knowledge".
- `src/controller/knowledge/wiki-importer.ts` can load bounded snippets from a local RuneBench wiki checkout for curated pages such as chickens, cows, goblins, and starter shops.
- `src/controller/knowledge/skill-guide-importer.ts` converts local skill guide JSON into bounded knowledge entries, giving us a path to generate more of the pack from engine data rather than hand-written facts.
- Focused tests cover retrieval ranking, prompt injection, and safe local wiki snippet loading.

Next iteration:

- Generate the starter entries from `data/config/**` and `src/plugins/skills/skill-guides/**` instead of maintaining all facts by hand.
- Attach knowledge snippets to workflow cards so availability can say "can do now", "missing tool", "missing visible target", or "unsafe".
- Add curated RuneBench wiki pages for low-level NPCs and starter shops as optional reference context, with source paths and tight character limits.

### Phase 8: Dashboard Integration

- Add progress/trajectory/benchmark shared types.
- Add API routes for progress, trajectory, routine, interventions, and benchmark runs.
- Add observe-page panels for activity, progress, trajectory, stuck reasons, and benchmarks.
- Keep raw JSON available but no longer primary.

Acceptance:

- The observe page answers whether the agent is doing anything without terminal logs.
- A stale/no-progress state is visible within two minutes.
- A benchmark run can be inspected from the dashboard.

### Phase 9: Routine Runner And MCP Upgrade

- Add controller-side whitelisted routine runner backed by `ResidentActions`.
- Add `run_routine` and `run_workflow_card` to controller/admin surfaces.
- Add typed MCP resources for resident API and workflow cards.
- Keep arbitrary `execute_code` deferred.

Acceptance:

- A human or benchmark can request `make_fire` and watch effect-level progress.
- The autonomous agent can choose a routine only after the lower layers are tested.
- Server MCP remains low-level or thinly delegates to controller routines.

## First Implementation Slice

Historical note: this slice proposal predates the current roadmap and several pieces have already landed or moved. Use `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` as the authoritative active task list; keep this section as RuneBench-derived design context.

The first PR should stay small enough to review:

1. `ResidentBody` waiters.
2. `ActionCoordinator`.
3. `ResidentSDK` minimal lifecycle/freshness helpers.
4. `ResidentActions` for `walkTo`, `pickupItem`, `useItemOnItem`, `chopTree`, `burnLogs`.
5. `ProgressTracker` minimal events/summaries.
6. `make-fire-5m` benchmark with disposable resident.

This slice gives us a real loop:

```text
create disposable resident
  -> observe fresh state
  -> choose make_fire routine
  -> chop tree if needed
  -> burn logs
  -> verify XP/inventory evidence
  -> emit progress + trajectory + reward
  -> clean up disposable resident
```

## Defer

- Arbitrary `execute_code` against live residents.
- Harbor integration.
- Bank/shop benchmarks until server bank/shop resident actions are proven.
- Full economy optimization until fishing/mining/cooking/fletching/smithing support is stable.
- Multi-agent competition/cooperation mechanics.
- Save-file/bank scraping in live dashboard telemetry.

## Resolved Review Questions

1. Porcelain actions should be used by benchmark/routine infrastructure first, then exposed to Brain/Body after make-fire passes.
2. `run_routine` is enough MCP power for v1. Keep `execute_code` disabled and out of autonomy.
3. Progress logs are controller-owned under `data/controller/logs`; dashboard reads via API/read model.
4. `make-fire-5m` is the first benchmark because it exercises movement, item/tool use, world interaction, waiting, XP/inventory progress, and visual human confirmation.
