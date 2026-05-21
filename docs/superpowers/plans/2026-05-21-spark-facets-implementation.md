# SPARK Facet Runtime Foundation Implementation Plan

> **Status:** Completed 2026-05-21 on `codex/body-waiter-coordinator`. Post-review fixes preserved kernel-first nervous safety, tagged module nervous reactions, deduped source module shutdown, and removed the trusted context from the public SPARK barrel. Keep this as implementation evidence and historical handoff for the facet foundation slice. The next active work is safe facades A2-A5 and autonomous benchmark mode.

> **For agentic workers:** Historical checklist only. Do not execute this plan again unless explicitly reopening the completed facet foundation slice.

**Goal:** Make SPARK own runtime facet construction for the current Thinking and Nervous layers without changing `res:agent` gameplay behavior.

**Architecture:** Add a compatibility facet resolver under `src/controller/spark/` that resolves the selected SOUL module stack once, builds the thinking facet, composes kernel nervous behavior before module nervous extensions, and returns module identities for logs. `ResidentRuntime` should consume this bundle instead of directly creating thinking and nervous systems separately.

**Tech Stack:** TypeScript, Jest, existing `ResidentRuntime`, `NervousSystem`, `ThinkingModule`, SPARK module registry, no dynamic imports.

---

## File Structure

- Modify `src/controller/spark/modules.ts`: add `SparkNervousSystem`, `createNervousSystem?`, and capability validation.
- Create `src/controller/spark/runtime-facets.ts`: build runtime facet bundle from SOUL, state, memory, LLM, and available modules.
- Create `src/controller/spark/runtime-facets.test.ts`: selection and fallback tests.
- Modify `src/controller/spark/standard-modules.ts`: standard module creates current hybrid thinking and current nervous system.
- Modify `src/controller/spark/standard-modules.test.ts`: assert standard module exposes thinking and nervous compatibility facets.
- Modify `src/controller/resident-runtime.ts`: consume runtime facet bundle and log module identity for nervous actions.
- Modify `src/controller/resident-runtime.test.ts`: module-provided nervous reaction metadata test.
- Modify `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`: mark A1 in progress/done with evidence when implementation verifies.

## Task 1: Extend Module Contract For Nervous Compatibility Facet

**Files:**
- Modify: `src/controller/spark/modules.ts`
- Test: `src/controller/spark/modules.test.ts`

- [x] **Step 1: Write failing capability validation test**

Add this test to `src/controller/spark/modules.test.ts`:

```ts
it('throws when a nervous factory is not declared in capabilities', () => {
    expect(() =>
        resolveSparkModules(
            [{ id: 'onion.alpha' }],
            [
                {
                    ...alpha,
                    manifest: { ...alpha.manifest, capabilities: ['thinking'] },
                    createNervousSystem: jest.fn(),
                },
            ],
        ),
    ).toThrow('SPARK module onion.alpha exposes nervous rules without declaring the nervous-rules capability');
});
```

- [x] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- --runInBand src/controller/spark/modules.test.ts
```

Expected: TypeScript/Jest failure because `createNervousSystem` is not part of `SparkModule`.

- [x] **Step 3: Add compatibility nervous interface**

In `src/controller/spark/modules.ts`, add imports:

```ts
import type { NervousReaction } from '../nervous-system/rules';
import type { Perception } from '../transport/message-codecs';
```

Add:

```ts
export interface SparkNervousSystem {
    react(perception: Perception): NervousReaction | undefined;
}
```

Extend `SparkModule`:

```ts
createNervousSystem?(context: TrustedSparkModuleContext): SparkNervousSystem | undefined;
```

In `validateUniqueRegistry`, add:

```ts
if (module.createNervousSystem && !module.manifest.capabilities.includes('nervous-rules')) {
    throw new Error(`SPARK module ${module.manifest.id} exposes nervous rules without declaring the nervous-rules capability`);
}
```

- [x] **Step 4: Run test to verify pass**

Run:

```bash
npm test -- --runInBand src/controller/spark/modules.test.ts
```

Expected: PASS.

## Task 2: Add Runtime Facet Resolver

**Files:**
- Create: `src/controller/spark/runtime-facets.ts`
- Test: `src/controller/spark/runtime-facets.test.ts`
- Modify: `src/controller/thinking/thinking-module.ts`

- [x] **Step 1: Write failing resolver tests**

Create `src/controller/spark/runtime-facets.test.ts` with tests for:

```ts
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { ThinkingModule } from '../thinking';
import type { SparkModule } from './modules';
import { createSparkRuntimeFacets } from './runtime-facets';

describe('createSparkRuntimeFacets', () => {
    it('selects thinking and nervous facets from the selected module', () => {
        const thinking = thinkingModule();
        const nervous = { react: jest.fn(() => undefined) };
        const facets = createSparkRuntimeFacets({
            soul: soul({ modules: [{ id: 'onion.standard' }] }),
            state: runtimeState(),
            memory: memory(),
            llm: {} as LlmClient,
            sparkModules: [module('onion.standard', { thinking, nervous })],
        });

        expect(facets.thinking).toBe(thinking);
        expect(facets.nervousSystem).toBe(nervous);
        expect(facets.thinkingSparkModule).toEqual({ id: 'onion.standard', version: '0.1.0' });
        expect(facets.nervousSparkModule).toEqual({ id: 'onion.standard', version: '0.1.0' });
    });

    it('falls back to core nervous system when the selected module has no nervous facet', () => {
        const facets = createSparkRuntimeFacets({
            soul: soul({ modules: [{ id: 'onion.thinking' }] }),
            state: runtimeState(),
            memory: memory(),
            llm: {} as LlmClient,
            sparkModules: [module('onion.thinking', { thinking: thinkingModule() })],
        });

        expect(facets.nervousSparkModule).toBeUndefined();
        expect(facets.nervousSystem.react).toEqual(expect.any(Function));
    });

    it('still errors when an explicit module stack has no thinking provider', () => {
        expect(() =>
            createSparkRuntimeFacets({
                soul: soul({ modules: [{ id: 'onion.nervous' }] }),
                state: runtimeState(),
                memory: memory(),
                llm: {} as LlmClient,
                sparkModules: [module('onion.nervous', { nervous: { react: jest.fn(() => undefined) } })],
            }),
        ).toThrow('Selected SPARK module stack does not provide a thinking module');
    });
});
```

Use local helper functions in the test file for `soul`, `runtimeState`, `memory`, `thinkingModule`, and `module`, mirroring the style in existing SPARK tests.

- [x] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- --runInBand src/controller/spark/runtime-facets.test.ts
```

Expected: FAIL because `runtime-facets.ts` does not exist.

- [x] **Step 3: Implement resolver**

Create `src/controller/spark/runtime-facets.ts` with:

```ts
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import { NervousSystem } from '../nervous-system';
import type { Soul } from '../soul/soul-schema';
import { createThinkingModuleSelection, type ThinkingModule } from '../thinking';
import type { SparkModule, SparkModuleIdentity, SparkNervousSystem } from './modules';
import { resolveSparkModules, sparkModuleIdentity } from './modules';

export interface SparkRuntimeFacetOptions {
    soul: Soul;
    state: RuntimeState;
    memory: MemoryStore;
    llm: LlmClient;
    sparkModules?: SparkModule[];
}

export interface SparkRuntimeFacets {
    thinking: ThinkingModule;
    thinkingSparkModule?: SparkModuleIdentity;
    thinkingSourceModule?: SparkModule;
    nervousSystem: SparkNervousSystem;
    nervousSparkModule?: SparkModuleIdentity;
    nervousSourceModule?: SparkModule;
}

export function createSparkRuntimeFacets(options: SparkRuntimeFacetOptions): SparkRuntimeFacets {
    const thinkingSelection = createThinkingModuleSelection(options);
    const nervousSelection = createNervousSelection(options);
    return {
        thinking: thinkingSelection.thinking,
        thinkingSparkModule: thinkingSelection.sparkModule,
        thinkingSourceModule: thinkingSelection.sourceModule,
        nervousSystem: nervousSelection.nervousSystem,
        nervousSparkModule: nervousSelection.sparkModule,
        nervousSourceModule: nervousSelection.sourceModule,
    };
}

function createNervousSelection(options: SparkRuntimeFacetOptions): {
    nervousSystem: SparkNervousSystem;
    sparkModule?: SparkModuleIdentity;
    sourceModule?: SparkModule;
} {
    const selectedModules = resolveSparkModules(options.soul.frontmatter.modules, options.sparkModules || []);
    for (const selected of selectedModules) {
        const nervousSystem = selected.module.createNervousSystem?.({
            soul: options.soul,
            state: options.state,
            memory: options.memory,
            llm: options.llm,
            config: selected.config,
        });
        if (nervousSystem) {
            return {
                nervousSystem,
                sparkModule: sparkModuleIdentity(selected.module.manifest),
                sourceModule: selected.module,
            };
        }
    }
    return { nervousSystem: new NervousSystem({ soul: options.soul, state: options.state, memory: options.memory }) };
}
```

- [x] **Step 4: Run resolver tests**

Run:

```bash
npm test -- --runInBand src/controller/spark/runtime-facets.test.ts src/controller/thinking/thinking-module.test.ts
```

Expected: PASS.

## Task 3: Standard Module Owns Current Nervous Facet

**Files:**
- Modify: `src/controller/spark/standard-modules.ts`
- Modify: `src/controller/spark/standard-modules.test.ts`

- [x] **Step 1: Write failing standard module test**

Add assertions to `standard-modules.test.ts`:

```ts
it('adapts the current nervous system as a SPARK nervous facet', () => {
    const standard = standardSparkModules().find(module => module.manifest.id === RUNESCAPE_STANDARD_SPARK_MODULE_ID);

    const nervous = standard?.createNervousSystem?.({
        soul: soul(),
        state: runtimeState(),
        memory: { ensureResident: jest.fn(() => '/tmp/res-test') } as unknown as MemoryStore,
        llm: {} as LlmClient,
        config: {},
    });

    expect(standard?.manifest.capabilities).toContain('nervous-rules');
    expect(nervous?.react).toEqual(expect.any(Function));
});
```

- [x] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- --runInBand src/controller/spark/standard-modules.test.ts
```

Expected: FAIL until standard module exposes `createNervousSystem`.

- [x] **Step 3: Implement standard nervous facet**

In `src/controller/spark/standard-modules.ts`, import `NervousSystem` and update the module:

```ts
import { NervousSystem } from '../nervous-system';
```

Set capabilities:

```ts
capabilities: ['thinking', 'nervous-rules'],
```

Add:

```ts
createNervousSystem: context => new NervousSystem(context),
```

- [x] **Step 4: Run test to verify pass**

Run:

```bash
npm test -- --runInBand src/controller/spark/standard-modules.test.ts src/controller/spark/modules.test.ts
```

Expected: PASS.

## Task 4: Runtime Uses Facet Bundle And Logs Nervous Module Identity

**Files:**
- Modify: `src/controller/resident-runtime.ts`
- Modify: `src/controller/resident-runtime.test.ts`

- [x] **Step 1: Write failing runtime metadata test**

Add a test proving a module-provided nervous action carries module metadata:

```ts
it('logs SPARK module identity for module-provided nervous actions', async () => {
    const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-module-nervous-test-'));
    const state = stateFor('res:pip');
    const thinking = thinkingModule();
    const body = {
        observePerception: jest.fn(),
        observeEvent: jest.fn(),
        submit: jest.fn(async () => ({ ok: true })),
    } as unknown as ResidentBody;

    const runtime = new ResidentRuntime({
        soul: soul('res:pip', { modules: [{ id: 'onion.reflex' }] }),
        gateway: {} as GatewayClient,
        memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
        stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
        llm: {} as LlmClient,
        actionLog: {} as ActionLog,
        inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
        body,
        sparkModules: [
            {
                manifest: {
                    id: 'onion.reflex',
                    version: '0.1.0',
                    displayName: 'Reflex',
                    capabilities: ['thinking', 'nervous-rules'],
                    risk: 'reviewed',
                },
                createThinkingModule: () => thinking,
                createNervousSystem: () => ({
                    react: () => ({
                        rule: { id: 'wave-on-hit', priority: 80, condition: { kind: 'always' }, action: { kind: 'say', text: 'Reflex online.' } },
                        action: { kind: 'say', text: 'Reflex online.', cause: 'nervous:wave-on-hit' },
                        suppressThinking: true,
                        interruptThinking: true,
                    }),
                }),
            },
        ],
    });

    await runtime.onPerception({ tick: 1, events: [] });

    expect(body.submit).toHaveBeenCalledWith(
        { kind: 'say', text: 'Reflex online.', cause: 'nervous:wave-on-hit' },
        expect.objectContaining({
            source: 'nervous-system',
            ruleId: 'wave-on-hit',
            sparkModule: { id: 'onion.reflex', version: '0.1.0' },
        }),
    );
    expect(thinking.think).not.toHaveBeenCalled();
});
```

Define or reuse a local `thinkingModule()` helper.

- [x] **Step 2: Run test to verify failure**

Run:

```bash
npm test -- --runInBand src/controller/resident-runtime.test.ts
```

Expected: FAIL because runtime still constructs `NervousSystem` directly and does not log nervous module identity.

- [x] **Step 3: Wire runtime facets**

In `src/controller/resident-runtime.ts`, import:

```ts
import { createSparkRuntimeFacets } from './spark/runtime-facets';
```

Replace direct thinking/nervous construction with the facet bundle when `options.thinking` is not provided. Preserve the injected `options.thinking` path for tests by pairing it with the core nervous fallback.

Store:

```ts
private readonly nervousSparkModule?: SparkModuleIdentity;
private readonly nervousSourceModule?: SparkModule;
```

In nervous action metadata, add:

```ts
sparkModule: this.nervousSparkModule,
```

In `stop`, call `this.nervousSourceModule?.stop?.(cause)` if present.

- [x] **Step 4: Run runtime tests**

Run:

```bash
npm test -- --runInBand src/controller/resident-runtime.test.ts src/controller/spark/runtime-facets.test.ts src/controller/thinking/thinking-module.test.ts
```

Expected: PASS.

## Task 5: Update Roadmap And Verification

**Files:**
- Modify: `docs/superpowers/plans/2026-05-20-runescape-agent-roadmap.md`

- [x] **Step 1: Mark A1 complete and A2/A5 next**

After tests pass, update A1 with evidence:

```md
- `[x]` **A1: Design the safe module context API.**
  - Verified 2026-05-21: faceted design added in `docs/superpowers/specs/2026-05-21-spark-faceted-module-system-design.md`; expert review incorporated architecture/security/gameplay/testing/docs feedback.
```

Add a note under Immediate Recommended Next Slice:

```md
- `[>]` Build SPARK facet runtime foundation, then safe facades A2-A5.
  - Current plan: `docs/superpowers/plans/2026-05-21-spark-facets-implementation.md`.
```

- [x] **Step 2: Run focused verification**

Run:

```bash
npm test -- --runInBand src/controller/spark src/controller/resident-runtime.test.ts src/controller/thinking/thinking-module.test.ts src/controller/nervous-system
npm run typecheck
```

Expected: PASS.

- [x] **Step 3: Run full static gate before claiming implementation complete**

Run:

```bash
npm run lint
npm run format
npm run build
```

Expected: PASS. If `npm run format` reports formatting changes needed, run `npm run format:fix`, inspect the diff, then rerun the static gate.

## Real Verification After This Slice

This slice is mostly architecture plumbing, so "real" gameplay verification should prove behavior did not regress:

```bash
npm run controller:bench -- --task make-fire-5m --module onion.runescape.standard --dry-run
npm run controller:bench -- --task explore-report-5m --module onion.runescape.standard --dry-run
```

If a local gateway is running, also run one scripted smoke:

```bash
npm run controller:bench -- --task make-fire-5m --module onion.runescape.standard
```

Treat that as an engine/action smoke, not proof of autonomous SPARK play. The next plan must add autonomous benchmark mode before module comparisons are meaningful.
