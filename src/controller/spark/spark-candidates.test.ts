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

    it('uses faction landmark work for standard-SPARK flagship heroes during idle initiative', async () => {
        const state = runtimeState();
        state.tick = 119;
        state.hookCooldowns = { idle_reflection: 99999, new_actor_or_chunk: 99999 };
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-faction-idle-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
        } as unknown as MemoryStore;
        const llm = { complete: jest.fn() } as unknown as LlmClient;
        const tree = { objectId: 1278, position: { x: 3017, y: 3357, level: 0 }, orientation: 0 };
        const spark = new Spark(
            soul({
                name: 'res:mother-anvil',
                display: 'Mother Anvil',
                archetype: 'achiever',
                hooks: [],
                factionId: 'foundry',
                heroProfile: {
                    tier: 'hero',
                    publicName: 'Mother Anvil',
                    signatureAction: 'works the forge',
                    anchor: [3015, 3357, 0],
                },
            }),
            state,
            memory,
            llm,
        );

        const result = await spark.tick({
            resident: {
                id: 'resident:res:mother-anvil',
                position: { x: 3015, y: 3357, level: 0 },
                inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
            },
            nearby: { objects: [tree] },
        });

        expect(result).toEqual({
            actions: [
                { kind: 'say', text: 'Still here as Mother Anvil; watching the area.', cause: 'idle_initiative' },
                { kind: 'move_to', target: tree.position, range: 1, cause: 'faction_foundry_fuel_work' },
            ],
            cause: 'idle_initiative',
            nooped: false,
        });
        expect(Object.keys(state.cognition?.explorationCooldowns || {})).toContain('patrol:3017,3357,0');
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('does not divert non-hero faction residents into landmark work', async () => {
        const state = runtimeState();
        state.tick = 119;
        state.hookCooldowns = { idle_reflection: 99999, new_actor_or_chunk: 99999 };
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-faction-nonhero-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
        } as unknown as MemoryStore;
        const llm = { complete: jest.fn() } as unknown as LlmClient;
        const tree = { objectId: 1278, position: { x: 3017, y: 3357, level: 0 }, orientation: 0 };
        const spark = new Spark(
            soul({
                name: 'res:foundry-novice',
                display: 'Foundry Novice',
                hooks: [],
                factionId: 'foundry',
                heroProfile: {
                    tier: 'novice',
                    publicName: 'Foundry Novice',
                    signatureAction: 'keeps the bellows tidy',
                    anchor: [3015, 3357, 0],
                },
            }),
            state,
            memory,
            llm,
        );

        const result = await spark.tick({
            resident: {
                id: 'resident:res:foundry-novice',
                position: { x: 3015, y: 3357, level: 0 },
                inventory: [{ itemId: 1351, key: 'rs:bronze_axe', amount: 1 }],
            },
            nearby: { objects: [tree] },
        });

        expect(result).toEqual({
            actions: [
                { kind: 'say', text: 'Still here as Foundry Novice; watching the area.', cause: 'idle_initiative' },
                { kind: 'move_to', target: { x: 3016, y: 3357, level: 0 }, range: 1, cause: 'idle_initiative' },
            ],
            cause: 'idle_initiative',
            nooped: false,
        });
        expect(state.cognition?.explorationCooldowns).toBeUndefined();
        expect(llm.complete).not.toHaveBeenCalled();
    });

    it('charges watchdog attention once when faction landmark fallback itself speaks', () => {
        const state = runtimeState();
        state.tick = 200;
        state.attention = 100;
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-faction-watchdog-say-'));
        const memory = {
            ensureResident: jest.fn(() => memoryDir),
            retrieve: jest.fn(() => []),
            write: jest.fn(),
        } as unknown as MemoryStore;
        const llm = { complete: jest.fn() } as unknown as LlmClient;
        const spark = new Spark(
            soul({
                name: 'res:severn-vesta',
                display: 'Severn Vesta',
                hooks: [],
                factionId: 'bureau-of-continuity',
                heroProfile: {
                    tier: 'hero',
                    publicName: 'Severn Vesta',
                    signatureAction: 'records the names of the dead',
                    anchor: [3222, 3218, 0],
                },
            }),
            state,
            memory,
            llm,
        );

        const result = spark.watchdogFallback({
            resident: {
                id: 'resident:res:severn-vesta',
                position: { x: 3222, y: 3218, level: 0 },
                inventory: [],
            },
            nearby: {},
        });

        expect(result.actions).toEqual([
            {
                kind: 'say',
                text: 'The Bureau is keeping the record. Bring bones, names, or a story and I will witness it.',
                cause: 'faction_bureau_witness_work',
            },
        ]);
        expect(state.attention).toBe(99.5);
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
        expect(result.cause).toBe('candidate_fallback');
        expect(result.nooped).toBe(false);
        expect((llm.complete as jest.Mock).mock.calls[0][0].timeoutMs).toBe(10_000);
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

    it('passes thinking option from soul model config to llm.complete', async () => {
        const state = runtimeState();
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-thinking-'));
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
        const spark = new Spark(
            soul({
                model: {
                    thinking: false,
                },
            }),
            state,
            memory,
            llm,
        );

        await spark.tick({
            resident: {
                position: { x: 3226, y: 3236, level: 0 },
            },
        });

        expect(llm.complete).toHaveBeenCalledTimes(1);
        expect((llm.complete as jest.Mock).mock.calls[0][0].thinking).toBe(false);
        fs.rmSync(memoryDir, { recursive: true, force: true });
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
