# SPARK Module System Implementation Plan

> **Status:** Historical/completed first-slice plan. The initial SPARK seam has landed; do not treat unchecked checklist items below as current work. Use `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md` as the source of truth for active tasks and next slices.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first safe SPARK module-system slice so SOUL files can select reviewed in-repo modules and the controller can run different resident intelligence engines with auditable module identity.

**Architecture:** Add a typed module manifest/registry layer, extend SOUL frontmatter with strict data-only module selections, pass modules through `ControllerHost` and `ResidentRuntime`, and let `createThinkingModuleSelection()` use the selected module when a SOUL declares a module stack. Legacy behavior remains available only when `modules` is omitted. `ControllerHost` owns a default first-party registry so production and Railgun startup do not depend on test injection.

**Tech Stack:** TypeScript, Zod, Jest, existing controller runtime, existing `ThinkingModule` interface, no dynamic imports.

---

**Living roadmap:** Broader RuneScape resident build status is tracked in `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`. Update that roadmap when starting, finishing, blocking, or deferring follow-up work.

## File Structure

- Create `src/controller/spark/modules.ts`: module manifests, SOUL module selection helpers, registry utilities, and context types.
- Modify `src/controller/soul/soul-schema.ts`: add `modules?: SoulSparkModuleSelection[]` to frontmatter with Zod validation.
- Modify `src/controller/thinking/thinking-module.ts`: add optional module list to factory options and select a module-provided thinking policy first, returning module identity metadata for runtime logging.
- Modify `src/controller/resident-runtime.ts`: accept `sparkModules?: SparkModule[]` and pass them into `createThinkingModule()`.
- Modify `src/controller/controller-host.ts`: accept `sparkModules?: SparkModule[]`, default to built-in standard modules, and pass to runtimes.
- Create `src/controller/spark/standard-modules.ts`: first-party `onion.runescape.standard` adapter for the current hybrid module.
- Modify action/gateway support: preserve request ids on body submissions and attempts, include module metadata on attempts, filter action-effect evidence by action-relevant state, honor `move_to.range`, and keep tokenless gateway access loopback-only.
- Create/modify tests:
  - `src/controller/spark/modules.test.ts`
  - `src/controller/soul/soul-loader.test.ts` or `src/controller/soul/soul-schema.test.ts`
  - `src/controller/thinking/thinking-module.test.ts`
  - `src/controller/resident-runtime.test.ts`
  - `src/controller/controller-host.test.ts`

## Task 1: Module Types And Selection Helpers

**Files:**
- Create: `src/controller/spark/modules.ts`
- Test: `src/controller/spark/modules.test.ts`

- [ ] **Step 1: Write failing tests for module selection**

Add tests covering enabled selection, disabled selection, unknown module errors, duplicate SOUL module ids, duplicate registry ids, and stable order:

```ts
import { resolveSparkModules, type SparkModule } from './modules';

describe('resolveSparkModules', () => {
    const alpha = module('onion.alpha');
    const beta = module('onion.beta');

    it('resolves enabled soul modules in soul order', () => {
        expect(
            resolveSparkModules(
                [
                    { id: 'onion.beta', enabled: true },
                    { id: 'onion.alpha', enabled: true, config: { mode: 'fast' } },
                ],
                [alpha, beta],
            ).map(entry => ({ id: entry.module.manifest.id, config: entry.config })),
        ).toEqual([
            { id: 'onion.beta', config: {} },
            { id: 'onion.alpha', config: { mode: 'fast' } },
        ]);
    });

    it('ignores disabled modules', () => {
        expect(resolveSparkModules([{ id: 'onion.alpha', enabled: false }], [alpha])).toEqual([]);
    });

    it('throws for unknown enabled modules', () => {
        expect(() => resolveSparkModules([{ id: 'onion.missing' }], [alpha])).toThrow('Unknown SPARK module onion.missing');
    });

    it('throws for duplicate soul module ids', () => {
        expect(() => resolveSparkModules([{ id: 'onion.alpha' }, { id: 'onion.alpha' }], [alpha])).toThrow(
            'Duplicate SPARK module selection onion.alpha',
        );
    });

    it('throws for duplicate registry module ids', () => {
        expect(() => resolveSparkModules([{ id: 'onion.alpha' }], [alpha, module('onion.alpha')])).toThrow(
            'Duplicate SPARK module onion.alpha',
        );
    });
});

function module(id: string): SparkModule {
    return {
        manifest: {
            id,
            version: '0.1.0',
            displayName: id,
            capabilities: ['thinking'],
            risk: 'reviewed',
        },
    };
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runInBand src/controller/spark/modules.test.ts`

Expected: FAIL because `src/controller/spark/modules.ts` does not exist or exports are missing.

- [ ] **Step 3: Implement minimal module helpers**

Create `src/controller/spark/modules.ts` with:

```ts
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { ThinkingModule } from '../thinking/thinking-module';

export type SparkModuleCapability =
    | 'thinking'
    | 'hooks'
    | 'nervous-rules'
    | 'candidates'
    | 'prompt-sections'
    | 'attempt-observer'
    | 'benchmarks';

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

export interface SoulSparkModuleSelection {
    id: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
}

export interface SparkModuleContext {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
    config: Record<string, unknown>;
}

export interface SparkModule {
    manifest: SparkModuleManifest;
    createThinkingModule?(context: SparkModuleContext): ThinkingModule | undefined;
    stop?(cause: string): void;
}

export interface ResolvedSparkModule {
    module: SparkModule;
    config: Record<string, unknown>;
}

export function resolveSparkModules(
    selections: SoulSparkModuleSelection[] | undefined,
    available: SparkModule[],
): ResolvedSparkModule[] {
    if (!selections?.length) {
        return [];
    }
    const byId = new Map(available.map(module => [module.manifest.id, module]));
    return selections
        .filter(selection => selection.enabled !== false)
        .map(selection => {
            const module = byId.get(selection.id);
            if (!module) {
                throw new Error(`Unknown SPARK module ${selection.id}`);
            }
            return { module, config: selection.config || {} };
        });
}
```

Name the context `TrustedSparkModuleContext` in code. Phase 1 modules are reviewed in-repo adapters only. Third-party or unreviewed member modules must wait for a facaded context in a later slice.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runInBand src/controller/spark/modules.test.ts`

Expected: PASS.

## Task 2: SOUL Module Declarations

**Files:**
- Modify: `src/controller/soul/soul-schema.ts`
- Test: `src/controller/soul/soul-schema.test.ts`

- [ ] **Step 1: Write failing tests for frontmatter modules**

Create or extend schema tests:

```ts
import { validateSoulFrontmatter } from './soul-schema';

describe('validateSoulFrontmatter modules', () => {
    it('parses data-only SPARK module selections', () => {
        const frontmatter = validateSoulFrontmatter(
            {
                name: 'res:agent',
                archetype: 'endurer',
                modules: [{ id: 'onion.runescape.standard', config: { followPlayer: 'codex' } }],
            },
            '/tmp/res-agent.md',
        );

        expect(frontmatter.modules).toEqual([{ id: 'onion.runescape.standard', config: { followPlayer: 'codex' } }]);
    });

    it('rejects module selections with executable entrypoints', () => {
        expect(() =>
            validateSoulFrontmatter(
                {
                    name: 'res:agent',
                    archetype: 'endurer',
                    modules: [{ id: 'onion.bad', entrypoint: './hack.js' }],
                },
                '/tmp/res-agent.md',
            ),
        ).toThrow('Invalid soul frontmatter');
    });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand src/controller/soul/soul-schema.test.ts`

Expected: FAIL because `modules` is not validated/exported yet.

- [ ] **Step 3: Add schema and interface fields**

In `src/controller/soul/soul-schema.ts`, import `SoulSparkModuleSelection` as a type from `../spark/modules`, add `modules?: SoulSparkModuleSelection[]` to `SoulFrontmatter`, and add a strict Zod schema:

```ts
const soulSparkModuleSchema = z.object({
    id: z.string().min(1),
    enabled: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
}).strict();
```

Then add `modules: z.array(soulSparkModuleSchema).optional()` to `soulFrontmatterSchema`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- --runInBand src/controller/soul/soul-schema.test.ts src/controller/soul/soul-loader.test.ts`

Expected: PASS.

## Task 3: Thinking Module Factory Uses Selected Modules

**Files:**
- Modify: `src/controller/thinking/thinking-module.ts`
- Modify: `src/controller/thinking/thinking-module.test.ts`

- [ ] **Step 1: Write failing tests for module-provided thinking**

Add tests:

```ts
it('uses the first selected SPARK module that creates a thinking module', () => {
    const custom = fakeThinkingModule();
    const module = createThinkingModule({
        soul: soul({ modules: [{ id: 'onion.custom' }] }),
        state: runtimeState(),
        memory: memory(),
        llm: llm(),
        sparkModules: [
            {
                manifest: {
                    id: 'onion.custom',
                    version: '0.1.0',
                    displayName: 'Custom',
                    capabilities: ['thinking'],
                    risk: 'reviewed',
                },
                createThinkingModule: () => custom,
            },
        ],
    });

    expect(module).toBe(custom);
});

it('falls back to legacy behavior when no SOUL modules are selected', () => {
    const module = createThinkingModule({
        soul: soul({ behavior: { kind: 'hybrid-agent' } }),
        state: runtimeState(),
        memory: memory(),
        llm: llm(),
        sparkModules: [],
    });

    expect(module).toBeInstanceOf(HybridAgentThinkingModule);
});

it('throws when SOUL modules are selected but none provides thinking', () => {
    expect(() =>
        createThinkingModule({
            soul: soul({ modules: [{ id: 'onion.custom' }] }),
            state: runtimeState(),
            memory: memory(),
            llm: llm(),
            sparkModules: [
                {
                    manifest: {
                        id: 'onion.custom',
                        version: '0.1.0',
                        displayName: 'Custom',
                        capabilities: ['prompt-sections'],
                        risk: 'reviewed',
                    },
                },
            ],
        }),
    ).toThrow('does not provide a thinking module');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand src/controller/thinking/thinking-module.test.ts`

Expected: FAIL because `sparkModules` is not accepted and SOUL modules are ignored.

- [ ] **Step 3: Add module selection to factory**

Extend options:

```ts
import { resolveSparkModules, type SparkModule } from '../spark/modules';

export interface SparkThinkingModuleOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
    sparkModules?: SparkModule[];
}
```

Add `createThinkingModuleSelection()` and keep `createThinkingModule()` as a compatibility wrapper. At the start of module selection:

```ts
const selectedModules = resolveSparkModules(options.soul.frontmatter.modules, options.sparkModules || []);
for (const selected of selectedModules) {
    const thinking = selected.module.createThinkingModule?.({
        soul: options.soul,
        state: options.state,
        memory: options.memory,
        llm: options.llm,
        config: selected.config,
    });
    if (thinking) {
        return { thinking, sparkModule: selected.module.manifest };
    }
}
```

If `options.soul.frontmatter.modules` is present but no selected module provides thinking, throw. Leave legacy behavior after this block only when `modules` is omitted.

- [ ] **Step 4: Run tests**

Run: `npm test -- --runInBand src/controller/thinking/thinking-module.test.ts src/controller/spark/modules.test.ts`

Expected: PASS.

## Task 4: Runtime And Host Injection

**Files:**
- Modify: `src/controller/resident-runtime.ts`
- Modify: `src/controller/resident-runtime.test.ts`
- Modify: `src/controller/controller-host.ts`
- Modify: `src/controller/controller-host.test.ts`

- [ ] **Step 1: Write failing runtime/host tests**

Add a `ResidentRuntime` test that creates a SOUL with `modules: [{ id: 'onion.custom' }]`, passes `sparkModules`, calls `onPerception()`, and asserts the custom thinking module emitted a no-wait action such as `noop`. Also assert inference log and action metadata include the module id/version.

Add a `ControllerHost` test that passes `sparkModules` and verifies the runtime factory receives them. Add another test that omits `sparkModules` and verifies the default registry includes `onion.runescape.standard`.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- --runInBand src/controller/resident-runtime.test.ts src/controller/controller-host.test.ts`

Expected: FAIL because options are not threaded through.

- [ ] **Step 3: Pass modules through**

Add `sparkModules?: SparkModule[]` to `ResidentRuntimeOptions` and pass it to `createThinkingModuleSelection()`. Store the selected module identity on the runtime and write it to inference entries and body action metadata.

Add `sparkModules?: SparkModule[]` to `ControllerHostOptions`, default to `standardSparkModules()`, and pass it into `new ResidentRuntime({ ... })`.

Preserve module metadata on `ActionAttempt` so blocked or no-submit attempts still keep `sparkModule` id/version. Preserve gateway request ids on body submit results. For movement evidence, honor `move_to.range`. For item/action effect evidence, ignore unrelated position churn and only count action-relevant state or action-relevant non-chat messages.

- [ ] **Step 4: Run tests**

Run: `npm test -- --runInBand src/controller/resident-runtime.test.ts src/controller/controller-host.test.ts src/controller/thinking/thinking-module.test.ts`

Expected: PASS.

## Task 5: Standard Module Adapter And Starter SOUL Wiring

**Files:**
- Create: `src/controller/spark/standard-modules.ts`
- Modify: `src/controller/spark/index.ts` if present or `src/controller/thinking/index.ts`
- Modify: `src/controller/soul/starter-souls/res-agent.md`
- Test: `src/controller/spark/standard-modules.test.ts`

- [ ] **Step 1: Write failing tests for built-in standard module metadata**

Test that `standardSparkModules()` returns `onion.runescape.standard` and that the module creates a `HybridAgentThinkingModule`.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- --runInBand src/controller/spark/standard-modules.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement adapter**

Create a first-party module whose manifest is reviewed/core and whose factory returns `HybridAgentThinkingModule`.

- [ ] **Step 4: Wire starter SOUL**

Add:

```yaml
modules:
  - id: onion.runescape.standard
    enabled: true
```

Keep legacy `behavior.kind: hybrid-agent` until later slices remove the dependency.

- [ ] **Step 5: Run tests**

Run: `npm test -- --runInBand src/controller/spark src/controller/thinking src/controller/soul`

Expected: PASS.

## Task 6: Verification And Review

**Files:**
- No new files unless review finds issues.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm run lint
npm run build
npm test -- --runInBand
```

Expected: all commands exit 0.

- [ ] **Step 2: Request code review**

Dispatch a reviewer with:

- Description: "Added first SPARK module-system seam: manifests, SOUL module selections, thinking-module selection, runtime/host injection, and standard module adapter."
- Requirements: this plan plus `docs/superpowers/specs/2026-05-20-spark-module-system-design.md`.
- Scope: changed files from Tasks 1-5.

- [ ] **Step 3: Fix review issues and rerun verification**

Important or critical findings must be fixed before moving on.

## Task 7: First Experiment

**Files:**
- No required code files; use existing runtime tests or live controller if available.

- [ ] **Step 1: Run a module-selection smoke test**

Run the focused tests from Tasks 3-5 and inspect output.

- [ ] **Step 2: Optional live smoke when local server is up**

Start/restart the controller and verify startup logs include the selected module id/version for `res:agent`. If logs are not yet implemented, record this as the next observability task rather than blocking this slice.

## Self-Review

- Spec coverage: Tasks 1-5 implement the first safe module seam, SOUL selection, runtime injection, and standard module adapter. Benchmark/dashboard facets are intentionally later slices.
- Placeholder scan: no implementation step depends on an undefined "TBD" behavior.
- Type consistency: `SparkModule`, `SoulSparkModuleSelection`, `sparkModules`, and `resolveSparkModules()` names are consistent across tasks.
