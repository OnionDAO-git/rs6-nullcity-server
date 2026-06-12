import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import { Spark } from './spark';

// Survivable-weekend decay schedule: Spark.tick is the second per-tick
// decay site (the first is ResidentRuntime.handlePerception). Both must
// scale the per-tick spend by decayScheduleMultiplier, driven by an
// injected clock so tests control "now".
describe('Spark decay schedule', () => {
    // Sat 2026-06-13 23:00 CDT — weekend night → min(0.5, 0.25) = 0.25.
    const weekendNight = Date.parse('2026-06-14T04:00:00Z');

    function stateWithExhaustedTickBudget(): RuntimeState {
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
                lastTick: 1,
                requestsThisTick: 1,
            },
            variables: {},
            hookCooldowns: {},
            shadowedHooks: [],
        };
    }

    function makeSpark(state: RuntimeState, sparkOptions?: ConstructorParameters<typeof Spark>[4]): Spark {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-decay-schedule-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
        } as unknown as MemoryStore;
        const llm = { complete: jest.fn() } as unknown as LlmClient;
        return new Spark(soul(), state, memory, llm, sparkOptions);
    }

    it('decays at the full rate when no schedule is configured (backward compatible)', async () => {
        const state = stateWithExhaustedTickBudget();
        const spark = makeSpark(state);

        await spark.tick({});

        expect(state.attention).toBe(99);
    });

    it('scales the per-tick decay by the schedule multiplier using the injected clock', async () => {
        const state = stateWithExhaustedTickBudget();
        const spark = makeSpark(state, {
            attentionDecaySchedule: { timezone: 'America/Chicago' },
            now: () => weekendNight,
        });

        await spark.tick({});

        // standard curve is 1/tick; weekend-night multiplier 0.25 → -0.25.
        expect(state.attention).toBe(99.75);
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
