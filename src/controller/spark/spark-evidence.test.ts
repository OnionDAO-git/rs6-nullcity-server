import fs from 'fs';
import os from 'os';
import path from 'path';
import { EvidenceStore, TrajectoryBuilder } from '../evidence';
import type { LlmClient } from '../llm/llm-client';
import type { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import { Spark } from './spark';

describe('Spark evidence integration', () => {
    it('records begin, hook, budget, and end_tick for budget exhaustion', async () => {
        const state = runtimeState();
        state.budgets.lastTick = 1;
        state.budgets.requestsThisTick = 1;
        const { builder, trajectoryPath } = evidence();
        const llm = { complete: jest.fn() } as unknown as LlmClient;
        const spark = new Spark(soul(), state, memory(), llm, { evidence: builder });

        await spark.tick({ tick: 99 });

        expect(readKinds(trajectoryPath)).toEqual(['begin_tick', 'hook', 'budget', 'end_tick']);
        expect(readJsonl(trajectoryPath)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ kind: 'begin_tick', tick: 1, perceptionHash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
                expect.objectContaining({ kind: 'hook', winnerId: 'always', priority: 50 }),
                expect.objectContaining({ kind: 'budget', ok: false, window: 'tick' }),
                expect.objectContaining({ kind: 'end_tick', reason: 'budget_exhausted:tick' }),
            ]),
        );
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('records decision and action lines for a normal inference tick', async () => {
        const { builder, trajectoryPath } = evidence();
        const llm = {
            complete: jest.fn(async () => ({
                text: JSON.stringify({ cause: 'chat_reply', actions: [{ kind: 'say', text: 'I am awake.' }] }),
                nooped: false,
            })),
        } as unknown as LlmClient;
        const spark = new Spark(soul(), runtimeState(), memory(), llm, { evidence: builder });

        await spark.tick({ tick: 1, events: [{ kind: 'chat', text: 'hello' }] });

        expect(readKinds(trajectoryPath)).toEqual(['begin_tick', 'hook', 'decision', 'say', 'end_tick']);
        expect(readJsonl(trajectoryPath)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    kind: 'decision',
                    cause: 'chat_reply',
                    promptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                    completionHash: expect.stringMatching(/^[a-f0-9]{64}$/),
                    actionKinds: ['say'],
                }),
                expect.objectContaining({
                    kind: 'say',
                    requestId: 'spark:1:1',
                    actionKind: 'say',
                    text: 'I am awake.',
                }),
                expect.objectContaining({ kind: 'end_tick', reason: 'tick_complete' }),
            ]),
        );
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

function memory(): MemoryStore {
    const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-evidence-memory-'));
    return {
        ensureResident: jest.fn(() => memoryDir),
        retrieve: jest.fn(() => []),
        write: jest.fn(),
        upsertIndexPatch: jest.fn(),
    } as unknown as MemoryStore;
}

function evidence(): { builder: TrajectoryBuilder; trajectoryPath: string } {
    const store = new EvidenceStore('res:test', fs.mkdtempSync(path.join(os.tmpdir(), 'spark-evidence-')), {
        now: () => new Date('2026-05-21T08:45:00.000Z'),
    });
    const session = store.beginSession('session-a', 'soul-v1');
    return {
        builder: new TrajectoryBuilder(store, { now: () => new Date('2026-05-21T08:45:01.000Z') }),
        trajectoryPath: session.trajectoryPath,
    };
}

function readKinds(filePath: string): string[] {
    return readJsonl(filePath).map((line: { kind: string }) => line.kind);
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
    return fs
        .readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}
