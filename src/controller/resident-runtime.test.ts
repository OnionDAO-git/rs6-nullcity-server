import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ResidentBody } from './body';
import type { LlmClient } from './llm/llm-client';
import type { ActionLog } from './logging/action-log';
import type { InferenceLog } from './logging/inference-log';
import type { MemoryStore } from './memory/memory-store';
import type { RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import { upsertNervousRulesMd } from './nervous-system';
import { ResidentRuntime } from './resident-runtime';
import type { Soul } from './soul/soul-schema';
import type { ThinkingModule } from './thinking';
import type { GatewayClient } from './transport/gateway-client';

describe('ResidentRuntime modules', () => {
    it('carries events received while thinking into the next decision', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-events-test-'));
        const state = stateFor('res:pip');
        let finishFirstThink!: () => void;
        const firstThinkDone = new Promise<void>(resolve => {
            finishFirstThink = resolve;
        });
        const thinking: ThinkingModule = {
            think: jest.fn(async perception => {
                if ((thinking.think as jest.Mock).mock.calls.length === 1) {
                    await firstThinkDone;
                }
                return { actions: [], nooped: true };
            }),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
        } as unknown as ResidentBody;
        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
        });
        const chat = {
            kind: 'chat',
            from: { id: 'player:codex', kind: 'player', name: 'codex', position: { x: 3217, y: 3201, level: 0 } },
            text: 'What are you doing agent?',
            to: 'public',
        };

        const firstTick = runtime.onPerception({ tick: 1, events: [] });
        runtime.onEvent(chat);
        await runtime.onPerception({ tick: 2, events: [] });
        finishFirstThink();
        await firstTick;
        await runtime.onPerception({ tick: 3, events: [] });

        expect(thinking.think).toHaveBeenCalledTimes(2);
        expect(thinking.think).toHaveBeenLastCalledWith(expect.objectContaining({ events: [chat] }));
        expect(body.observeEvent).toHaveBeenCalledWith(chat);
    });

    it('runs nervous system rules before thinking and submits without LLM inference', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-nervous-test-'));
        upsertNervousRulesMd(memoryDir, {
            rules: [
                {
                    id: 'eat-on-hit',
                    priority: 90,
                    condition: { kind: 'event_kind', value: 'hit' },
                    action: { kind: 'eat', slot: 3 },
                    cooldownTicks: 2,
                },
            ],
        });

        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [], nooped: true })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
        } as unknown as ResidentBody;
        const stateStore = {
            load: jest.fn(() => state),
            save: jest.fn(),
        } as unknown as RuntimeStateStore;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
        });

        await runtime.onPerception({ tick: 10, events: [{ kind: 'hit' }] });

        expect(thinking.think).not.toHaveBeenCalled();
        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'eat', slot: 3, cause: 'nervous:eat-on-hit' },
            expect.objectContaining({ source: 'nervous-system', ruleId: 'eat-on-hit' }),
        );
        expect(stateStore.save).toHaveBeenCalledWith(state);
    });

    it('uses built-in nervous survival to eat visible food at low health without inference', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-nervous-food-test-'));
        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [], nooped: true })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
        });

        await runtime.onPerception({
            tick: 10,
            resident: {
                hp: { current: 3, max: 10 },
                inventory: [
                    { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    { itemId: 315, key: 'rs:shrimp', amount: 1 },
                ],
            },
            events: [],
        });

        expect(thinking.think).not.toHaveBeenCalled();
        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'eat', slot: 1, cause: 'nervous:eat-when-low-health' },
            expect.objectContaining({ source: 'nervous-system', ruleId: 'eat-when-low-health' }),
        );
    });
});

function stateFor(resident: string): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident,
        attention: 100,
        tick: 0,
        legacy: { kind: 'mentor', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}

function soul(name: string): Soul {
    return {
        frontmatter: {
            name,
            archetype: 'mentor',
            legacy: { kind: 'mentor', parameters: { targetMenteeCount: 1 } },
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
        },
        body: '# Test soul',
        sourcePath: '/tmp/soul.md',
    };
}
