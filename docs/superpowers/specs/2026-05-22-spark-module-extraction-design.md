# SPARK Module Extraction — Design (Workstream A / Roadmap B2–B5)

**Status:** Draft v1, pending maintainer approval and Codex coordination sign-off.
**Author:** Claude (with maintainer in brainstorming).
**Date:** 2026-05-22.
**Supersedes:** floating "split the monolith" recommendations in `feat/runebench-agent-design.md` and `feat/runebench-systems-design.md`.
**Coordinates with:** `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` (Workstream B, items B2–B5); `2026-05-21-spark-evidence-loop-design.md` (the Evidence Layer hooks into the orchestrator, not the extracted units); `docs/agent-coordination.md` (Codex is actively editing the monolith).

**Revision history:**
- v1 (2026-05-22): initial draft from brainstorming. Lays out the four-unit decomposition (`runescape-workflows`, `runescape-body-routines`, `runescape-brain-planner`, `runescape-nervous-rules`), the orchestrator remainder, the behavior-preservation strategy, and a five-plan decomposition (α/β/γ/δ/ε).

---

## Why This Spec Exists

`src/controller/thinking/hybrid-agent-thinking-module.ts` is 2,578 lines. It is the single largest source file in the controller and the only file that meaningfully blocks parallel agent work — both Codex and Claude touch it weekly, and merge collisions on it are the chief source of recent inter-agent friction (see commits 069b181e, af72caed, 9b350fbe, 4e5c9862, 7e3012d7 — all Codex, all within the last week).

The file is monolithic for historical reasons (it grew with the hybrid-thinking experiment), but it is no longer cohesive. Four distinct responsibilities live inside it:

1. **Brain planner** — periodic LLM-driven goal selection. ~lines 130–420 of the monolith.
2. **Body routines** — deterministic per-tick action selection (woodcutting, fishing, firemaking, prayer, combat, exploration, opportunistic pickup, stuck recovery). ~lines 420–820 of decision logic plus ~lines 1300–2100 of routine helpers.
3. **Nervous-system reflex rules** — survival-priority interrupts that pre-empt Brain and Body. The interrupt evaluation happens inline in the orchestrator today; the rule definitions and md-rendering helpers already live under `src/controller/nervous-system/`. Lines ~140–160 and ~500–530 of the monolith call into them.
4. **Workflow cards** — starter cards (woodcutting, fishing, firemaking, prayer, combat). Currently rendered from `runebench-playbook.ts` but referenced from Brain prompts and from Body routine dispatch inside the monolith.

Carving these into four files with explicit interfaces:

- Lets Codex and Claude touch independent units without rebasing each other.
- Makes each unit unit-testable in isolation (the monolith's tests today are largely end-to-end through `HybridAgentThinkingModule`).
- Surfaces the actual control-flow contract between Brain (slow, expensive, sets goal) and Body (fast, deterministic, executes goal) and Nervous (instant, pre-empts both).
- Reduces the surface area where a Codex change accidentally lands inside a Claude change (the recent `M` phantom modifications problem noted in `multi_agent_codex_overnight.md`).

The orchestrator file is then the thin wiring layer — Evidence Layer integration, tick-rate gating, response packaging — and nothing else.

## Goals

- Decompose `hybrid-agent-thinking-module.ts` into four single-responsibility files plus a slim orchestrator.
- Each extracted unit has an explicit TypeScript interface (its public API) and a dedicated `*.test.ts` file.
- Behavior is preserved bit-for-bit — every existing test in `hybrid-agent-thinking-module.test.ts` continues to pass throughout the extraction.
- Each extraction step is TDD-doable in 1–3 hours by a single agent (Codex or Claude).
- The orchestrator post-extraction is under 500 lines and is purely composition + I/O.
- The decomposition order yields cleanest seams first, so a half-finished extraction still leaves the tree green.
- The extraction creates clear ownership lanes so Codex and Claude can work in parallel on the controller after Workstream A lands.

## Non-Goals

- Changing agent behavior. Not a single test assertion changes. Snapshot fixtures may be reorganized but not their captured outputs.
- Rewriting the Brain prompt, Body prompt, or workflow card content. Those are extracted as-is.
- Replacing the LLM client, the perception schema, or the action schema.
- Merging `runescape-nervous-rules.ts` (module-side facet, this spec) with `src/controller/nervous-system/` (kernel-side reflex engine). See Open Question #4 — the two are deliberately distinct, and this spec only extracts the module-side facet.
- Touching `runebench-playbook.ts`. Workflow cards already live there; this spec moves the per-card *dispatch and adapter* logic out of the monolith into a new `runescape-workflows.ts`, but the `SUPPORTED_WORKFLOWS` constant and `WorkflowCard` interface remain in the playbook.
- Refactoring `basic-agent-thinking-module.ts`. The basic module is a separate path; this spec is hybrid-only.

## Constraints

- TypeScript, Node 24+, existing repo conventions (Zod for schemas, Jest for tests, Biome for lint/format).
- The orchestrator file path must stay at `src/controller/thinking/hybrid-agent-thinking-module.ts`. External imports (most notably `src/controller/spark/spark.ts` and `src/controller/index.ts`) already reference it by that path. New files live next to it under `src/controller/thinking/`.
- The four extracted units MUST be pure(-ish) — they may read from a passed-in state argument and they may return action descriptions, but they must not directly write to disk, call the LLM, or mutate shared kernel singletons. All side effects route back through the orchestrator.
- All four units MUST be free of `import './hybrid-agent-thinking-module'` (no back-edges into the orchestrator). The dependency graph is one-way: orchestrator → unit.
- Existing test files (`hybrid-agent-thinking-module.test.ts`) MUST continue to exist and pass throughout. New unit-level tests are additive.
- Codex is actively editing the monolith. Every extraction plan MUST end with a clean push to the default branch (`nullcity` on rs6-nullcity-server) before the next plan begins, so Codex can rebase against a stable seam. See Multi-Agent Coordination Notes.
- The slim orchestrator must continue to implement the `ThinkingModule` interface from `src/controller/thinking/thinking-module.ts`. Its public class name (`HybridAgentThinkingModule`) and constructor signature (`HybridAgentThinkingModuleOptions`) MUST NOT change.

---

## Architecture

```
                            ┌─────────────────────────────────────┐
                            │  HybridAgentThinkingModule          │
                            │  (orchestrator, src/.../thinking/   │
                            │   hybrid-agent-thinking-module.ts)  │
                            │                                     │
                            │  - implements ThinkingModule         │
                            │  - tick-rate gating                  │
                            │  - LLM endpoint plumbing             │
                            │  - response packaging + Evidence    │
                            │    Layer hooks                       │
                            └──┬─────────────┬─────────────┬──────┘
                               │             │             │
                               │ evaluate    │ pickGoal    │ runRoutine
                               │ (reflex)    │ (LLM)       │ (deterministic)
                               ▼             ▼             ▼
        ┌────────────────────────┐ ┌────────────────────┐ ┌────────────────────────┐
        │ runescape-nervous-     │ │ runescape-brain-   │ │ runescape-body-        │
        │ rules.ts               │ │ planner.ts         │ │ routines.ts            │
        │                        │ │                    │ │                        │
        │ - survival reflexes    │ │ - goal selection   │ │ - per-goal action      │
        │ - stuck escape         │ │   prompt assembly  │ │   selection            │
        │ - low-HP retreat       │ │ - parse Brain JSON │ │ - stuck-recovery       │
        │ - hostile pre-empt     │ │ - active-goal      │ │   fallbacks            │
        │                        │ │   factories        │ │ - opportunistic        │
        │ (pure functions over   │ │                    │ │   pickup, NPC talk     │
        │  perception + state)   │ │ (pure assembler)   │ │                        │
        └────────────────────────┘ └─────────┬──────────┘ └──────────┬─────────────┘
                                             │                       │
                                             │ goal factories use    │ body dispatch
                                             │ workflow metadata     │ keys on workflow
                                             ▼                       ▼
                                       ┌────────────────────────────────────┐
                                       │ runescape-workflows.ts             │
                                       │                                    │
                                       │ - WorkflowDispatch table           │
                                       │   (workflowId → { goalFactory,     │
                                       │                   routineFn,       │
                                       │                   missingToolFn,   │
                                       │                   detectors })     │
                                       │ - re-exports WorkflowCard / SUPPORTED_WORKFLOWS
                                       │   from runebench-playbook.ts       │
                                       │ - per-workflow helpers (axes,      │
                                       │   tinderboxes, fishing spots,      │
                                       │   bones, prayer waypoints)         │
                                       └────────────────────────────────────┘
```

**One-way dependency arrows.** Workflows is a leaf (only depends on `runebench-playbook.ts` plus shared types). Brain and Body both import from Workflows. Nervous depends only on shared types. The orchestrator composes all four.

**Hot path.** Per tick: orchestrator asks Nervous first; if Nervous yields an action, that ships and Brain/Body are skipped. Otherwise the orchestrator runs Body's routine for the current goal; Body may emit an action or signal `body_wait`. The orchestrator then decides whether this is a Brain-eligible tick (based on `brainEveryTicks`); if so it calls Brain to (re-)pick a goal. The selected goal is persisted into cognition state and used by the next tick's Body call.

## Components

| Unit | New file | Approx. lines from monolith | Public exports | Depends on | Tested by |
|---|---|---|---|---|---|
| Workflows | `src/controller/thinking/runescape-workflows.ts` | 1300–1530, 1480–1540 (tool detectors), parts of 1430–1470 | `WorkflowDispatch`, `dispatchForGoal(goal)`, re-exports of `WorkflowCard`/`SUPPORTED_WORKFLOWS`, helper predicates (`isTinderbox`, `isFiremakingLog`, `isWoodcuttingAxe`, `hasWoodcuttingAxe`, `isSmallFishingNet`, `hasSmallFishingNet`, `isStarterRawFish`, `isFishingSpot`, `isBones`, `isSafeBoneSource`, `isSafeCombatTarget`) | `runebench-playbook.ts`, shared perception/item types | `runescape-workflows.test.ts` |
| Body routines | `src/controller/thinking/runescape-body-routines.ts` | 420–820 (decision flow), 1300–1430 (action helpers), 1530–2070 (combat/prayer/explore/pickup) | `runBodyRoutine(input) → BodyDecision`, `BodyDecision` type, supporting routine functions (`firemakingAction`, `levelOneWoodcuttingAction`, `starterFishingAction`, `starterFishingCookingAction`, `buryBonesAction`, `prayerTrainingAction`, `combatTrainingAction`, `combatLootOrPrayerAction`, `explorationAction`, `opportunisticPickupAction`), stuck-recovery (`stuckOpenObstacleAction`, `stuckBlockerReportAction`, `stuckMoveRecovery`) | `runescape-workflows.ts`, shared types | `runescape-body-routines.test.ts` |
| Brain planner | `src/controller/thinking/runescape-brain-planner.ts` | 130–420 (runBrain), 1279–1305 (parseBrainCompletion + schemas), 1305–1430 (goal factories: `firemakingGoal`, `woodcuttingGoal`, `starterFishingGoal`, `starterFishingCookingGoal`, `starterCookingGoal`, `prayerGoal`, `combatGoal`, `explorationGoal`, `benchmarkGoalForTask`) | `BrainPlanner` class OR `runBrainTurn(input) → BrainDecision` (DI'd LLM client), `brainGoalSchema`, `brainCompletionSchema`, `parseBrainCompletion`, goal-factory functions | `runescape-workflows.ts`, `hybrid-agent-prompts.ts` (already separate), Zod | `runescape-brain-planner.test.ts` |
| Nervous rules | `src/controller/thinking/runescape-nervous-rules.ts` | 140–160 (presence-beacon special-case), inline reflex blocks scattered through 500–600, calls into `src/controller/nervous-system/rules-md.ts` | `evaluateNervousReflexes(input) → NervousDecision | null`, `NervousDecision` type | `src/controller/nervous-system/rules-md.ts`, shared types | `runescape-nervous-rules.test.ts` |
| Orchestrator | `src/controller/thinking/hybrid-agent-thinking-module.ts` (slimmed) | What remains: ~lines 1–130, 100–250 (constructor, plumbing), 820–1150 (response packaging, tick gating), 2070–2578 (utility/normalization that doesn't belong elsewhere) | `HybridAgentThinkingModule`, `HybridAgentThinkingModuleOptions` (unchanged) | All four extracted units; Evidence Layer (per other spec); existing inference + memory plumbing | `hybrid-agent-thinking-module.test.ts` (unchanged) |

### What stays in the orchestrator

The orchestrator post-extraction is responsible for:

1. Implementing the `ThinkingModule` interface — `think(perception): Promise<ThinkResult>`.
2. Tick-rate gating: deciding whether this tick is brain-eligible (`shouldRunBrain()`) or body-eligible (`shouldRunBody()`), reading `behavior().brainEveryTicks` and `behavior().bodyEveryTicks`.
3. LLM endpoint resolution: `endpointFor(behavior.brain)`, `temperatureFor(...)`, model selection — the `runBrain` invocation today is mostly endpoint plumbing, and that plumbing stays here. The Brain unit accepts a `BrainClient` interface, which the orchestrator implements over the real LLM client.
4. Response packaging: `this.result(actions, cause, envelopeTokens, nooped)` and the `ThinkResult` shape stay here.
5. Cognition state mutation: updating `cognition.lastBrainTick`, `cognition.lastBodyTick`, `cognition.activeGoal`, etc. Extracted units RETURN intended mutations as part of their decision payload; the orchestrator applies them.
6. Evidence Layer hooks (per `2026-05-21-spark-evidence-loop-design.md`): `beginTick`/`recordHook`/etc. live in the orchestrator, not in the extracted units. The units never know about Evidence.
7. Soul/profile loading, nervous-rules.md upsert/retire on construction and shutdown.

The orchestrator does NOT contain:

- Goal factory functions, Brain prompt schemas, Brain completion parsing.
- Body routine selection logic (the giant `switch`/`if-chain` over goal kinds).
- Per-skill action functions (firemaking, woodcutting, fishing, combat, prayer, explore, pickup).
- Stuck-recovery action functions.
- Workflow-card-keyed dispatch tables.
- Reflex evaluation (presence beacon, low-HP retreat, etc.).

### Interface shape sketches

Concrete interfaces are nailed down in the per-plan TDD cycle. The shapes below are illustrative — the goal is that each extracted unit takes an immutable input bundle and returns a value (no side effects, no shared mutable state).

```ts
// runescape-workflows.ts
export interface WorkflowDispatchEntry {
  workflow: WorkflowCard;
  goalFactory: (tick: number) => ActiveGoalState;
  isMatchingGoal: (goal: ActiveGoalState) => boolean;
  routine: (input: BodyRoutineInput) => BodyDecision | undefined;
  missingToolAction?: (perception: HybridPerception) => AgentAction | undefined;
}

export function dispatchForGoal(goal: ActiveGoalState): WorkflowDispatchEntry | undefined;
export function dispatchForWorkflowId(id: string): WorkflowDispatchEntry | undefined;
```

```ts
// runescape-body-routines.ts
export interface BodyRoutineInput {
  perception: HybridPerception;
  goal: ActiveGoalState | undefined;
  here: Pos;
  activeMove: ActiveMoveState;
  cognition: CognitionState;        // read-only
  tick: number;
}

export interface BodyDecision {
  action?: AgentAction;
  cause: string;                     // never empty
  cognitionPatch?: Partial<CognitionState>;
  nooped: boolean;
}

export function runBodyRoutine(input: BodyRoutineInput): BodyDecision;
```

```ts
// runescape-brain-planner.ts
export interface BrainClient {
  complete(args: BrainCompletionArgs): Promise<BrainCompletionResult>;
}

export interface BrainTurnInput {
  perception: HybridPerception;
  gameSkill: GameSkill;
  cognition: CognitionState;
  behavior: AgentBehavior;
  client: BrainClient;
}

export interface BrainDecision {
  action?: AgentAction;
  goalPatch?: ActiveGoalState;
  cause: string;
  envelopeTokens: number;
  nooped: boolean;
  sayAction?: AgentAction;
}

export function runBrainTurn(input: BrainTurnInput): Promise<BrainDecision>;
```

```ts
// runescape-nervous-rules.ts
export interface NervousReflexInput {
  perception: HybridPerception;
  cognition: CognitionState;
  tick: number;
}

export interface NervousDecision {
  action: AgentAction;
  cause: string;            // always 'presence_beacon' | 'low_hp_retreat' | ... — fully enumerated
  preempts: 'brain' | 'body' | 'both';
}

export function evaluateNervousReflexes(input: NervousReflexInput): NervousDecision | null;
```

The exact field names will be discovered in TDD, not designed up-front. The shape above is the contract the spec promises; field bikeshedding is delegated to per-plan implementation.

## Data Flow

```
think(perception)
  │
  ├─ orchestrator: nervous = evaluateNervousReflexes({ perception, cognition, tick })
  │  └─ if nervous !== null:
  │       └─ orchestrator packages nervous.action into ThinkResult and returns
  │          (Evidence Layer records reflex; Brain/Body skipped this tick)
  │
  ├─ orchestrator: if shouldRunBody:
  │       bodyDecision = runBodyRoutine({ perception, goal: cognition.activeGoal, ... })
  │       if bodyDecision.action: orchestrator packages and returns
  │       (note: Body may emit `body_wait` causing brain consult below if eligible)
  │
  ├─ orchestrator: if shouldRunBrain (or body_wait + brain eligible):
  │       brainClient = orchestrator.buildBrainClient()   // captures LLM endpoint + token budget
  │       brainDecision = await runBrainTurn({ perception, gameSkill, cognition, behavior, client })
  │       if brainDecision.goalPatch: orchestrator commits patch into cognition.activeGoal
  │       if brainDecision.action: orchestrator packages and returns
  │       else: orchestrator packages `body_wait` noop
  │
  └─ orchestrator returns ThinkResult, Evidence Layer records decision
```

The orchestrator owns cognition state; extracted units never write to it. They return `patch` objects that the orchestrator applies. This is the single biggest correctness lever in the refactor — it removes the "who mutated `cognition.lastBrainTick`?" ambiguity that the monolith has today.

## Error Handling

| Failure | Behavior | Visibility |
|---|---|---|
| `runBrainTurn` throws (LLM error, parse error not caught internally) | Orchestrator catches, returns `body_wait` noop with `cause: 'brain_error'`, logs to inference log | Existing behavior preserved |
| `runBodyRoutine` throws | Orchestrator catches, returns `body_wait` noop with `cause: 'body_error'`, logs | New — today such throws crash the tick |
| `evaluateNervousReflexes` throws | Orchestrator catches, treats as `null` (no reflex), logs once per session | New — today the inline reflex code can throw and corrupt the tick |
| Workflow dispatch lookup returns undefined for active goal | Body returns `body_wait`, orchestrator escalates to Brain on next eligible tick | Behavior-preserved (same as monolith's fall-through) |
| Brain returns a goal patch with an unknown workflow id | Orchestrator logs warning, ignores patch, returns `body_wait` | Existing behavior preserved |

Error handling becomes substantially more robust as a side effect — extracted units catch parse failures locally, and the orchestrator catches unit failures at the seam. The monolith today has scattered try/catch with inconsistent coverage; the refactor consolidates this.

## Testing

### Behavior preservation strategy

Behavior preservation is the spec's tightest correctness requirement. The strategy is:

1. **Before extraction begins**: snapshot the existing test outputs. `hybrid-agent-thinking-module.test.ts` already exercises a wide range of scenarios. Run it once and capture the test assertions and any inline snapshots as the "golden" set. No new behavior tests added; existing ones become the contract.
2. **Add fixture-driven characterization tests**: for each unit about to be extracted, write a tabletop fixture (perception + state + goal → expected action + cause) covering at least the cases the existing tests imply. These fixtures live next to the new unit's test file and double as documentation.
3. **Extract via "move, not rewrite"**: copy the functions verbatim into the new file, then change the monolith to import from the new file. No logic edits during the move. A diff of the extracted file against the source range in the monolith must show only formatting + import-rewrite changes — no semantic deltas.
4. **Run full test suite after each move**: `hybrid-agent-thinking-module.test.ts` plus the new unit's test file must both be green. Then push to `nullcity`.
5. **Slim the orchestrator last**: only after all four units are extracted does the orchestrator get its final tidy-up (removing dead helpers, reordering imports, shrinking the constructor). That cleanup is its own plan and is purely cosmetic.

### Unit tests

- `runescape-workflows.test.ts` — dispatch table coverage: every entry in `SUPPORTED_WORKFLOWS` has a goal factory, a routine, and round-trips through `dispatchForGoal`/`dispatchForWorkflowId`. Helper predicates have positive and negative cases.
- `runescape-body-routines.test.ts` — for each workflow, given a perception fixture + active goal, the routine returns the expected action. Stuck-recovery scenarios are their own fixtures (open obstacle, blocker say, move recovery).
- `runescape-brain-planner.test.ts` — parse-completion handles valid JSON, malformed JSON, and JSON-with-extra-keys. Goal factories produce correctly-shaped `ActiveGoalState`. The `runBrainTurn` happy path with a stub `BrainClient` returns the expected `BrainDecision`.
- `runescape-nervous-rules.test.ts` — reflex predicates trigger correctly: presence beacon when no soul name change, low-HP retreat when below threshold, etc. Each reflex has a positive and a negative fixture.

### Integration / regression

- `hybrid-agent-thinking-module.test.ts` is the regression contract. No edits allowed during extraction beyond import-path updates.
- The `make-fire-5m`, `woodcutting-firemaking-10m`, `starter-fishing-5m`, `explore-report-5m`, `follow-and-chat-5m`, and `combat-prayer-10m` benchmark fixtures (where they have offline test forms) run through the extracted units and the orchestrator and produce the same actions as before.

### Snapshot

- One end-to-end snapshot of a 50-tick scripted scenario (mock perception adapter from the Evidence Layer spec) producing an action log. This snapshot exists before extraction begins and must remain bit-for-bit identical through all five plans. If it changes, the extraction is wrong.

## Decomposition Into Plans

Five plans, in dependency order. Each is independently shippable and TDD-doable in 1–3 hours. The order is chosen so the *cleanest seam* extracts first and the orchestrator slim-down — which has the most cross-cutting concerns — comes last.

### Plan α — Workflow dispatch extraction

- Create `runescape-workflows.ts` containing `WorkflowDispatchEntry`, `dispatchForGoal`, `dispatchForWorkflowId`, the per-workflow helper predicates, and the dispatch table.
- Move predicates (`isTinderbox`, `isFiremakingLog`, `isWoodcuttingAxe`, etc.) verbatim from the monolith.
- Orchestrator and Body code temporarily import predicates from the new file but keep their action-selection switches inline (those move in plan β).
- Tests: `runescape-workflows.test.ts` covers every dispatch entry and every predicate.
- Acceptance: existing tests green; `runescape-workflows.test.ts` green; push to `nullcity`.
- Estimated time: 1.5 hours.
- Source line range affected: ~1300–1540 of the monolith.

### Plan β — Body routines extraction

- Create `runescape-body-routines.ts` with `runBodyRoutine` and all per-skill action functions (`firemakingAction`, `levelOneWoodcuttingAction`, `starterFishingAction`, `starterFishingCookingAction`, `buryBonesAction`, `prayerTrainingAction`, `combatTrainingAction`, `combatLootOrPrayerAction`, `explorationAction`, `opportunisticPickupAction`).
- Move stuck-recovery functions (`stuckOpenObstacleAction`, `stuckBlockerReportAction`, the move-recovery branch) into the same file under a `stuckRecovery` namespace or as siblings.
- `runBodyRoutine` is the dispatcher — given a goal, it calls into the routine via the workflow dispatch table from plan α and handles stuck-recovery escalation.
- Orchestrator now calls `runBodyRoutine(input)` instead of having the routine logic inline.
- Tests: `runescape-body-routines.test.ts` covers each routine and the stuck-recovery escalation order.
- Acceptance: existing tests green; new test file green; push.
- Estimated time: 2.5 hours (largest plan; most fixture coverage needed).
- Source line range affected: ~420–820 and ~1300–2070 of the monolith.

### Plan γ — Nervous reflex extraction

- Create `runescape-nervous-rules.ts` exporting `evaluateNervousReflexes`.
- Move the inline reflex block (presence beacon, any low-HP / hostile-pre-empt logic) from the orchestrator into the new file.
- The `nervous-system/rules-md.ts` module-side facet (upsert/retire of `rules.md`) is invoked by the orchestrator on construction/shutdown, not by `runescape-nervous-rules.ts` itself. `runescape-nervous-rules.ts` is the *evaluation* facet only; the md-writing facet stays where it is.
- Tests: `runescape-nervous-rules.test.ts` with one positive + one negative fixture per reflex.
- Acceptance: existing tests green; new test file green; push.
- Estimated time: 1.5 hours.
- Source line range affected: ~140–160 and ~500–530 of the monolith (small but cross-cutting).

### Plan δ — Brain planner extraction

- Create `runescape-brain-planner.ts` with `runBrainTurn`, `parseBrainCompletion`, `brainGoalSchema`, `brainCompletionSchema`, and all goal-factory functions (`firemakingGoal`, `woodcuttingGoal`, `starterFishingGoal`, `starterFishingCookingGoal`, `starterCookingGoal`, `prayerGoal`, `combatGoal`, `explorationGoal`, `benchmarkGoalForTask`).
- Define `BrainClient` interface (LLM completion abstraction). Orchestrator constructs the real `BrainClient` over its existing inference plumbing.
- Goal factories are pure functions of `tick`; they don't change at all.
- Tests: `runescape-brain-planner.test.ts` with parse fixtures (valid, malformed, extra-keys), goal-factory shape checks, and one `runBrainTurn` happy path with a stub client.
- Acceptance: existing tests green; new test file green; push.
- Estimated time: 2 hours.
- Source line range affected: ~130–420 and ~1279–1430 of the monolith.

### Plan ε — Orchestrator slim-down

- After α–δ land, the orchestrator file has ~1500 lines of dead helpers, unused imports, and now-trivial wrappers.
- Delete the moved code (it was kept inline during α–δ as a safety net via import-and-re-export; this plan removes it).
- Tidy the constructor, the tick-gating helpers (`shouldRunBrain`, `shouldRunBody`, `progressPromptInput`), and the response packager (`this.result`).
- Verify orchestrator is under 500 lines.
- Tests: `hybrid-agent-thinking-module.test.ts` green; the suite-wide snapshot stable.
- Acceptance: existing tests green; line count under 500; push.
- Estimated time: 1–2 hours.

**Recommended order: α → β → γ → δ → ε.** Workflows first because it's a leaf with no orchestrator changes. Body next because it consumes Workflows directly. Nervous next because it's small and self-contained. Brain next because it depends on goal-factory + workflow knowledge. Orchestrator last because the cleanup makes no sense until everything else is out.

A more aggressive parallelization (α and γ in parallel, then β and δ in parallel) is possible if two agents are coordinated — see Multi-Agent Coordination Notes. The serial order is safer when Codex is mid-edit on the monolith.

---

## Multi-Agent Coordination Notes

Codex pushed five commits to `hybrid-agent-thinking-module.ts` in the last week (069b181e, af72caed, 9b350fbe, 4e5c9862, 7e3012d7). Extraction without coordination will collide. The protocol:

### Yield / merge / split

1. **Yield** (default): before starting any plan in this spec, check `git log -5 src/controller/thinking/hybrid-agent-thinking-module.ts`. If the newest commit is younger than 4 hours, do not start. Mark the roadmap item `[>]` (in progress by other agent) and pick a different task. Re-check on the next pass.
2. **Merge** (if Codex is mid-flight but on an orthogonal area): if Codex's recent commits are in line ranges that don't overlap the plan's source range (per the table in Components above), proceed but mark the roadmap item `[>]` with the agent name. The shared-filesystem hazard from `multi_agent_codex_overnight.md` applies — never `git commit --amend`, always create a new commit; do not stage `src/controller/thinking/hybrid-agent-thinking-module.ts` unless your plan explicitly edits it.
3. **Split** (if Codex starts editing while a plan is in flight): finish the current plan's *moves* (the unit file is fully created and tests pass) but skip the monolith edit. Push the new unit file standalone with the monolith importing it as a no-op (re-export only). Next session, do the monolith integration as its own micro-plan once Codex stabilizes.

### Per-plan checklist (multi-agent safe)

Each of α/β/γ/δ/ε MUST:

- Start with a fresh `git pull` and a status-log entry naming the plan.
- Create the new unit file + its test file as the *first* commit. This is purely additive and cannot collide.
- Make the monolith edit (importing the new unit, removing the moved code) as the *second* commit. This is the only collision-prone step.
- Push immediately on each commit. Do not batch.
- End with a status-log entry naming the next plan and any observations.

### File-level locks via roadmap

Workstream A items B2–B5 + the orchestrator slim-down get explicit `[>]` markers in the roadmap once a plan starts, removed once a plan lands. This is the same mechanism `multi_agent_codex_overnight.md` documents as working. Codex is expected to read the roadmap before editing `hybrid-agent-thinking-module.ts` — if it doesn't, the merge fallback (yield / split) handles the collision.

### Tests-as-contract

The biggest safety net is `hybrid-agent-thinking-module.test.ts` green after every push. Codex respects this implicitly; Claude must too. If a push lands with a red test suite, the next agent reverts (no exceptions) and the status log records the revert.

---

## Open Questions

1. **Brain interface shape.** Should `runBrainTurn` be a free function with a `client` argument, or a `BrainPlanner` class with the client in its constructor? The free-function form is simpler to test and matches the Body/Nervous units' style. The class form matches how the orchestrator currently structures inference plumbing. *Lean: free function, finalize during plan δ TDD.*
2. **Dependency injection style for `BodyRoutineInput`.** Should `cognition` be passed by reference (read-only contract enforced by TypeScript `Readonly<>`) or as a snapshot (deep-cloned)? Snapshots are safer but copy-heavy on hot path. *Lean: `Readonly<CognitionState>` with eslint rule, snapshot only in tests.*
3. **WorkflowCard ↔ Body routine coupling.** Do per-workflow routines live in `runescape-workflows.ts` or `runescape-body-routines.ts`? The spec puts them in body-routines and uses workflow-dispatch as the lookup table. Alternative: each workflow card carries its own routine in `runescape-workflows.ts` and body-routines becomes a thin dispatcher. *Lean: keep routines in body-routines for now; if a fifth workflow lands and requires per-workflow state, revisit.*
4. **Relationship to `src/controller/nervous-system/*`.** The kernel-side nervous system (`rules.ts`, `rules-md.ts`, `nervous-system.ts`) handles reflex *rules definition* and *markdown rendering*. The new `runescape-nervous-rules.ts` is the *module-side evaluator* — it takes perception + cognition and decides whether a reflex pre-empts this tick. They are NOT the same. The module-side file does, however, *call into* `rules-md.ts` indirectly (the orchestrator owns the upsert call on construction). Open: should the kernel-side nervous-system surface a single `evaluate(perception)` function and `runescape-nervous-rules.ts` collapse to a thin call into it? *Lean: no — the kernel side is rule storage and md serialization; the module side is runtime evaluation. They have different lifecycles and test surfaces.*
5. **Stuck-recovery ownership.** The stuck-recovery functions (`stuckOpenObstacleAction`, `stuckBlockerReportAction`, `stuckMoveRecovery`) sit at the boundary between Body and Nervous. Are they Body (because they're called during the Body routine, mid-execution) or Nervous (because they're survival reflexes)? *Lean: Body. They activate during Body's routine execution, not as a pre-emption. Nervous is for things that interrupt before Body runs.*
6. **Goal factory location.** Goal factories (`firemakingGoal`, `woodcuttingGoal`, etc.) live in the Brain file because the Brain is what calls them. But the Body needs to *match* a goal back to its workflow, which means `isFiremakingGoal`/`isWoodcuttingTrainingGoal`-style predicates. Should those predicates live in `runescape-workflows.ts` (alongside the dispatch table) or in `runescape-brain-planner.ts` (alongside the factories)? *Lean: workflows — they're identity predicates over `ActiveGoalState`, the shape produced by factories but consumed by dispatch.*
7. **Orchestrator size target.** "Under 500 lines" is aspirational. If Evidence Layer plumbing (from the other spec) lands first and adds ~150 lines, the target might creep to 600. Is that acceptable? *Lean: yes, as long as the orchestrator is composition + I/O only. Line count is a proxy for cohesion, not a hard constraint.*

## Risks

- **Behavior drift during move.** A function moved verbatim can still subtly change behavior if its closure over module-level state changes. Mitigation: every moved function is checked for module-level references; closures over `this` (in the class) are explicitly converted to parameters. The end-to-end snapshot test catches most drift.
- **Codex collision during plan β.** Body routines are 800+ lines and overlap most of Codex's recent edit areas. Plan β is the highest collision risk. Mitigation: do plan β when Codex is quiet (check `git log`); if Codex pushes mid-plan, follow the Split protocol.
- **Test fixture drift.** Existing tests in `hybrid-agent-thinking-module.test.ts` may rely on import paths or private helpers. Mitigation: keep all imports re-exported from the orchestrator during α–δ; remove the re-exports only in ε.
- **Brain endpoint plumbing.** The Brain unit's `BrainClient` abstraction must capture endpoint + temperature + model + thinking mode without leaking the LLM client's internals. If the abstraction is wrong, every prompt-tweak commit Codex makes will collide with the orchestrator. Mitigation: keep the prompt assembly inside the Brain unit but the endpoint resolution inside the orchestrator; `BrainClient` is a single `complete(args) → Promise<result>` method.
- **Cognition state ownership.** If the orchestrator continues to read/write cognition while the units also read/write it (via patches), race conditions become possible. Mitigation: enforce read-only access in units (`Readonly<CognitionState>` types) and apply patches synchronously inside the orchestrator before returning the tick result.
- **Snapshot fragility.** The end-to-end action-log snapshot is sensitive to action ordering. If extraction changes the order of `isMatchingGoal` checks (because of dispatch table ordering), the snapshot breaks even though behavior is "equivalent." Mitigation: the dispatch table preserves source-order from the monolith's `switch` statements; tests on dispatch table order are explicit.
- **Multi-agent re-entry.** If Codex is in the middle of editing a file that plan β just extracted, Codex's diff applies to a moved range. Mitigation: the Split protocol; never start a plan that touches a file Codex has touched in the last 4 hours.

---

## Cross-References

- `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` — Workstream B (this spec implements B2–B5).
- `docs/superpowers/specs/2026-05-21-spark-evidence-loop-design.md` — Evidence Layer hooks into the orchestrator only; the four extracted units are evidence-agnostic.
- `docs/superpowers/specs/2026-05-21-spark-faceted-module-system-design.md` — the broader module-system context this extraction lives inside.
- `docs/agent-coordination.md` — coordination protocol with Codex; this spec extends it with the yield / merge / split rules above.
- Memory: `feedback_no_feature_branches.md` — pushes go to `nullcity` directly, no `claude/<topic>` branches.
- Memory: `multi_agent_codex_overnight.md` — shared-filesystem hazards informing the per-plan checklist.
- `src/controller/thinking/runebench-playbook.ts` — `WorkflowCard`/`SUPPORTED_WORKFLOWS` source; not moved by this spec.
- `src/controller/nervous-system/rules-md.ts` — kernel-side nervous-system facet; distinct from `runescape-nervous-rules.ts` (module-side).
- `src/controller/thinking/hybrid-agent-prompts.ts` — Brain/Body prompt templates; already separate, not touched by this spec.
