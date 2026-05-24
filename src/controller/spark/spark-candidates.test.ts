import fs from 'fs';
import os from 'os';
import path from 'path';
import type { LlmClient } from '../llm/llm-client';
import { MemoryStore } from '../memory/memory-store';
import type { RuntimeState } from '../memory/runtime-state';
import type { Soul } from '../soul/soul-schema';
import { Spark } from './spark';

describe('Spark candidate fallback', () => {
    it('emits a low-cadence idle pulse for named residents when no hook wins', async () => {
        const state = runtimeState();
        state.tick = 119;
        state.hookCooldowns = { idle_reflection: 99999, new_actor_or_chunk: 99999 };
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-idle-initiative-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
        } as unknown as MemoryStore;
        const llm = { complete: jest.fn() } as unknown as LlmClient;
        const spark = new Spark(soul({ hooks: [], display: 'Thrand' }), state, memory, llm);

        const result = await spark.tick({
            resident: {
                position: { x: 3235, y: 3233, level: 0 },
            },
        });

        expect(result).toEqual({
            actions: [
                { kind: 'say', text: 'Still here as Thrand; watching the area.', cause: 'idle_initiative' },
                { kind: 'move_to', target: { x: 3236, y: 3233, level: 0 }, cause: 'idle_initiative' },
            ],
            cause: 'idle_initiative',
            nooped: false,
        });
        expect(state.lastIdleInitiativeTick).toBe(120);
        expect(llm.complete).not.toHaveBeenCalled();

        const nextTick = await spark.tick({
            resident: {
                position: { x: 3236, y: 3233, level: 0 },
            },
        });

        expect(nextTick).toEqual({ actions: [], cause: 'hook_noop', nooped: true });
        expect(state.lastIdleInitiativeTick).toBe(120);
        expect(llm.complete).not.toHaveBeenCalled();
    });

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

    it('includes recent Library memories in the legacy SPARK prompt envelope', async () => {
        const state = runtimeState();
        const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-library-memory-'));
        const timelineDir = path.join(memoryRoot, 'library', 'res-test');
        fs.mkdirSync(timelineDir, { recursive: true });
        fs.writeFileSync(
            path.join(timelineDir, 'timeline.jsonl'),
            JSON.stringify({
                kind: 'patron_gift',
                patronHandle: 'alice@onion',
                artifact: 'rs:tinderbox',
                ts: '2026-05-22T10:00:00.000Z',
            }) + '\n',
        );
        const memory = new MemoryStore(memoryRoot, '');
        const llm = {
            complete: jest.fn(async () => ({
                text: JSON.stringify({ actions: [{ kind: 'noop' }] }),
                nooped: false,
            })),
        } as unknown as LlmClient;
        const spark = new Spark(soul(), state, memory, llm);

        await spark.tick({
            resident: {
                position: { x: 3226, y: 3236, level: 0 },
            },
        });

        const prompt = (llm.complete as jest.Mock).mock.calls[0][0].prompt;
        expect(prompt).toContain('Patron gift from alice@onion: rs:tinderbox');
        fs.rmSync(memoryRoot, { recursive: true, force: true });
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

function soul(extra: Partial<Soul['frontmatter']> = {}): Soul {
    return {
        sourcePath: 'test.md',
        body: '',
        frontmatter: {
            name: 'res:test',
            archetype: 'mentor',
            hooks: [{ id: 'always', priority: 50, condition: { kind: 'always' } }],
            attentionProfile: { decayCurve: 'standard', startingAttention: 100 },
            ...extra,
        },
    };
}
