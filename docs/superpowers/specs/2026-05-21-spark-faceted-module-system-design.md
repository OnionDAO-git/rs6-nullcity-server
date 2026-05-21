# SPARK Faceted Module System Design

## Goal

Make SPARK the modular intelligence engine for RuneScape residents without letting modules own the unsafe parts of the runtime.

The target architecture is:

- **SOUL** chooses identity, voice, preferences, and a reviewed module stack.
- **SPARK kernel** owns scheduling, priority, budgets, safety, action submission, evidence waits, persistence, logs, and failure isolation.
- **SPARK modules** provide replaceable Brain, Body, Nervous, workflow, prompt, observer, and benchmark capabilities through explicit facets.

The first build slice should make the current `onion.runescape.standard` adapter a real facet bundle while preserving existing behavior. Later slices should extract the large hybrid agent into smaller gameplay facets.

## Reality Before This Slice

Before the 2026-05-21 facet foundation, the seam was useful but narrow:

- SOUL can select reviewed in-repo modules.
- `onion.runescape.standard` creates the current `HybridAgentThinkingModule`.
- Inference and body action metadata include module id/version.
- The nervous system belonged directly to `ResidentRuntime`.
- Body behavior is still a `ThinkingModule` result, not a proposal facet.
- `TrustedSparkModuleContext` exposes raw mutable objects and is only safe for reviewed first-party adapters.

The 2026-05-21 foundation now makes SPARK construct Thinking and Nervous compatibility facets while preserving kernel-first nervous safety. The remaining target is not "rewrite everything now"; the safe path is to extract Brain/Body/GameSkill workflows incrementally behind public facades.

## Expert Review Incorporated

Architecture review recommended modules return decisions and proposals while the kernel keeps `ActionCoordinator`, effect waits, priority, and logs.

Security/Railgun review required a public safe facade separate from internal trusted context, durable artifact dirs, config validation, and no arbitrary code or secrets in module config.

Gameplay review warned that current scripted benchmarks do not prove module autonomy, and that workflow cards must eventually become executable action candidates with expected evidence.

Testing/observability review required a hard split between scripted engine smokes and autonomous module benchmarks, plus dashboard artifact visibility.

Implementation slicing review recommended a compatibility-first slice: make SPARK own Thinking and Nervous facet construction/identity before splitting the 2,400-line hybrid module.

Docs review required the roadmap to name the actual next slice and make old implementation plans clearly historical.

## Module Contract

Modules should move from a single `createThinkingModule()` factory toward a facet bundle.

```ts
export type SparkFacetKind =
    | 'thinking'
    | 'brain'
    | 'body'
    | 'nervous-rules'
    | 'workflow-cards'
    | 'prompt-sections'
    | 'action-candidates'
    | 'attempt-observer'
    | 'benchmarks';

export interface SparkModule {
    manifest: SparkModuleManifest;

    // Compatibility path for reviewed first-party modules only.
    createThinkingModule?(context: TrustedSparkModuleContext): ThinkingModule | undefined;

    // First facet path to ship.
    createNervousSystem?(context: TrustedSparkModuleContext): SparkNervousSystem | undefined;

    // Future safe public path for OnionDAO member modules.
    create?(context: SafeSparkModuleContext): SparkModuleInstance | undefined;

    stop?(cause: string): void | Promise<void>;
}

export interface SparkModuleInstance {
    brain?: SparkBrainFacet;
    body?: SparkBodyFacet;
    nervous?: SparkNervousFacet;
    promptSections?: SparkPromptSectionProvider;
    actionCandidates?: SparkActionCandidateProvider;
    observeAttempt?(event: SparkModuleAttemptEvent): void | Promise<void>;
    stop?(cause: string): void | Promise<void>;
}
```

Only `createThinkingModule`, `createNervousSystem`, and `stop` are intended for the immediate slice. The other facets are the stable direction, not current callable behavior.

## Brain, Body, Nervous Split

### Brain

Brain is high-level strategic thinking. It may use deeper inference, set or clear an active goal, propose plan steps, and say what the resident is trying to do.

Brain must not submit actions directly. It returns decisions:

```ts
export interface SparkBrainDecision {
    cause: string;
    goal?: { op: 'set' | 'clear' | 'keep'; value?: ActiveGoalState };
    bodyHints?: string[];
    syntheticEvents?: PerceptionEvent[];
    nooped?: boolean;
}
```

### Body

Body chooses the next concrete action for the current goal. It may use quick inference, deterministic routines, workflow cards, and action candidates.

Body must return proposals, not submit actions:

```ts
export interface SparkActionProposal {
    action: AgentAction;
    cause: string;
    priority?: number;
    confidence?: number;
    goalId?: string;
    routineId?: string;
    traceId?: string;
    expectedEffect?: SparkEffectExpectation;
}
```

The kernel chooses one proposal, submits it through `ActionCoordinator`, waits for evidence, logs the result, and notifies observers.

### Nervous System

Nervous behavior is fast, no-inference reaction. It runs before Brain/Body and can interrupt or suppress thinking.

The kernel must preserve safety priority. Modules may provide rules, but kernel survival/reflex behavior always runs first and future module rules should be clamped into lower priority bands:

```ts
export interface SparkNervousRule extends NervousRule {
    source: 'module';
    module: SparkModuleIdentity;
    priorityBand: 'survival' | 'reflex' | 'advisory';
}
```

The immediate implementation uses a simpler compatibility interface:

```ts
export interface SparkNervousSystem {
    react(perception: Perception): SparkNervousReaction | undefined;
}
```

`createSparkRuntimeFacets()` composes the kernel `NervousSystem` before any module-provided nervous facet. If the kernel reacts, the module is not consulted. If the module reacts, the runtime tags the reaction with the module id/version for logs and dashboard evidence.

## Safe Public Context

`TrustedSparkModuleContext` is internal-only for reviewed in-repo adapters. It must not be documented as the member module API.

The future public context should be data-first and capability-limited:

```ts
export interface SafeSparkModuleContext {
    module: SparkModuleIdentity;
    config: Readonly<Record<string, unknown>>;
    soul: Readonly<SoulPublicView>;
    state: SparkStateFacade;
    memory: SparkMemoryFacade;
    inference: SparkInferenceFacade;
    telemetry: SparkTelemetry;
}
```

Required constraints:

- read-only state and perception snapshots are deep-frozen or cloned
- memory is resident-scoped and namespace-scoped
- inference uses named profiles and budgets, never raw endpoints or API keys
- telemetry is redacted and size-capped
- modules cannot access `fs`, `process.env`, gateway clients, raw `MemoryStore`, raw `RuntimeState`, raw `LlmClient`, or secrets
- SOUL config is data-only, schema-validated, size-capped, and cannot contain executable entrypoints

## Runtime Flow

The faceted runtime should compose selected modules once at startup:

1. Resolve the SOUL module stack.
2. Validate module manifest capabilities against implemented factories/facets.
3. Build runtime facets:
   - first selected thinking provider
   - kernel nervous system first, then the first selected module nervous provider as an extension
   - future prompt/candidate/observer providers in SOUL order
4. On each perception:
   - observe perception in history/body
   - run kernel and module nervous reactions first
   - if nervous action fires, submit through `ActionCoordinator` and log module/facet identity
   - if not suppressed, build GameSkill context
   - run Brain/Body compatibility thinking or future Brain then Body facets
   - submit selected Body proposal through `ActionCoordinator`
   - notify GameSkill and module attempt observers
5. Persist runtime state.

The kernel remains the only layer that mutates the game.

## Benchmark Model

Benchmark tasks must be split into two modes:

| Mode | Purpose | What It Proves |
| --- | --- | --- |
| Scripted engine smoke | Benchmark task submits known actions directly | Gateway/action/effect/verifier path works |
| Autonomous module benchmark | Controller runs the selected resident module and verifier only observes | The module can actually play |

Current `make-fire-5m` and `explore-report-5m` are scripted engine smokes. They are valuable, but they must not be used as proof that SPARK modules are autonomous.

Autonomous artifacts should include:

- run id, task id/version, mode, seed
- module id/version/config hash/digest
- controller commit and dirty-worktree status
- server commit and dashboard commit when available
- resident name and lifecycle evidence
- action attempt ids and request ids
- inference request ids or counts
- linked action/inference log paths
- verifier timeline and pass/fail reason
- cleanup result
- Railgun instance id and artifact URI when running on Railgun

## Dashboard Model

Dashboard should let a human answer:

- Which module stack is this resident using?
- Which facet produced the last goal/action/reaction?
- What is the active goal?
- What action was attempted, what evidence confirmed it, and what failed?
- Which benchmarks have run for this module?
- Are we seeing scripted action smokes or autonomous module runs?

The minimum next dashboard slice is benchmark artifact list/detail pages after autonomous benchmark mode exists.

## Build Slices

1. **Facet ownership foundation:** add nervous facet construction beside thinking, centralize module facet resolution, log module identity on nervous actions, keep standard behavior unchanged.
2. **Safe context facades:** add read-only state/perception facade, resident-scoped memory facade, budgeted inference facade, telemetry redaction, and module config validation.
3. **Autonomous benchmark mode:** run disposable residents through `ResidentRuntime`/selected module while verifiers observe instead of submitting actions.
4. **Executable workflow cards:** move workflow availability toward exact action candidates with blockers, recovery, and expected effects.
5. **Brain/Body extraction:** split the hybrid module into standard Brain planner, Body routines, chat/follow, skill work, combat/prayer, trade, and exploration facets behind characterization tests.
6. **Dashboard benchmark pages:** list, filter, and inspect benchmark artifacts with module/facet evidence.
7. **OnionDAO authoring/deployment docs:** explain reviewed module creation, Railgun env vars, benchmark gates, forbidden APIs, and PR checklist.

## Acceptance Criteria

The design is ready to build when:

- `onion.runescape.standard` remains the default reviewed module
- explicit SOUL module stacks still fail fast if no thinking provider exists
- nervous actions can be attributed to a SPARK module or kernel fallback
- no public member module API exposes raw mutable runtime objects
- benchmark docs clearly distinguish scripted engine smokes from autonomous module runs
- roadmap points to the current next slice, not historical completed work
