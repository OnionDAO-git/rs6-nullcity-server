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

    it('lets the default Spark module emit a visible watchdog fallback action', () => {
        const module = createThinkingModule({
            soul: soul({}),
            state: runtimeState(),
            memory: {} as MemoryStore,
            llm: {} as LlmClient,
        });

        const result = module.onWatchdogTimeout?.({
            resident: {
                position: { x: 3221, y: 3218, level: 0 },
            },
        });

        expect(result).toEqual({
            actions: [
                { kind: 'say', text: 'I am still here; getting my bearings.', cause: 'watchdog_fallback' },
                { kind: 'move_to', target: { x: 3222, y: 3218, level: 0 }, cause: 'watchdog_fallback' },
            ],
            cause: 'watchdog_fallback',
            nooped: false,
        });
    });

    it('personalizes default Spark watchdog fallback for anchored heroes', () => {
        const module = createThinkingModule({
            soul: soul({
                heroProfile: {
                    tier: 'hero',
                    publicName: 'Hans',
                    signatureAction: 'asks how long someone has been around',
                    anchor: [3221, 3218, 0],
                },
            }),
            state: runtimeState(),
            memory: {} as MemoryStore,
            llm: {} as LlmClient,
        });

        const result = module.onWatchdogTimeout?.({
            resident: {
                position: { x: 3200, y: 3200, level: 0 },
            },
        });

        expect(result).toEqual({
            actions: [
                { kind: 'say', text: 'Still here as Hans; getting my bearings near my post.', cause: 'watchdog_fallback' },
                { kind: 'move_to', target: { x: 3222, y: 3218, level: 0 }, range: 1, cause: 'watchdog_fallback' },
            ],
            cause: 'watchdog_fallback',
            nooped: false,
        });
    });

    it('personalizes default Spark watchdog fallback speech for named residents without anchors', () => {
        const module = createThinkingModule({
            soul: soul({ display: 'Pip' }),
            state: runtimeState(),
            memory: {} as MemoryStore,
            llm: {} as LlmClient,
        });

        const result = module.onWatchdogTimeout?.({
            resident: {
                position: { x: 3235, y: 3233, level: 0 },
            },
        });

        expect(result).toEqual({
            actions: [
                { kind: 'say', text: 'Still here as Pip; getting my bearings.', cause: 'watchdog_fallback' },
                { kind: 'move_to', target: { x: 3236, y: 3233, level: 0 }, cause: 'watchdog_fallback' },
            ],
            cause: 'watchdog_fallback',
            nooped: false,
        });
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
