import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { ThinkingModule } from '../thinking';
import type { SparkModule, SparkNervousSystem } from './modules';
import { createSparkRuntimeFacets } from './runtime-facets';

describe('createSparkRuntimeFacets', () => {
    it('selects thinking and composes module nervous facets with core safety reflexes', () => {
        const thinking = thinkingModule();
        const nervous: SparkNervousSystem = {
            react: jest.fn(() => ({
                rule: {
                    id: 'module-wave',
                    priority: 50,
                    condition: { kind: 'always' },
                    action: { kind: 'noop' },
                },
                action: { kind: 'noop', cause: 'nervous:module-wave' },
                suppressThinking: true,
                interruptThinking: true,
            })),
        };
        const state = runtimeState();

        const facets = createSparkRuntimeFacets({
            soul: soul({ modules: [{ id: 'onion.standard' }] }),
            state,
            memory: memory(),
            llm: {} as LlmClient,
            sparkModules: [module('onion.standard', { thinking, nervous })],
        });

        expect(facets.thinking).toBe(thinking);
        expect(facets.thinkingSparkModule).toEqual({ id: 'onion.standard', version: '0.1.0' });
        expect(facets.nervousSparkModule).toEqual({ id: 'onion.standard', version: '0.1.0' });

        const lowHealthReaction = facets.nervousSystem.react({
            tick: 1,
            resident: { hp: { current: 2, max: 10 }, inventory: [{ key: 'shrimp', amount: 1 }] },
            events: [],
        });
        expect(lowHealthReaction?.action).toEqual({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low-health' });
        expect(lowHealthReaction?.sparkModule).toBeUndefined();
        expect(nervous.react).not.toHaveBeenCalled();

        const moduleReaction = facets.nervousSystem.react({ tick: 2, resident: { hp: { current: 10, max: 10 } }, events: [] });
        expect(moduleReaction?.action).toEqual({ kind: 'noop', cause: 'nervous:module-wave' });
        expect(moduleReaction?.sparkModule).toEqual({ id: 'onion.standard', version: '0.1.0' });
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

function module(id: string, facets: { thinking?: ThinkingModule; nervous?: SparkNervousSystem }): SparkModule {
    return {
        manifest: {
            id,
            version: '0.1.0',
            displayName: id,
            capabilities: [...(facets.thinking ? (['thinking'] as const) : []), ...(facets.nervous ? (['nervous-rules'] as const) : [])],
            risk: 'reviewed',
        },
        createThinkingModule: facets.thinking ? () => facets.thinking : undefined,
        createNervousSystem: facets.nervous ? () => facets.nervous : undefined,
    };
}

function thinkingModule(): ThinkingModule {
    return {
        think: jest.fn(async () => ({ actions: [], nooped: true })),
        considerInterrupt: jest.fn(() => false),
        stop: jest.fn(),
    };
}

function soul(extra: Partial<Soul['frontmatter']> = {}): Soul {
    return {
        sourcePath: '/tmp/soul.md',
        body: '# Test soul',
        frontmatter: {
            name: 'res:test',
            archetype: 'endurer',
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
            behavior: { kind: 'hybrid-agent' },
            ...extra,
        },
    };
}

function runtimeState(): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:test',
        attention: 100,
        tick: 0,
        legacy: { kind: 'endurer', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

function memory(): MemoryStore {
    return { ensureResident: jest.fn(() => '/tmp/res-test'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore;
}
