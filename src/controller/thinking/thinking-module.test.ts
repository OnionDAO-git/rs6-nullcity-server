import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import type { SparkModule } from '../spark/modules';
import { BasicAgentThinkingModule } from './basic-agent-thinking-module';
import { HybridAgentThinkingModule } from './hybrid-agent-thinking-module';
import { createThinkingModule, createThinkingModuleSelection, SparkThinkingModule, type ThinkingModule } from './thinking-module';

describe('createThinkingModule', () => {
    it('uses the basic agent module for opted-in souls', () => {
        const module = createThinkingModule({
            soul: soul({ behavior: { kind: 'basic-agent', followPlayer: 'codex' } }),
            state: runtimeState(),
            memory: {} as MemoryStore,
            llm: {} as LlmClient,
        });

        expect(module).toBeInstanceOf(BasicAgentThinkingModule);
    });

    it('uses the hybrid Brain/Body module for hybrid-agent souls', () => {
        const module = createThinkingModule({
            soul: soul({ behavior: { kind: 'hybrid-agent', followPlayer: 'codex' } }),
            state: runtimeState(),
            memory: {} as MemoryStore,
            llm: {} as LlmClient,
        });

        expect(module).toBeInstanceOf(HybridAgentThinkingModule);
    });

    it('keeps Spark as the default thinking module', () => {
        const module = createThinkingModule({
            soul: soul({}),
            state: runtimeState(),
            memory: {} as MemoryStore,
            llm: {} as LlmClient,
        });

        expect(module).toBeInstanceOf(SparkThinkingModule);
    });

    it('uses the first selected SPARK module that creates a thinking module', () => {
        const custom = fakeThinkingModule();

        const selection = createThinkingModuleSelection({
            soul: soul({ modules: [{ id: 'onion.custom' }] }),
            state: runtimeState(),
            memory: {} as MemoryStore,
            llm: {} as LlmClient,
            sparkModules: [sparkModule('onion.custom', custom)],
        });

        expect(selection.thinking).toBe(custom);
        expect(selection.sparkModule).toEqual({ id: 'onion.custom', version: '0.1.0' });
    });

    it('throws when a selected SPARK module does not provide thinking', () => {
        expect(() =>
            createThinkingModule({
                soul: soul({ modules: [{ id: 'onion.custom' }] }),
                state: runtimeState(),
                memory: {} as MemoryStore,
                llm: {} as LlmClient,
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
        ).toThrow('Selected SPARK module stack does not provide a thinking module');
    });
});

function soul(extra: Partial<Soul['frontmatter']>): Soul {
    return {
        sourcePath: '/tmp/soul.md',
        body: '# Test soul',
        frontmatter: {
            name: 'res:test',
            archetype: 'mentor',
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
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
        legacy: { kind: 'mentor', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

function fakeThinkingModule(): ThinkingModule {
    return {
        think: jest.fn(async () => ({ actions: [], nooped: true })),
        considerInterrupt: jest.fn(() => false),
        stop: jest.fn(),
    };
}

function sparkModule(id: string, thinking: ThinkingModule): SparkModule {
    return {
        manifest: {
            id,
            version: '0.1.0',
            displayName: id,
            capabilities: ['thinking'],
            risk: 'reviewed',
        },
        createThinkingModule: () => thinking,
    };
}
