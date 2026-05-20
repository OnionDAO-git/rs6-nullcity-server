import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import { Spark } from './spark';

describe('Spark candidate fallback', () => {
    it('uses a safe movement candidate when the LLM only returns noop', async () => {
        const state = runtimeState();
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-candidate-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
        } as unknown as MemoryStore;
        const llm = {
            complete: jest.fn(async () => ({
                text: JSON.stringify({ actions: [{ kind: 'noop' }] }),
                nooped: false,
            })),
        } as unknown as LlmClient;
        const spark = new Spark(soul(), state, memory, llm);

        const result = await spark.tick({
            resident: {
                position: { x: 3226, y: 3236, level: 0 },
            },
        });

        expect(result.actions).toEqual([{ kind: 'move_to', target: { x: 3227, y: 3236, level: 0 }, cause: 'idle_step' }]);
        expect(result.nooped).toBe(false);
    });
});

function runtimeState(): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:test',
        attention: 100,
        tick: 0,
        legacy: { kind: 'mentor', progress: {}, complete: false },
        budgets: {
            minuteStartedAt: now,
            dayStartedAt: now,
            requestsThisMinute: 0,
            requestsToday: 0,
        },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

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
