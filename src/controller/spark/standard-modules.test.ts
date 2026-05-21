import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import { HybridAgentThinkingModule } from '../thinking';
import { noopSparkModuleTelemetry } from './module-telemetry';
import { RUNESCAPE_STANDARD_SPARK_MODULE_ID, standardSparkModules } from './standard-modules';

describe('standardSparkModules', () => {
    it('includes the standard RuneScape module', () => {
        expect(standardSparkModules().map(module => module.manifest.id)).toContain(RUNESCAPE_STANDARD_SPARK_MODULE_ID);
    });

    it('adapts the current hybrid agent thinking module', () => {
        const standard = standardSparkModules().find(module => module.manifest.id === RUNESCAPE_STANDARD_SPARK_MODULE_ID);

        const thinking = standard?.createThinkingModule?.({
            soul: soul(),
            state: runtimeState(),
            memory: {} as MemoryStore,
            llm: {} as LlmClient,
            config: {},
            telemetry: noopSparkModuleTelemetry,
        });

        expect(thinking).toBeInstanceOf(HybridAgentThinkingModule);
    });

    it('adapts the current nervous system as a SPARK nervous facet', () => {
        const standard = standardSparkModules().find(module => module.manifest.id === RUNESCAPE_STANDARD_SPARK_MODULE_ID);

        const nervous = standard?.createNervousSystem?.({
            soul: soul(),
            state: runtimeState(),
            memory: { ensureResident: jest.fn(() => '/tmp/res-test') } as unknown as MemoryStore,
            llm: {} as LlmClient,
            config: {},
            telemetry: noopSparkModuleTelemetry,
        });

        expect(standard?.manifest.capabilities).toContain('nervous-rules');
        expect(nervous?.react).toEqual(expect.any(Function));
    });
});

function soul(): Soul {
    return {
        sourcePath: '/tmp/soul.md',
        body: '# Test soul',
        frontmatter: {
            name: 'res:test',
            archetype: 'endurer',
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
            behavior: { kind: 'hybrid-agent' },
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
