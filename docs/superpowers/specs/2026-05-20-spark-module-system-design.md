# SPARK Module System Design

> **Current successor:** Use `docs/superpowers/specs/2026-05-21-spark-faceted-module-system-design.md` for the current Brain/Body/Nervous SPARK facet design. This file remains useful historical context for the first module-selection seam.

## Goal

Turn the current RuneScape resident autonomy work into a modular SPARK engine: SOUL files provide authored identity, while SPARK modules provide resident intelligence capabilities that can be versioned, reviewed, benchmarked, and compared.

The first production-quality outcome is a safe in-process module seam for first-party and reviewed modules. It should let the current "standard" RuneScape agent become an explicit module without allowing arbitrary code from SOUL or memory files.

## Principles From Null City

SPARK is the resident runtime, not a single prompt. Null City v1 frames resident creation as three-part authorship: a developer creates a framework, a human creates a soul, and an existing resident mentors the newcomer. Null City v1 and v2 both treat SPARK as needs, inner life, perception, action, memory, and scarcity. RuneScape should keep that split:

- **SOUL:** authored identity, voice, goals, fears, quirks, starting beliefs, initial inventory, and selected module stack.
- **SPARK kernel:** trusted runtime that owns scheduling, attention/budgets, perception ingestion, action submission, safety priority, persistence, logs, and failure isolation. Kernel behavior is not selectable or replaceable from SOUL.
- **SPARK modules:** reviewed capability packages that add thinking policies, hooks, prompt sections, workflow cards, candidate actions, attempt observers, and benchmark metadata.

## Non-Negotiables

1. Modules never receive `Player`, world internals, gateway clients, raw filesystem access, process execution, or secrets.
2. SOUL and memory may select/configure modules but may not load arbitrary code.
3. All game mutation still goes through typed `AgentAction` and `ActionCoordinator`.
4. Nervous/survival behavior remains highest priority.
5. Every module decision must be inspectable by module id, version, cause, and action evidence.
6. Benchmarks use disposable residents and persistent artifacts so results are reproducible locally and on Railgun.
7. If a SOUL declares a module stack, selected modules must be auditable in inference and action logs.
8. A selected module stack without a thinking provider is an error unless a later explicit legacy fallback flag is added.

## Proposed Module Contract

The initial contract is resident-scoped and facet-based. A module can implement one or more facets; the kernel composes them in a deterministic order.

```ts
export interface SparkModuleManifest {
    id: string;
    version: string;
    displayName: string;
    owner?: string;
    description?: string;
    capabilities: SparkModuleCapability[];
    minControllerVersion?: string;
    risk?: 'core' | 'reviewed' | 'experimental';
}

export interface SparkModule {
    manifest: SparkModuleManifest;
    createThinkingModule?(context: TrustedSparkModuleContext): ThinkingModule | undefined;
    hooks?(context: SparkTickContext): HookDefinition[];
    nervousRules?(context: SparkTickContext): SoulNervousRuleDefinition[];
    candidates?(context: SparkTickContext): AgentAction[];
    promptSections?(context: SparkPromptContext): SparkPromptSection[];
    observeAttempt?(event: SparkModuleAttemptEvent): void | Promise<void>;
    stop?(cause: string): void;
}
```

The first build slice should implement the manifest, SOUL module declarations, selection, default registry, thinking-module factory facet, and module identity logging. Later slices can add hooks, prompt sections, workflow/candidate providers, benchmark wiring, and narrower sandbox-safe facades.

`TrustedSparkModuleContext` is intentionally named. Phase 1 modules are first-party or PR-reviewed in-repo adapters and may receive existing controller objects needed to preserve current behavior. Experimental member modules that are not trusted code should use a future facaded API with resident-scoped memory, budgeted inference, read-only state, and approved state mutation helpers.

## Current Implementation Status

Implemented now: module manifests, strict SOUL module selection, default first-party registry, `createThinkingModule()` selection, `onion.runescape.standard`, and module identity in inference/action metadata.

Planned later: hooks, nervous rules, candidate providers, prompt-section providers, attempt observers, benchmark facets, safe third-party facades, and module leaderboards. Module authors should not assume those facets are callable until the roadmap marks the matching task complete.

## SOUL Selection

Add a `modules` array to SOUL frontmatter:

```yaml
modules:
  - id: onion.runescape.standard
    enabled: true
```

Legacy `behavior.kind: basic-agent | hybrid-agent` remains supported when `modules` is omitted. If `modules` is present, the runtime resolves enabled modules strictly and fails fast for unknown ids, duplicate ids, or a stack that cannot provide thinking. Module config is accepted as data-only pass-through in the first slice; the standard module continues to read existing `behavior` fields until a later typed config adapter is added.

## Standard Modules

The current work should become first-party modules:

- `onion.runescape.standard`: the default RuneScape Brain/Body/Nervous/GameSkill stack.
- `onion.runescape.workflows.starter`: woodcutting, firemaking, fishing, safe combat, prayer, follow/chat, and exploration workflow cards.
- `onion.runescape.knowledge`: engine-local knowledge retrieval, wiki snippets, suggestions, and review workflow.
- `onion.runescape.benchmarks.starter`: benchmark tasks and verifiers.

`onion.spark.core` can appear in logs or dashboard read models as the kernel identity, but it is not a SOUL-selectable module. Only the first seam needs to land now. Splitting the hybrid module can happen incrementally after the seam exists.

## Runtime Flow

1. `ControllerHost` builds the default first-party registry unless tests or tools provide one.
2. `ResidentRuntime` receives the registry and resolves the resident SOUL module stack.
3. `createThinkingModuleSelection()` checks enabled SOUL modules first.
4. If a selected module provides `createThinkingModule()`, that module creates the thinking policy and returns module identity metadata.
5. If `modules` is omitted, legacy `behavior.kind` selection runs.
6. If `modules` is present but no selected module provides a policy, startup fails loudly.
7. Action submission and evidence observation remain in `ResidentRuntime` and `ActionCoordinator`.
8. Inference and body action logs include module id/version for module-produced thinking.

This preserves current behavior while making module selection explicit and testable.

## Benchmark And Experiment Model

Every module experiment should produce a run artifact:

```json
{
  "runId": "bench_20260520_fire_001",
  "module": { "id": "onion.runescape.standard", "version": "0.1.0", "digest": "local" },
  "task": { "id": "make-fire-5m", "version": 1 },
  "resident": "res:bmk_fire_001",
  "model": "qwen-or-local",
  "controllerCommit": "...",
  "serverCommit": "...",
  "startedAt": "...",
  "finishedAt": "...",
  "score": 0.0,
  "pass": false,
  "metrics": {
    "ticksToFirstProgress": 0,
    "successfulEffects": 0,
    "unsafeActions": 0,
    "actionAttempts": 0,
    "inferenceCalls": 0
  }
}
```

Start with `make-fire-5m`, then add `woodcutting-firemaking-10m`, `starter-fishing-5m`, `combat-prayer-10m`, `explore-report-5m`, and `follow-and-chat-5m`.

## Dashboard Needs

The dashboard should eventually expose:

- resident module id/version/config
- active module facets
- action timeline grouped by module/cause
- benchmark run list and run detail
- module leaderboard by task and seed
- Railgun artifact health: storage mode, run output path, stdout fallback

This can build on existing runtime/action/inference log panels.

## Security Model

Phase 1 is in-process and reviewed only. It supports modules compiled into this repo or explicitly passed by tests. It must not auto-install packages, read arbitrary paths, fetch remote code, or import JS from SOUL/memory. On Railgun, dynamic third-party registries remain disabled; deployable modules must be bundled, reviewed, and pinned by the controller build.

The gateway is part of the security boundary for resident control. Tokenless gateway access is local-development-only and must accept loopback peers only; private network or public bindings require an auth token. Action submission should preserve request ids and final engine results so module decisions can be audited against real game effects.

Later, third-party modules should run as pinned artifacts with manifest review, digest/version identity, resource limits, and narrow capabilities. On Railgun, dynamic code loading should stay disabled until sandboxing and gateway auth are stronger.

## Implementation Slices

Living status for all remaining RuneScape resident work is tracked in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`.

1. **Module seam:** manifest types, strict SOUL declarations, module selection, runtime injection, default registry, standard adapter, module identity logging, action request-id propagation, evidence hardening, tests.
2. **Narrow module facades:** replace trusted raw context with resident-scoped memory, budgeted inference, read-only state, and approved mutation helpers for experimental modules.
3. **Dashboard observability:** expose module id/version in dashboard runtime read model.
4. **Workflow facet:** move starter workflow cards and deterministic starter routines into first-party modules.
5. **Benchmark harness:** add disposable resident run artifacts and first `make-fire-5m` verifier.
6. **Experiment dashboard:** list modules and benchmark runs.

## Expert Review Incorporated

- Architecture review: start with adapters, preserve existing `ThinkingModule`, `ResidentRuntime`, and `GameSkillService` facades.
- Evaluation review: score modules by pass rate, progress, efficiency, safety, reliability, cost, and debug artifact completeness.
- Security review: treat custom modules as untrusted; keep phase 1 data-first and reviewed, with no arbitrary code loading from SOUL or memory.
