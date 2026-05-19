import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import { Spark } from './spark';

describe('Spark budget handling', () => {
    it('returns a budget_exhausted synthetic event when inference admission is denied', async () => {
        const now = new Date().toISOString();
        const state: RuntimeState = {
            resident: 'res:test',
            attention: 100,
            tick: 0,
            legacy: { kind: 'mentor', progress: {}, complete: false },
            budgets: {
                minuteStartedAt: now,
                dayStartedAt: now,
                requestsThisMinute: 0,
                requestsToday: 0,
                lastTick: 1,
                requestsThisTick: 1,
            },
            variables: {},
            hookCooldowns: {},
            shadowedHooks: [],
        };
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-budget-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
        } as unknown as MemoryStore;
        const llm = { complete: jest.fn() } as unknown as LlmClient;
        const spark = new Spark(soul(), state, memory, llm);

        const result = await spark.tick({});

        expect(result).toMatchObject({
            actions: [],
            cause: 'budget_exhausted:tick',
            nooped: true,
            syntheticEvents: [{ kind: 'budget_exhausted', window: 'tick', tick: 1 }],
        });
        expect(llm.complete).not.toHaveBeenCalled();
    });
});

function soul(): Soul {
    return {
        sourcePath: 'test.md',
        body: '',
        frontmatter: {
            name: 'res:test',
            archetype: 'mentor',
            hooks: [{ id: 'always', priority: 50, condition: { kind: 'always' } }],
            attentionProfile: { decayCurve: 'standard', startingAttention: 100 },
        },
    };
}
