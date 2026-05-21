import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ResidentBody } from './body';
import { ResidentBody as ConcreteResidentBody } from './body';
import type { BodyGateway } from './body';
import type { LlmClient } from './llm/llm-client';
import type { ActionLog } from './logging/action-log';
import type { InferenceLog } from './logging/inference-log';
import type { MemoryStore } from './memory/memory-store';
import type { RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import { upsertNervousRulesMd } from './nervous-system';
import { ResidentRuntime, type ResidentRuntimeGameSkill } from './resident-runtime';
import type { Soul } from './soul/soul-schema';
import type { SparkModule } from './spark/modules';
import type { ThinkingModule } from './thinking';
import type { GatewayClient } from './transport/gateway-client';

describe('ResidentRuntime modules', () => {
    it('uses a selected SPARK module for thinking and logs module identity', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-spark-module-test-'));
        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [{ kind: 'noop', cause: 'module-test' }], nooped: false })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
        } as unknown as ResidentBody;
        const inferenceLog = { append: jest.fn() } as unknown as InferenceLog;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip', { modules: [{ id: 'onion.custom' }] }),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog,
            body,
            sparkModules: [sparkModule('onion.custom', thinking)],
        });

        await runtime.onPerception({ tick: 1, events: [] });

        expect(thinking.think).toHaveBeenCalledTimes(1);
        expect(inferenceLog.append).toHaveBeenCalledWith(
            'res:pip',
            expect.objectContaining({ sparkModule: { id: 'onion.custom', version: '0.1.0' } }),
        );
        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'noop', cause: 'module-test' },
            expect.objectContaining({ source: 'thinking', sparkModule: { id: 'onion.custom', version: '0.1.0' } }),
        );
    });

    it('gives selected SPARK modules a redacted telemetry sink', () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-module-telemetry-test-'));
        const state = stateFor('res:pip');
        const inferenceLog = { append: jest.fn() } as unknown as InferenceLog;

        new ResidentRuntime({
            soul: soul('res:pip', { modules: [{ id: 'onion.telemetry' }] }),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog,
            body: {
                observePerception: jest.fn(),
                observeEvent: jest.fn(),
                submit: jest.fn(async () => ({ ok: true })),
            } as unknown as ResidentBody,
            sparkModules: [
                {
                    manifest: {
                        id: 'onion.telemetry',
                        version: '0.1.0',
                        displayName: 'Telemetry',
                        capabilities: ['thinking'],
                        risk: 'reviewed',
                    },
                    createThinkingModule: context => {
                        context.telemetry.emit({ kind: 'debug', message: 'loaded TOKEN=secretvalue' });
                        return thinkingModule();
                    },
                },
            ],
        });

        expect(inferenceLog.append).toHaveBeenCalledWith(
            'res:pip',
            expect.objectContaining({
                cause: 'module_telemetry',
                sparkModule: { id: 'onion.telemetry', version: '0.1.0' },
                telemetry: expect.objectContaining({ kind: 'debug', message: 'loaded [redacted]' }),
            }),
        );
    });

    it('logs SPARK module identity for module-provided nervous actions', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-module-nervous-test-'));
        const state = stateFor('res:pip');
        const thinking = thinkingModule();
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip', { modules: [{ id: 'onion.reflex' }] }),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            body,
            sparkModules: [
                {
                    manifest: {
                        id: 'onion.reflex',
                        version: '0.1.0',
                        displayName: 'Reflex',
                        capabilities: ['thinking', 'nervous-rules'],
                        risk: 'reviewed',
                    },
                    createThinkingModule: () => thinking,
                    createNervousSystem: () => ({
                        react: () => ({
                            rule: {
                                id: 'wave-on-hit',
                                priority: 80,
                                condition: { kind: 'always' },
                                action: { kind: 'noop' },
                            },
                            action: { kind: 'noop', cause: 'nervous:wave-on-hit' },
                            suppressThinking: true,
                            interruptThinking: true,
                        }),
                    }),
                },
            ],
        });

        await runtime.onPerception({ tick: 1, events: [] });

        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'noop', cause: 'nervous:wave-on-hit' },
            expect.objectContaining({
                source: 'nervous-system',
                ruleId: 'wave-on-hit',
                sparkModule: { id: 'onion.reflex', version: '0.1.0' },
            }),
        );
        expect(thinking.think).not.toHaveBeenCalled();
    });

    it('stops a source module only once when it provides multiple facets', () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-module-stop-test-'));
        const state = stateFor('res:pip');
        const thinking = thinkingModule();
        const stop = jest.fn();
        const runtime = new ResidentRuntime({
            soul: soul('res:pip', { modules: [{ id: 'onion.dual' }] }),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            body: {
                observePerception: jest.fn(),
                observeEvent: jest.fn(),
                submit: jest.fn(async () => ({ ok: true })),
            } as unknown as ResidentBody,
            sparkModules: [
                {
                    manifest: {
                        id: 'onion.dual',
                        version: '0.1.0',
                        displayName: 'Dual',
                        capabilities: ['thinking', 'nervous-rules'],
                        risk: 'reviewed',
                    },
                    createThinkingModule: () => thinking,
                    createNervousSystem: () => ({ react: jest.fn(() => undefined) }),
                    stop,
                },
            ],
        });

        runtime.stop('test-stop');

        expect(thinking.stop).toHaveBeenCalledWith('test-stop');
        expect(stop).toHaveBeenCalledTimes(1);
        expect(stop).toHaveBeenCalledWith('test-stop');
    });

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
        expect(thinking.think).toHaveBeenLastCalledWith(expect.objectContaining({ events: [chat] }), undefined);
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

    it('waits for movement evidence before allowing another body decision', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-movement-wait-test-'));
        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [{ kind: 'move_to', target: { x: 5, y: 5, level: 0 } }], nooped: false })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const gateway: jest.Mocked<BodyGateway> = {
            submitAction: jest.fn<ReturnType<BodyGateway['submitAction']>, Parameters<BodyGateway['submitAction']>>(async () => ({
                ok: true,
            })),
        };
        const body = new ConcreteResidentBody({
            resident: 'res:pip',
            gateway,
            actionLog: { append: jest.fn() } as unknown as ActionLog,
        });

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

        const firstTick = runtime.onPerception({ tick: 1, resident: { position: { x: 1, y: 1, level: 0 } }, events: [] });
        await Promise.resolve();
        expect(await settlesWithin(firstTick, 5)).toBe(false);

        await runtime.onPerception({ tick: 2, resident: { position: { x: 1, y: 1, level: 0 } }, events: [] });

        expect(thinking.think).toHaveBeenCalledTimes(1);
        expect(gateway.submitAction).toHaveBeenCalledTimes(1);

        await runtime.onPerception({ tick: 3, resident: { position: { x: 5, y: 5, level: 0 } }, events: [] });
        await firstTick;
    });

    it('accepts movement evidence within move_to range', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-movement-range-test-'));
        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [{ kind: 'move_to', target: { x: 5, y: 5, level: 0 }, range: 2 }], nooped: false })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const gateway: jest.Mocked<BodyGateway> = {
            submitAction: jest.fn<ReturnType<BodyGateway['submitAction']>, Parameters<BodyGateway['submitAction']>>(async () => ({
                ok: true,
            })),
        };
        const body = new ConcreteResidentBody({
            resident: 'res:pip',
            gateway,
            actionLog: { append: jest.fn() } as unknown as ActionLog,
        });

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

        const firstTick = runtime.onPerception({ tick: 1, resident: { position: { x: 1, y: 1, level: 0 } }, events: [] });
        await Promise.resolve();

        await runtime.onPerception({ tick: 2, resident: { position: { x: 4, y: 5, level: 0 } }, events: [] });
        await firstTick;

        expect(thinking.think).toHaveBeenCalledTimes(1);
    });

    it('waits for item action effect evidence before marking the attempt successful', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-item-effect-test-'));
        const state = stateFor('res:pip');
        const context = gameSkillContext();
        const gameSkill: ResidentRuntimeGameSkill = {
            buildContext: jest.fn(() => context),
            observeAttempt: jest.fn(),
        };
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [{ kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1 }], nooped: false })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const gateway: jest.Mocked<BodyGateway> = {
            submitAction: jest.fn<ReturnType<BodyGateway['submitAction']>, Parameters<BodyGateway['submitAction']>>(async () => ({
                ok: true,
            })),
        };
        const body = new ConcreteResidentBody({
            resident: 'res:pip',
            gateway,
            actionLog: { append: jest.fn() } as unknown as ActionLog,
        });

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
            gameSkill,
        });

        const firstTick = runtime.onPerception({
            tick: 1,
            resident: {
                inventory: [
                    { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    { itemId: 1511, key: 'rs:logs', amount: 1 },
                ],
            },
            nearby: { objects: [] },
            events: [],
        });
        await Promise.resolve();
        expect(await settlesWithin(firstTick, 5)).toBe(false);

        await runtime.onPerception({
            tick: 2,
            resident: {
                inventory: [
                    { itemId: 590, key: 'rs:tinderbox', amount: 1 },
                    { itemId: 1511, key: 'rs:logs', amount: 1 },
                ],
            },
            nearby: { objects: [] },
            events: [],
        });
        expect(await settlesWithin(firstTick, 5)).toBe(false);

        await runtime.onPerception({
            tick: 3,
            resident: {
                inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }, null],
            },
            nearby: { objects: [{ objectId: 2732, position: { x: 3200, y: 3200, level: 0 } }] },
            events: [{ kind: 'message', text: 'The fire catches and the logs begin to burn.' }],
        });
        await firstTick;

        expect(gameSkill.observeAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                producer: 'body',
                attempt: expect.objectContaining({
                    finalStatus: 'success',
                    evidence: expect.arrayContaining([
                        expect.objectContaining({
                            source: 'perception',
                            detail: expect.objectContaining({ kind: 'action_effect_observed' }),
                        }),
                    ]),
                }),
            }),
        );
    });

    it('does not treat unrelated movement as item action progress', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-item-unrelated-test-'));
        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [{ kind: 'item_action', slot: 0, option: 'bury' }], nooped: false })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const gateway: jest.Mocked<BodyGateway> = {
            submitAction: jest.fn<ReturnType<BodyGateway['submitAction']>, Parameters<BodyGateway['submitAction']>>(async () => ({
                ok: true,
            })),
        };
        const body = new ConcreteResidentBody({
            resident: 'res:pip',
            gateway,
            actionLog: { append: jest.fn() } as unknown as ActionLog,
        });

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

        const firstTick = runtime.onPerception({
            tick: 1,
            resident: {
                position: { x: 1, y: 1, level: 0 },
                inventory: [{ itemId: 526, key: 'rs:bones', amount: 1 }],
            },
            events: [],
        });
        await Promise.resolve();

        await runtime.onPerception({
            tick: 2,
            resident: {
                position: { x: 2, y: 1, level: 0 },
                inventory: [{ itemId: 526, key: 'rs:bones', amount: 1 }],
            },
            events: [],
        });
        expect(await settlesWithin(firstTick, 5)).toBe(false);

        await runtime.onPerception({
            tick: 3,
            resident: {
                position: { x: 2, y: 1, level: 0 },
                inventory: [null],
            },
            events: [{ kind: 'message', text: 'You bury the bones.' }],
        });
        await firstTick;
    });

    it('builds game-skill context before thinking and observes completed body attempts', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-game-skill-test-'));
        const state = stateFor('res:pip');
        const context = gameSkillContext();
        const gameSkill: ResidentRuntimeGameSkill = {
            buildContext: jest.fn(() => context),
            observeAttempt: jest.fn(),
        };
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [{ kind: 'item_action', slot: 0, option: 'bury' }], nooped: false })),
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
            gameSkill,
        });

        await runtime.onPerception({ tick: 1, compressed: 'Inventory has rs:tinderbox and rs:logs.', events: [] });

        expect(gameSkill.buildContext).toHaveBeenCalledWith(
            expect.objectContaining({
                resident: 'res:pip',
                perception: expect.objectContaining({ compressed: expect.stringContaining('Inventory') }),
            }),
        );
        expect(thinking.think).toHaveBeenCalledWith(expect.any(Object), context);
        expect(gameSkill.observeAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                producer: 'body',
                context,
                attempt: expect.objectContaining({ finalStatus: 'success', action: { kind: 'item_action', slot: 0, option: 'bury' } }),
            }),
        );
    });

    it('observes nervous-system attempts after coordinator completion', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-game-skill-nervous-test-'));
        upsertNervousRulesMd(memoryDir, {
            rules: [
                {
                    id: 'eat-on-hit',
                    priority: 90,
                    condition: { kind: 'event_kind', value: 'hit' },
                    action: { kind: 'eat', slot: 3 },
                },
            ],
        });
        const state = stateFor('res:pip');
        const gameSkill: ResidentRuntimeGameSkill = {
            buildContext: jest.fn(() => gameSkillContext()),
            observeAttempt: jest.fn(),
        };
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
            gameSkill,
        });

        await runtime.onPerception({ tick: 1, events: [{ kind: 'hit' }] });

        expect(gameSkill.observeAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                producer: 'nervous-system',
                context: undefined,
                attempt: expect.objectContaining({ finalStatus: 'success', action: { kind: 'eat', slot: 3, cause: 'nervous:eat-on-hit' } }),
            }),
        );
    });

    it('waits for nervous-system item effects before reporting success', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-nervous-effect-test-'));
        const state = stateFor('res:pip');
        const gameSkill: ResidentRuntimeGameSkill = {
            buildContext: jest.fn(() => gameSkillContext()),
            observeAttempt: jest.fn(),
        };
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [], nooped: true })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const gateway: jest.Mocked<BodyGateway> = {
            submitAction: jest.fn<ReturnType<BodyGateway['submitAction']>, Parameters<BodyGateway['submitAction']>>(async () => ({
                ok: true,
            })),
        };
        const body = new ConcreteResidentBody({
            resident: 'res:pip',
            gateway,
            actionLog: { append: jest.fn() } as unknown as ActionLog,
        });

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
            gameSkill,
        });

        const firstTick = runtime.onPerception({
            tick: 1,
            resident: {
                hp: { current: 3, max: 10 },
                inventory: [{ itemId: 315, key: 'rs:shrimps', amount: 1 }],
            },
            events: [],
        });
        await Promise.resolve();
        expect(await settlesWithin(firstTick, 5)).toBe(false);

        await runtime.onPerception({
            tick: 2,
            resident: {
                hp: { current: 6, max: 10 },
                inventory: [null],
            },
            events: [{ kind: 'message', text: 'You eat the shrimps.' }],
        });
        await firstTick;

        expect(gameSkill.observeAttempt).toHaveBeenCalledWith(
            expect.objectContaining({
                producer: 'nervous-system',
                attempt: expect.objectContaining({
                    finalStatus: 'success',
                    evidence: expect.arrayContaining([
                        expect.objectContaining({
                            source: 'perception',
                            detail: expect.objectContaining({ kind: 'action_effect_observed', actionKind: 'eat' }),
                        }),
                    ]),
                }),
            }),
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

function soul(name: string, extra: Partial<Soul['frontmatter']> = {}): Soul {
    return {
        frontmatter: {
            name,
            archetype: 'mentor',
            legacy: { kind: 'mentor', parameters: { targetMenteeCount: 1 } },
            attentionProfile: { startingAttention: 100, decayCurve: 'standard' },
            ...extra,
        },
        body: '# Test soul',
        sourcePath: '/tmp/soul.md',
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

function thinkingModule(): ThinkingModule {
    return {
        think: jest.fn(async () => ({ actions: [], nooped: true })),
        considerInterrupt: jest.fn(() => false),
        stop: jest.fn(),
    };
}

async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
    let settled = false;
    promise.then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        },
    );
    await new Promise(resolve => setTimeout(resolve, ms));
    return settled;
}

function gameSkillContext() {
    return {
        knowledgeResults: [],
        workflowAvailability: [],
        brainSection: 'Brain game skill section',
        bodySection: 'Body game skill section',
    };
}
