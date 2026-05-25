import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ResidentBody } from './body';
import { ResidentBody as ConcreteResidentBody } from './body';
import type { BodyGateway } from './body';
import { EvidenceStore, LibraryUpdater, TrajectoryBuilder } from './evidence';
import type { LlmClient } from './llm/llm-client';
import type { ActionLog } from './logging/action-log';
import type { InferenceLog } from './logging/inference-log';
import type { MemoryStore } from './memory/memory-store';
import type { RuntimeState, RuntimeStateStore } from './memory/runtime-state';
import { upsertNervousRulesMd } from './nervous-system';
import { LettersStore } from './patron/letters-store';
import { ResidentRuntime, type ResidentRuntimeEvidence, type ResidentRuntimeGameSkill } from './resident-runtime';
import type { Soul } from './soul/soul-schema';
import type { SparkModule } from './spark/modules';
import type { ThinkingModule } from './thinking';
import type { GatewayClient } from './transport/gateway-client';

describe('ResidentRuntime modules', () => {
    it('writes runtime evidence around decisions and action results', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-evidence-memory-'));
        const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-evidence-'));
        const store = new EvidenceStore('res:pip', evidenceRoot, { now: () => new Date('2026-05-21T08:45:00.000Z') });
        const session = store.beginSession('session-a', 'soul-v1');
        const evidence = {
            store,
            sessionId: session.sessionId,
            trajectory: new TrajectoryBuilder(store, { now: () => new Date('2026-05-21T08:45:01.000Z') }),
        };
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({
                actions: [{ kind: 'noop', cause: 'module-test' }],
                cause: 'module-test',
                nooped: false,
                memoUpdates: 1,
                planChange: { id: 'scout-test', steps: 2 },
            })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-1' })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => stateFor('res:pip')), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
            evidence,
        });

        await runtime.onPerception({ tick: 7, events: [] });

        expect(readJsonl(session.trajectoryPath)).toEqual([
            expect.objectContaining({ kind: 'begin_tick', tick: 7 }),
            expect.objectContaining({
                kind: 'decision',
                tick: 7,
                cause: 'module-test',
                actionKinds: ['noop'],
                memoUpdates: 1,
                planChange: { id: 'scout-test', steps: 2 },
            }),
            expect.objectContaining({ kind: 'action', tick: 7, requestId: 'request-1', actionKind: 'noop' }),
            expect.objectContaining({ kind: 'action_result', tick: 7, requestId: 'request-1', status: 'success' }),
            expect.objectContaining({ kind: 'end_tick', tick: 7, reason: 'tick_complete' }),
        ]);
    });

    it('remembers target_not_found failures so thinking can avoid stale targets', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-target-failure-'));
        const state = stateFor('res:pip');
        state.tick = 22;
        const staleTree = { objectId: 1278, position: { x: 3213, y: 3238, level: 0 }, orientation: 1 };
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({
                actions: [{ kind: 'interact', target: staleTree, option: 'chop down', cause: 'woodcutting_level1_routine' }],
                cause: 'woodcutting_level1_routine',
                nooped: false,
            })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: false, reason: 'target_not_found', requestId: 'request-stale-tree' })),
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

        await runtime.onPerception({ tick: 22, events: [] });

        expect(state.cognition?.targetFailureCooldowns).toEqual({
            'object:1278:3213,3238,0': 22,
        });
    });

    it('records movement timeout distance evidence for coordinate target failures', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-move-timeout-failure-'));
        const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-move-timeout-evidence-'));
        const store = new EvidenceStore('res:pip', evidenceRoot, { now: () => new Date('2026-05-24T12:25:00.000Z') });
        const session = store.beginSession('session-move-timeout', 'soul-v1');
        const evidence = {
            store,
            sessionId: session.sessionId,
            trajectory: new TrajectoryBuilder(store, { now: () => new Date('2026-05-24T12:25:01.000Z') }),
        };
        const state = stateFor('res:pip');
        state.tick = 40;
        let latestPerception: Record<string, unknown> | undefined;
        let perceptionSeq = 0;
        const target = { x: 3217, y: 3233, level: 0 };
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({
                actions: [{ kind: 'move_to', target, range: 1, cause: 'explore_patrol' }],
                cause: 'explore_patrol',
                nooped: false,
            })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn((perception: Record<string, unknown>) => {
                latestPerception = perception;
                perceptionSeq += 1;
            }),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-move-timeout' })),
            getLatestPerception: jest.fn(() => latestPerception),
            getLatestPerceptionSeq: jest.fn(() => perceptionSeq),
            waitForPerception: jest.fn(async () => ({ ok: false, reason: 'timeout' })),
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
            evidence,
        });

        await runtime.onPerception({
            tick: 40,
            resident: { position: { x: 3214, y: 3233, level: 0 } },
            events: [],
        });

        expect(state.cognition?.targetFailureCooldowns).toEqual({
            'target:3217,3233,0': 40,
        });
        expect(readJsonl(session.trajectoryPath)).toContainEqual(
            expect.objectContaining({
                kind: 'action_result',
                requestId: 'request-move-timeout',
                status: 'timeout',
                evidence: [
                    expect.objectContaining({
                        source: 'perception',
                        detail: expect.objectContaining({
                            kind: 'movement_timeout',
                            target,
                            range: 1,
                            startPosition: { x: 3214, y: 3233, level: 0 },
                            finalPosition: { x: 3214, y: 3233, level: 0 },
                            startDistance: 3,
                            finalDistance: 3,
                            improved: false,
                        }),
                    }),
                ],
            }),
        );
    });

    it('treats timed out coordinate movement as progress when the resident moved closer', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-move-progress-timeout-'));
        const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-move-progress-evidence-'));
        const store = new EvidenceStore('res:pip', evidenceRoot, { now: () => new Date('2026-05-24T12:55:00.000Z') });
        const session = store.beginSession('session-move-progress', 'soul-v1');
        const evidence = {
            store,
            sessionId: session.sessionId,
            trajectory: new TrajectoryBuilder(store, { now: () => new Date('2026-05-24T12:55:01.000Z') }),
        };
        const state = stateFor('res:pip');
        state.tick = 41;
        let latestPerception: Record<string, unknown> | undefined;
        let perceptionSeq = 0;
        const target = { x: 3202, y: 3221, level: 0 };
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({
                actions: [{ kind: 'move_to', target, range: 1, cause: 'explore_patrol' }],
                cause: 'explore_patrol',
                nooped: false,
            })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn((perception: Record<string, unknown>) => {
                latestPerception = perception;
                perceptionSeq += 1;
            }),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-move-progress' })),
            getLatestPerception: jest.fn(() => latestPerception),
            getLatestPerceptionSeq: jest.fn(() => perceptionSeq),
            waitForPerception: jest.fn(async () => {
                latestPerception = { tick: 42, resident: { position: { x: 3200, y: 3221, level: 0 } }, events: [] };
                perceptionSeq += 1;
                return { ok: false, reason: 'timeout' };
            }),
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
            evidence,
        });

        await runtime.onPerception({
            tick: 41,
            resident: { position: { x: 3199, y: 3221, level: 0 } },
            events: [],
        });

        expect(state.cognition?.targetFailureCooldowns).toBeUndefined();
        expect(readJsonl(session.trajectoryPath)).toContainEqual(
            expect.objectContaining({
                kind: 'action_result',
                requestId: 'request-move-progress',
                status: 'success',
                evidence: [
                    expect.objectContaining({
                        source: 'perception',
                        detail: expect.objectContaining({
                            kind: 'movement_progress',
                            target,
                            range: 1,
                            startPosition: { x: 3199, y: 3221, level: 0 },
                            finalPosition: { x: 3200, y: 3221, level: 0 },
                            startDistance: 3,
                            finalDistance: 2,
                            improved: true,
                            waitOutcome: 'timeout',
                        }),
                    }),
                ],
            }),
        );
    });

    it('writes runtime progress evidence and updates progress state from perceptions', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-progress-memory-'));
        const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-progress-'));
        const store = new EvidenceStore('res:pip', evidenceRoot, { now: () => new Date('2026-05-21T08:55:00.000Z') });
        const session = store.beginSession('session-progress', 'soul-v1');
        const evidence = {
            store,
            sessionId: session.sessionId,
            trajectory: new TrajectoryBuilder(store, { now: () => new Date('2026-05-21T08:55:01.000Z') }),
        };
        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [{ kind: 'noop', cause: 'module-test' }], cause: 'module-test', nooped: false })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-1' })),
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
            evidence,
        });

        await runtime.onPerception(progressPerception(1, 3200, 3200, 0, 1, 10));
        await runtime.onPerception(progressPerception(2, 3201, 3200, 25, 2, 8));

        expect(readJsonl(session.progressPath)).toEqual([
            expect.objectContaining({ kind: 'progress', tick: 1, meaningful: true, reasons: ['initial_sample'], stuckSince: null }),
            expect.objectContaining({
                kind: 'progress',
                tick: 2,
                meaningful: true,
                reasons: ['xp_gain:woodcutting:25', 'inventory:+1', 'position_changed', 'hp:-2'],
                stuckSince: null,
            }),
        ]);
        expect(state.lastMeaningfulProgressAt).toBe(2);
        expect(state.stuckSince).toBeUndefined();
    });

    it('stores progress state ticks on the runtime clock when perception ticks lag persisted state', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-progress-clock-memory-'));
        const state = stateFor('res:pip');
        state.tick = 500;
        state.stuckSince = 450;
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [], cause: 'module-test', nooped: true })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-1' })),
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

        await runtime.onPerception(progressPerception(10, 3200, 3200, 0, 1, 10));
        await runtime.onPerception(progressPerception(31, 3200, 3200, 0, 1, 10));

        expect(state.lastMeaningfulProgressAt).toBe(500);
        expect(state.stuckSince).toBe(500);
    });

    it('updates Library of Souls story artifacts from runtime speech', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-library-memory-'));
        const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-library-'));
        const store = new EvidenceStore('res:pip', evidenceRoot, { now: () => new Date('2026-05-21T11:40:00.000Z') });
        const session = store.beginSession('session-library', 'soul-v1');
        const evidence = {
            store,
            sessionId: session.sessionId,
            trajectory: new TrajectoryBuilder(store, { now: () => new Date('2026-05-21T11:40:01.000Z') }),
            library: new LibraryUpdater('res:pip', evidenceRoot, { now: () => new Date('2026-05-21T11:40:02.000Z') }),
        };
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({
                actions: [{ kind: 'say', text: 'I want to find a tree.', cause: 'library-test' }],
                cause: 'library-test',
                nooped: false,
            })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-say' })),
            getLatestEventSeq: jest.fn(() => 0),
            waitForEvent: jest.fn(async () => ({ ok: false, status: 'timeout' })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => stateFor('res:pip')), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
            evidence,
        });

        await runtime.onPerception({ tick: 12, events: [] });

        const libraryDir = path.join(evidenceRoot, 'library', 'res-pip');
        expect(readJsonl(path.join(libraryDir, 'timeline.jsonl'))).toEqual([
            expect.objectContaining({ kind: 'say', text: 'I want to find a tree.', lifeIndex: 1 }),
        ]);
        expect(JSON.parse(fs.readFileSync(path.join(libraryDir, 'portrait.json'), 'utf8'))).toEqual(
            expect.objectContaining({
                residentName: 'res:pip',
                voice: { quotes: [expect.objectContaining({ text: 'I want to find a tree.', tag: 'mentions_want' })] },
            }),
        );
    });

    it('uses the action watchdog to recover from a hung effect wait', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-action-watchdog-'));
        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest
                .fn()
                .mockResolvedValueOnce({
                    actions: [{ kind: 'say', text: 'Still working.', cause: 'watchdog-test' }],
                    cause: 'watchdog-test',
                    nooped: false,
                })
                .mockResolvedValueOnce({ actions: [], cause: 'recovered', nooped: true }),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-watchdog' })),
            getLatestEventSeq: jest.fn(() => 0),
            waitForEvent: jest.fn(() => new Promise(() => undefined)),
        } as unknown as ResidentBody;
        const inferenceLog = { append: jest.fn() } as unknown as InferenceLog;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog,
            thinking,
            body,
            watchdog: { actionMs: 5 },
        });

        await runtime.onPerception({ tick: 1, events: [] });
        await runtime.onPerception({ tick: 2, events: [] });

        expect(inferenceLog.append).toHaveBeenCalledWith(
            'res:pip',
            expect.objectContaining({ cause: 'action_watchdog_timeout', actionKind: 'say', timeoutMs: 5 }),
        );
        expect(thinking.think).toHaveBeenCalledTimes(2);
    });

    it('uses the thinking watchdog to recover from a hung inference call', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-thinking-watchdog-'));
        const state = stateFor('res:pip');
        const thinking: ThinkingModule = {
            think: jest
                .fn()
                .mockImplementationOnce(() => new Promise(() => undefined))
                .mockResolvedValueOnce({ actions: [], cause: 'recovered', nooped: true }),
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
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog,
            thinking,
            body,
            watchdog: { thinkingMs: 5 },
        });

        await runtime.onPerception({ tick: 1, events: [] });
        await runtime.onPerception({ tick: 2, events: [] });

        expect(thinking.stop).toHaveBeenCalledWith('thinking_watchdog_timeout');
        expect(inferenceLog.append).toHaveBeenCalledWith(
            'res:pip',
            expect.objectContaining({ cause: 'thinking_watchdog_timeout', timeoutMs: 5 }),
        );
        expect(thinking.think).toHaveBeenCalledTimes(2);
    });

    it('uses a module watchdog fallback decision when thinking times out', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-thinking-fallback-'));
        const state = stateFor('res:pip');
        const thinking = {
            think: jest.fn().mockImplementationOnce(() => new Promise(() => undefined)),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
            onWatchdogTimeout: jest.fn(() => ({
                actions: [{ kind: 'say', text: 'I lost the thread, so I am scouting nearby.', cause: 'brain_timeout_fallback' }],
                syntheticEvents: [],
                cause: 'brain_timeout_fallback',
                envelopeTokens: 0,
                nooped: false,
                planChange: { id: 'scout-nearby-area', source: 'brain_timeout_fallback' },
            })),
        } as unknown as ThinkingModule & {
            onWatchdogTimeout: jest.Mock;
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-fallback-say' })),
            getLatestEventSeq: jest.fn(() => 0),
            waitForEvent: jest.fn(async () => ({
                ok: true,
                observation: {
                    seq: 1,
                    observedAt: Date.now(),
                    value: { kind: 'chat', text: 'I lost the thread, so I am scouting nearby.' },
                },
            })),
        } as unknown as ResidentBody;
        const inferenceLog = { append: jest.fn() } as unknown as InferenceLog;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog,
            thinking,
            body,
            watchdog: { thinkingMs: 5 },
        });

        await runtime.onPerception({ tick: 1, events: [] });

        expect(thinking.stop).toHaveBeenCalledWith('thinking_watchdog_timeout');
        expect(thinking.onWatchdogTimeout).toHaveBeenCalled();
        expect(body.submit).toHaveBeenCalledWith(
            expect.objectContaining({ kind: 'say', text: 'I lost the thread, so I am scouting nearby.' }),
            expect.objectContaining({ source: 'thinking' }),
        );
        expect(inferenceLog.append).toHaveBeenCalledWith(
            'res:pip',
            expect.objectContaining({ cause: 'brain_timeout_fallback', actions_emitted: 1 }),
        );
    });

    it('logs deciding status only after slow thinking remains pending so observers see activity without spam', async () => {
        jest.useFakeTimers();
        try {
            const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-thinking-start-'));
            const state = stateFor('res:pip');
            let resolveThink:
                | ((result: { actions: []; cause: string; envelopeTokens: number; nooped: boolean; syntheticEvents: [] }) => void)
                | undefined;
            const thinking: ThinkingModule = {
                think: jest.fn(
                    () =>
                        new Promise(resolve => {
                            resolveThink = resolve;
                        }),
                ),
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
                soul: soul('res:pip'),
                gateway: {} as GatewayClient,
                memory: {
                    ensureResident: jest.fn(() => memoryDir),
                    retrieve: jest.fn(() => []),
                    write: jest.fn(),
                } as unknown as MemoryStore,
                stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
                llm: {} as LlmClient,
                actionLog: {} as ActionLog,
                inferenceLog,
                thinking,
                body,
            });

            const pending = runtime.onPerception({ tick: 3, events: [] });
            await Promise.resolve();
            expect(inferenceLog.append).not.toHaveBeenCalledWith(
                'res:pip',
                expect.objectContaining({ cause: 'thinking_started', status: 'deciding' }),
            );

            jest.advanceTimersByTime(999);
            await Promise.resolve();
            expect(inferenceLog.append).not.toHaveBeenCalledWith(
                'res:pip',
                expect.objectContaining({ cause: 'thinking_started', status: 'deciding' }),
            );

            jest.advanceTimersByTime(1);
            await Promise.resolve();
            expect(inferenceLog.append).toHaveBeenCalledWith(
                'res:pip',
                expect.objectContaining({ cause: 'thinking_started', status: 'deciding', perception_tokens: expect.any(Number) }),
            );

            resolveThink?.({ actions: [], cause: 'slow-test', envelopeTokens: 12, nooped: true, syntheticEvents: [] });
            await pending;
            expect(inferenceLog.append).toHaveBeenCalledWith(
                'res:pip',
                expect.objectContaining({ cause: 'slow-test', actions_emitted: 0 }),
            );
        } finally {
            jest.useRealTimers();
        }
    });

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
        expect(await settlesWithin(firstTick, 5)).toBe(false);

        await runtime.onPerception({ tick: 2, resident: { position: { x: 4, y: 5, level: 0 } }, events: [] });
        await firstTick;

        expect(thinking.think).toHaveBeenCalledTimes(1);
    });

    it('caps distant movement evidence waits so blocked moves recover visibly', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-long-move-timeout-test-'));
        const state = stateFor('res:pip');
        let latestPerception: Record<string, unknown> | undefined;
        let perceptionSeq = 0;
        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({
                actions: [{ kind: 'move_to', target: { x: 3208, y: 3213, level: 0 }, range: 4, cause: 'starter_fishing_find_range' }],
                nooped: false,
            })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn((perception: Record<string, unknown>) => {
                latestPerception = perception;
                perceptionSeq += 1;
            }),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
            getLatestPerception: jest.fn(() => latestPerception),
            getLatestPerceptionSeq: jest.fn(() => perceptionSeq),
            waitForPerception: jest.fn(async () => ({ ok: false, reason: 'timeout' })),
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
            tick: 1,
            resident: { position: { x: 3240, y: 3244, level: 0 } },
            events: [],
        });

        expect(body.waitForPerception).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ timeoutMs: 30_000 }));
    });

    it('waits for item action effect evidence before marking the attempt successful', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-item-effect-test-'));
        const state = stateFor('res:pip');
        state.cognition = {
            activeGoal: {
                id: 'make-fire',
                description: 'Gather ordinary logs and light a fire with the tinderbox.',
                ttlTicks: 600,
                createdAtTick: 1,
            },
        };
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
            nearby: { objects: [] },
            events: [{ kind: 'item_lost', item: { itemId: 1511, key: 'rs:logs', amount: 1 } }],
        });
        expect(await settlesWithin(firstTick, 5)).toBe(false);

        await runtime.onPerception({
            tick: 4,
            resident: {
                inventory: [{ itemId: 590, key: 'rs:tinderbox', amount: 1 }, null],
            },
            nearby: { objects: [{ objectId: 2732, position: { x: 3200, y: 3200, level: 0 } }] },
            events: [{ kind: 'fire_lit', position: { x: 3200, y: 3200, level: 0 } }],
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
        expect(state.cognition?.activeGoal).toEqual(
            expect.objectContaining({
                id: 'scout-nearby-area',
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

    it('observes patron chat events and forwards them to library updater', async () => {
        const state = stateFor('res:pip');
        const thinking = thinkingModule();
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
        } as unknown as ResidentBody;

        const observePatron = jest.fn();
        const library = {
            observePatron,
        } as unknown as LibraryUpdater;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => '/tmp'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
            evidence: {
                store: {} as any,
                sessionId: 'session-123',
                trajectory: {} as any,
                library,
            },
            patrons: [{ handle: 'James@Onion', kind: 'patron_sponsor' }],
        });

        const patronChat = {
            kind: 'chat' as const,
            from: { id: 'player:james', kind: 'player' as const, name: 'James@Onion', position: { x: 3217, y: 3201, level: 0 } },
            text: 'Hello from a patron!',
            to: 'public',
            ts: '2026-05-23T02:20:48Z',
        };

        runtime.onEvent(patronChat);

        expect(observePatron).toHaveBeenCalledWith({
            kind: 'patron_sponsor',
            ts: '2026-05-23T02:20:48Z',
            tick: 0,
            patronHandle: 'James@Onion',
            note: 'Hello from a patron!',
        });
        expect(body.observeEvent).toHaveBeenCalledWith(patronChat);
    });

    it('acknowledges patrons publicly via nervous reflex and respects cooldowns', async () => {
        const state = stateFor('res:pip');
        const thinking = thinkingModule();
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true })),
            getLatestEventSeq: jest.fn(() => 0),
            waitForEvent: jest.fn(async () => ({ text: 'Thank you for sponsoring us, James@Onion!' })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => '/tmp'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
            patrons: [{ handle: 'James@Onion', kind: 'patron_sponsor' }],
        });

        const patronChat = {
            kind: 'chat' as const,
            from: { id: 'player:james', kind: 'player' as const, name: 'James@Onion', position: { x: 3217, y: 3201, level: 0 } },
            text: 'Hello from a patron!',
            to: 'public',
            ts: '2026-05-23T02:20:48Z',
        };

        runtime.onEvent(patronChat);

        // Process perception, expecting the nervous system to react
        await runtime.onPerception({ tick: 1, events: [] });

        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'say', text: 'Thank you for sponsoring us, James@Onion!', cause: 'nervous:patron-acknowledge' },
            expect.objectContaining({ source: 'nervous-system', ruleId: 'patron-acknowledge-james@onion' }),
        );

        // Process again with another chat event from same patron, expecting NO thank you because of cooldown
        (body.submit as jest.Mock).mockClear();
        runtime.onEvent(patronChat);
        await runtime.onPerception({ tick: 2, events: [] });

        expect(body.submit).not.toHaveBeenCalled();
    });

    it('emits a reception greeting and records patron witness when a registered patron chats inside the embassy', async () => {
        const state = stateFor('res:hans');
        const thinking = thinkingModule();
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'embassy-greeting-1' })),
            getLatestEventSeq: jest.fn(() => 0),
            waitForEvent: jest.fn(async () => ({
                ok: true,
                observation: {
                    seq: 1,
                    observedAt: Date.now(),
                    value: {
                        kind: 'chat',
                        text: 'Welcome to the embassy, alice@onion.',
                        from: { name: 'res:hans' },
                    },
                },
            })),
        } as unknown as ResidentBody;
        const patronGateway = { witnessAt: jest.fn(async () => undefined) };

        const runtime = new ResidentRuntime({
            soul: soul('res:hans'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => '/tmp'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
            patrons: [{ handle: 'alice@onion', kind: 'patron_witness' }],
            patronGateway,
        } as ConstructorParameters<typeof ResidentRuntime>[0]);

        runtime.onEvent({
            kind: 'chat',
            from: { id: 'player:alice', kind: 'player', name: 'alice@onion', position: { x: 3243, y: 3209, level: 0 } },
            text: 'hello',
            to: 'public',
            ts: '2026-05-25T00:30:00Z',
        });
        await runtime.onPerception({ tick: 1, resident: { position: { x: 3243, y: 3209, level: 0 } }, events: [] });

        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'say', text: 'Welcome to the embassy, alice@onion.', cause: 'embassy_reception_greeting' },
            expect.objectContaining({ source: 'nervous-system', ruleId: 'embassy_reception_greeting' }),
        );
        expect(patronGateway.witnessAt).toHaveBeenCalledWith('alice@onion', 'embassy', 'res:hans');
        expect(thinking.think).not.toHaveBeenCalled();
    });

    it('does not record a patron witness when the embassy greeting action fails', async () => {
        const state = stateFor('res:hans');
        const thinking = thinkingModule();
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: false, reason: 'say_failed', requestId: 'embassy-greeting-1' })),
            getLatestEventSeq: jest.fn(() => 0),
            waitForEvent: jest.fn(),
        } as unknown as ResidentBody;
        const patronGateway = { witnessAt: jest.fn(async () => undefined) };

        const runtime = new ResidentRuntime({
            soul: soul('res:hans'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => '/tmp'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            body,
            patrons: [{ handle: 'alice@onion', kind: 'patron_witness' }],
            patronGateway,
        } as ConstructorParameters<typeof ResidentRuntime>[0]);

        runtime.onEvent({
            kind: 'chat',
            from: { id: 'player:alice', kind: 'player', name: 'alice@onion', position: { x: 3243, y: 3209, level: 0 } },
            text: 'hello',
            to: 'public',
            ts: '2026-05-25T00:30:00Z',
        });
        await runtime.onPerception({ tick: 1, resident: { position: { x: 3243, y: 3209, level: 0 } }, events: [] });

        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'say', text: 'Welcome to the embassy, alice@onion.', cause: 'embassy_reception_greeting' },
            expect.objectContaining({ source: 'nervous-system', ruleId: 'embassy_reception_greeting' }),
        );
        expect(patronGateway.witnessAt).not.toHaveBeenCalled();
        expect(state.hookCooldowns?.['embassy-greeting:alice@onion']).toBeUndefined();
        expect(thinking.think).not.toHaveBeenCalled();
    });

    it('uses follow_player routine params to target the named nearby player at requested distance', async () => {
        const state = stateFor('res:pip');
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'routine-follow-1' })),
            getLatestPerceptionSeq: jest.fn(() => 0),
            getLatestPerception: jest.fn(() => undefined),
            waitForPerception: jest.fn(async () => ({
                ok: true,
                observation: { value: { resident: { position: { x: 3208, y: 3200, level: 0 } } } },
            })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => '/tmp'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
            body,
        });
        runtime.activeRoutineId = 'follow_player';

        const tickPromise = runtime.tick({
            tickIndex: 0,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 2 },
        });

        await runtime.onPerception({
            tick: 1,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: {
                players: [
                    { id: 'player:near', kind: 'player', name: 'Nearby', position: { x: 3201, y: 3200, level: 0 } },
                    { id: 'player:james', kind: 'player', name: 'James', position: { x: 3208, y: 3200, level: 0 } },
                ],
            },
            events: [],
        });

        await expect(tickPromise).resolves.toBe('progress');
        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'move_to', target: { x: 3208, y: 3200, level: 0 }, range: 2, cause: 'routine:follow_player' },
            expect.objectContaining({ source: 'routine', routineId: 'follow_player' }),
        );
    });

    it('runs chop_tree routine to move toward targetCoord when far, or chop if close/not provided', async () => {
        const state = stateFor('res:pip');
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'chop-1' })),
            getLatestPerceptionSeq: jest.fn(() => 0),
            getLatestPerception: jest.fn(() => undefined),
            waitForPerception: jest.fn(async () => ({
                ok: true,
                observation: { value: { resident: { position: { x: 3200, y: 3200, level: 0 } } } },
            })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => '/tmp'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
            body,
        });

        // Test 1: Far away from targetCoord
        let tickPromise = runtime.tick({
            tickIndex: 0,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'chop_tree',
            params: { targetCoord: { x: 3205, y: 3205, level: 0 } },
        });

        await runtime.onPerception({
            tick: 1,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { objects: [] },
            events: [],
        });

        await expect(tickPromise).resolves.toBe('progress');
        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'move_to', target: { x: 3205, y: 3205, level: 0 }, range: 1, cause: 'routine:chop_tree' },
            expect.objectContaining({ source: 'routine', routineId: 'chop_tree' }),
        );

        // Test 2: Close to targetCoord (within distance 1)
        (body.submit as jest.Mock).mockClear();
        tickPromise = runtime.tick({
            tickIndex: 1,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'chop_tree',
            params: { targetCoord: { x: 3201, y: 3200, level: 0 } },
        });

        await runtime.onPerception({
            tick: 2,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [{ itemId: 1351, key: 'rs:bronze axe', amount: 1 }] },
            nearby: { objects: [{ objectId: 1276, key: 'rs:tree', position: { x: 3201, y: 3200, level: 0 } }] },
            events: [],
        });

        await expect(tickPromise).resolves.toBe('completed');
        expect(body.submit).toHaveBeenCalledWith(
            {
                kind: 'interact',
                option: 'chop down',
                target: expect.objectContaining({ objectId: 1276 }),
                cause: 'woodcutting_level1_routine',
            },
            expect.objectContaining({ source: 'routine', routineId: 'chop_tree' }),
        );
    });

    it('runs safe_combat routine to preempt when HP <= 30%, and tracks kills to complete', async () => {
        const state = stateFor('res:pip');
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'combat-1' })),
            getLatestPerceptionSeq: jest.fn(() => 0),
            getLatestPerception: jest.fn(() => undefined),
            waitForPerception: jest.fn(async () => ({
                ok: true,
                observation: { value: { resident: { position: { x: 3200, y: 3200, level: 0 } } } },
            })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => '/tmp'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
            body,
        });

        // Test 1: HP preemption at <= 30% (e.g., HP 3/10)
        let tickPromise = runtime.tick({
            tickIndex: 0,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'safe_combat',
            params: { killCount: 2 },
        });

        await runtime.onPerception({
            tick: 1,
            resident: { hp: { current: 3, max: 10 }, position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { npcs: [{ id: 'npc:1', name: 'Goblin', position: { x: 3201, y: 3200, level: 0 } }] },
            events: [],
        });

        await expect(tickPromise).resolves.toEqual({ preempted: 'nervous_eat_when_hurt' });
        expect(body.submit).not.toHaveBeenCalled();

        // Test 2: Target params select the requested NPC instead of the first visible safe target.
        (body.submit as jest.Mock).mockClear();
        tickPromise = runtime.tick({
            tickIndex: 0,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'safe_combat',
            params: { target: { kind: 'npc', name: 'cow' }, killCount: 1 },
        });

        await runtime.onPerception({
            tick: 2,
            resident: { hp: { current: 8, max: 10 }, position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: {
                npcs: [
                    { id: 'npc:goblin', kind: 'npc', name: 'Goblin', position: { x: 3201, y: 3200, level: 0 } },
                    { id: 'npc:cow', kind: 'npc', name: 'Cow', position: { x: 3202, y: 3200, level: 0 } },
                ],
            },
            events: [],
        });

        await expect(tickPromise).resolves.toBe('progress');
        expect(body.submit).toHaveBeenCalledWith(
            {
                kind: 'attack',
                target: expect.objectContaining({ id: 'npc:cow', name: 'Cow' }),
                cause: 'routine:safe_combat',
            },
            expect.objectContaining({ source: 'routine', routineId: 'safe_combat' }),
        );

        // Test 3: Defeat logging and completion when killsObserved >= killCount (e.g. 1).
        (body.submit as jest.Mock).mockClear();
        tickPromise = runtime.tick({
            tickIndex: 0,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'safe_combat',
            params: { killCount: 1 },
        });

        await runtime.onPerception({
            tick: 3,
            resident: { hp: { current: 8, max: 10 }, position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { npcs: [{ id: 'npc:1', name: 'Goblin', position: { x: 3201, y: 3200, level: 0 } }] },
            events: [{ kind: 'death', text: 'Goblin dies.' }],
        });

        await expect(tickPromise).resolves.toBe('completed');
        expect(body.submit).not.toHaveBeenCalled();
    });

    it('runs follow_player routine and only completes after 5 consecutive ticks within distance', async () => {
        const state = stateFor('res:pip');
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'follow-1' })),
            getLatestPerceptionSeq: jest.fn(() => 0),
            getLatestPerception: jest.fn(() => undefined),
            waitForPerception: jest.fn(async () => ({
                ok: true,
                observation: { value: { resident: { position: { x: 3200, y: 3200, level: 0 } } } },
            })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => '/tmp'), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
            body,
        });

        // Tick 0: fresh run starts the stable-follow counter.
        let tickPromise = runtime.tick({
            tickIndex: 0,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 3 },
        });

        await runtime.onPerception({
            tick: 1,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { players: [{ id: 'player:james', name: 'James', position: { x: 3202, y: 3200, level: 0 } }] },
            events: [],
        });
        await expect(tickPromise).resolves.toBe('progress');

        // Tick 1: 2nd consecutive tick in range
        tickPromise = runtime.tick({
            tickIndex: 1,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 3 },
        });
        await runtime.onPerception({
            tick: 2,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { players: [{ id: 'player:james', name: 'James', position: { x: 3202, y: 3200, level: 0 } }] },
            events: [],
        });
        await expect(tickPromise).resolves.toBe('progress');

        // Tick 2: Out of range tick -> resets counter to 0 and treats movement as progress.
        tickPromise = runtime.tick({
            tickIndex: 2,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 3 },
        });
        await runtime.onPerception({
            tick: 3,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { players: [{ id: 'player:james', name: 'James', position: { x: 3208, y: 3200, level: 0 } }] },
            events: [],
        });
        await expect(tickPromise).resolves.toBe('progress');

        // Let's simulate 5 consecutive ticks in range (consecutive ticks 1 to 5)
        // Tick 1:
        tickPromise = runtime.tick({
            tickIndex: 0,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 3 },
        });
        await runtime.onPerception({
            tick: 4,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { players: [{ id: 'player:james', name: 'James', position: { x: 3202, y: 3200, level: 0 } }] },
            events: [],
        });
        await expect(tickPromise).resolves.toBe('progress');

        // Tick 2:
        tickPromise = runtime.tick({
            tickIndex: 1,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 3 },
        });
        await runtime.onPerception({
            tick: 5,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { players: [{ id: 'player:james', name: 'James', position: { x: 3202, y: 3200, level: 0 } }] },
            events: [],
        });
        await expect(tickPromise).resolves.toBe('progress');

        // Tick 3:
        tickPromise = runtime.tick({
            tickIndex: 2,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 3 },
        });
        await runtime.onPerception({
            tick: 6,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { players: [{ id: 'player:james', name: 'James', position: { x: 3202, y: 3200, level: 0 } }] },
            events: [],
        });
        await expect(tickPromise).resolves.toBe('progress');

        // Tick 4:
        tickPromise = runtime.tick({
            tickIndex: 3,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 3 },
        });
        await runtime.onPerception({
            tick: 7,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { players: [{ id: 'player:james', name: 'James', position: { x: 3202, y: 3200, level: 0 } }] },
            events: [],
        });
        await expect(tickPromise).resolves.toBe('progress');

        // Tick 5: consecutive 5th tick -> completes!
        tickPromise = runtime.tick({
            tickIndex: 4,
            maxTicks: 10,
            signal: new AbortController().signal,
            routineId: 'follow_player',
            params: { player: 'James', distance: 3 },
        });
        await runtime.onPerception({
            tick: 8,
            resident: { position: { x: 3200, y: 3200, level: 0 }, inventory: [] },
            nearby: { players: [{ id: 'player:james', name: 'James', position: { x: 3202, y: 3200, level: 0 } }] },
            events: [],
        });
        await expect(tickPromise).resolves.toBe('completed');
    });

    it('triggers epitaph building and dispatching on onPerception when state.deceased is set, and marks it processed', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-deceased-memory-'));
        const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-deceased-evidence-'));
        const store = new EvidenceStore('res:pip', evidenceRoot);

        const state = stateFor('res:pip');
        state.deceased = {
            date: '2026-05-23T16:00:00.000Z',
            tick: 100,
            cause: 'killed by guard',
        };

        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [], cause: 'noop', nooped: true })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore: { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
            evidence: {
                store,
                sessionId: 'session-1',
                trajectory: {
                    beginTick: jest.fn(),
                    endTick: jest.fn(),
                    recordDecision: jest.fn(),
                } as unknown as TrajectoryBuilder,
                library: {
                    getPatronHandles: jest.fn(() => ['patron:alice', 'patron:bob']),
                } as unknown as LibraryUpdater,
            },
        });

        await runtime.onPerception({
            tick: 101,
            resident: {
                position: { x: 3200, y: 3200, level: 0 },
                inventory: [],
                skills: {
                    woodcutting: { xp: 1000 },
                    firemaking: { xp: 5000 },
                },
            },
            nearby: { players: [], npcs: [], worldItems: [], objects: [] },
            events: [],
            availableActions: [],
        });

        expect(state.deceased.processed).toBe(true);

        const lettersStore = new LettersStore(evidenceRoot);
        const aliceLetters = lettersStore.readInbox('patron:alice');
        const bobLetters = lettersStore.readInbox('patron:bob');

        expect(aliceLetters).toHaveLength(1);
        expect(bobLetters).toHaveLength(1);
        expect(aliceLetters[0].kind).toBe('epitaph');
        expect(aliceLetters[0].body).toContain('res:pip');
        expect(aliceLetters[0].body).toContain('killed by guard');
        expect(aliceLetters[0].body).toContain('firemaking');

        fs.rmSync(memoryDir, { recursive: true, force: true });
        fs.rmSync(evidenceRoot, { recursive: true, force: true });
    });

    it('decays attention per perception tick and marks deceased when attention is exhausted', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-attention-memory-'));

        const state = stateFor('res:pip');
        state.attention = 1.0;

        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({ actions: [], cause: 'noop', nooped: true })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-logout' })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip', {
                attentionProfile: { startingAttention: 1.0, decayCurve: 'standard' },
            }),
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
            tick: 1,
            resident: {
                position: { x: 3200, y: 3200, level: 0 },
                inventory: [],
                skills: {},
            },
            nearby: { players: [], npcs: [], worldItems: [], objects: [] },
            events: [],
            availableActions: [],
        });

        expect(state.attention).toBe(0);
        expect(state.deceased).toBeDefined();
        expect(state.deceased?.cause).toBe('attention_exhausted');

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('submits an attention logout and skips thinking when attention is exhausted', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-attention-logout-memory-'));

        const state = stateFor('res:pip');
        state.attention = 1.0;

        const thinking: ThinkingModule = {
            think: jest.fn(async () => ({
                actions: [{ kind: 'noop', cause: 'attention-regression' }],
                cause: 'attention-regression',
                nooped: false,
            })),
            considerInterrupt: jest.fn(() => false),
            stop: jest.fn(),
        };
        const body = {
            observePerception: jest.fn(),
            observeEvent: jest.fn(),
            submit: jest.fn(async () => ({ ok: true, requestId: 'request-logout' })),
        } as unknown as ResidentBody;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip', {
                attentionProfile: { startingAttention: 1.0, decayCurve: 'standard' },
            }),
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
            tick: 1,
            resident: {
                position: { x: 3200, y: 3200, level: 0 },
                inventory: [],
                skills: {},
            },
            nearby: { players: [], npcs: [], worldItems: [], objects: [] },
            events: [],
            availableActions: [],
        });

        expect(state.attention).toBe(0);
        expect(state.deceased?.cause).toBe('attention_exhausted');
        expect(thinking.think).not.toHaveBeenCalled();
        expect(body.submit).toHaveBeenCalledWith(
            { kind: 'logout', cause: 'attention_exhausted' },
            expect.objectContaining({ source: 'nervous-system', ruleId: 'attention_exhausted' }),
        );

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('revives attention-exhausted state when patron attention is added', () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-attention-revive-memory-'));

        const state = stateFor('res:pip');
        state.attention = 0;
        state.deceased = {
            date: '2026-05-24T03:29:07.016Z',
            tick: 59728,
            cause: 'attention_exhausted',
            processed: true,
        };
        const stateStore = { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore;

        const runtime = new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
        });

        runtime.incrementAttention(20);

        expect(state.attention).toBe(20);
        expect(state.deceased).toBeUndefined();
        expect(stateStore.save).toHaveBeenCalledWith(state);

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('revives an attention-exhausted dev resident on restart when SOUL requests it', () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-respawn-memory-'));

        const state = stateFor('res:agent');
        state.attention = 0;
        state.stuckSince = 53943;
        state.cognition = {
            activeMove: {
                target: { x: 3225, y: 3230, level: 0 },
                startedAtTick: 53900,
                lastTick: 53908,
                lastDistance: 6,
                stationaryCount: 3,
                cause: 'continue_move',
            },
        };
        state.deceased = {
            date: '2026-05-24T13:21:19.155Z',
            tick: 53908,
            cause: 'attention_exhausted',
            processed: true,
        };
        const stateStore = { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore;

        new ResidentRuntime({
            soul: soul('res:agent', {
                attentionProfile: { startingAttention: 120000, decayCurve: 'gentle' },
                respawnPolicy: 'on_restart',
            } as Partial<Soul['frontmatter']>),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
        });

        expect(state.attention).toBe(120000);
        expect(state.deceased).toBeUndefined();
        expect(state.stuckSince).toBeUndefined();
        expect(state.cognition?.activeMove).toBeUndefined();
        expect(stateStore.save).toHaveBeenCalledWith(state);

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('calls LibraryUpdater.observeRevival when restart respawn policy revives a deceased dev resident (HD-028 wire-in)', () => {
        // E12 (intelligence-verification-log.md § E8 / F8a / HD-028).
        // Codex's 4f62d181 added the runtime-state side of restart
        // respawn but no narrative beat — the resident's evidence stream
        // had nothing saying "I came back". claude shipped the substrate
        // (LibraryUpdater.observeRevival) at f9968a16. This test pins
        // the wire-in: when applyRestartRespawnPolicy actually mutates
        // state, the library learns about it so the Brain's prompt
        // envelope picks up a `revival` memory line on the next wake.
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-revival-evidence-'));

        const state = stateFor('res:agent');
        state.attention = 0;
        state.deceased = {
            date: '2026-05-24T13:21:19.155Z',
            tick: 53908,
            cause: 'attention_exhausted',
            processed: true,
        };
        const stateStore = { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore;

        const observeRevival = jest.fn();
        const evidence: ResidentRuntimeEvidence = {
            store: { appendTrajectory: jest.fn(), appendProgress: jest.fn(), beginSession: jest.fn() } as any,
            sessionId: 'test-session',
            trajectory: { recordPatron: jest.fn() } as any,
            library: { observeRevival, observePatron: jest.fn(), observeTrajectory: jest.fn(), observeProgress: jest.fn() } as any,
        };

        new ResidentRuntime({
            soul: soul('res:agent', {
                attentionProfile: { startingAttention: 120000, decayCurve: 'gentle' },
                respawnPolicy: 'on_restart',
            } as Partial<Soul['frontmatter']>),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
            evidence,
        });

        expect(observeRevival).toHaveBeenCalledTimes(1);
        expect(observeRevival).toHaveBeenCalledWith(
            expect.objectContaining({
                tick: state.tick,
                cause: 'restart_respawn_policy',
                ts: expect.stringMatching(/\d{4}-\d{2}-\d{2}T/),
            }),
        );

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('does NOT call observeRevival when the resident was never deceased', () => {
        // Regression guard: restart respawn only fires when state had
        // `deceased.cause === 'attention_exhausted'`. A living resident
        // restarting should produce no false revival memory.
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-no-revival-evidence-'));

        const state = stateFor('res:agent');
        state.attention = 50000;
        // no deceased field set
        const stateStore = { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore;

        const observeRevival = jest.fn();
        const evidence: ResidentRuntimeEvidence = {
            store: { appendTrajectory: jest.fn(), appendProgress: jest.fn(), beginSession: jest.fn() } as any,
            sessionId: 'test-session-2',
            trajectory: { recordPatron: jest.fn() } as any,
            library: { observeRevival, observePatron: jest.fn(), observeTrajectory: jest.fn(), observeProgress: jest.fn() } as any,
        };

        new ResidentRuntime({
            soul: soul('res:agent', {
                attentionProfile: { startingAttention: 120000, decayCurve: 'gentle' },
                respawnPolicy: 'on_restart',
            } as Partial<Soul['frontmatter']>),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
            evidence,
        });

        expect(observeRevival).not.toHaveBeenCalled();

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('keeps attention-exhausted residents deceased without explicit restart respawn policy', () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-no-respawn-memory-'));

        const state = stateFor('res:pip');
        state.attention = 0;
        state.deceased = {
            date: '2026-05-24T13:21:19.155Z',
            tick: 53908,
            cause: 'attention_exhausted',
            processed: true,
        };
        const stateStore = { load: jest.fn(() => state), save: jest.fn() } as unknown as RuntimeStateStore;

        new ResidentRuntime({
            soul: soul('res:pip'),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking: thinkingModule(),
        });

        expect(state.attention).toBe(0);
        expect(state.deceased?.cause).toBe('attention_exhausted');
        expect(stateStore.save).toHaveBeenCalledWith(state);

        fs.rmSync(memoryDir, { recursive: true, force: true });
    });

    it('adopts an operator revive written to runtime state while the controller is still running', async () => {
        const memoryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-runtime-operator-revive-memory-'));

        const state = stateFor('res:hans');
        state.attention = 0;
        state.stuckSince = 99;
        state.cognition = {
            activeMove: {
                target: { x: 3200, y: 3200, level: 0 },
                startedAtTick: 90,
                lastTick: 98,
                cause: 'pre_death_move',
            },
        };
        state.deceased = {
            date: '2026-05-24T17:40:00.000Z',
            tick: 99,
            cause: 'attention_exhausted',
            processed: true,
        };
        const externallyRevived = {
            ...state,
            attention: 14000,
            stuckSince: undefined,
            deceased: undefined,
            cognition: { ...state.cognition, activeMove: undefined },
        };
        const stateStore = {
            load: jest.fn().mockReturnValueOnce(state).mockReturnValueOnce(externallyRevived),
            save: jest.fn(),
        } as unknown as RuntimeStateStore;
        const thinking = thinkingModule();

        const runtime = new ResidentRuntime({
            soul: soul('res:hans', {
                attentionProfile: { startingAttention: 14000, decayCurve: 'gentle' },
                respawnPolicy: 'manual',
            } as Partial<Soul['frontmatter']>),
            gateway: {} as GatewayClient,
            memory: { ensureResident: jest.fn(() => memoryDir), retrieve: jest.fn(() => []), write: jest.fn() } as unknown as MemoryStore,
            stateStore,
            llm: {} as LlmClient,
            actionLog: {} as ActionLog,
            inferenceLog: { append: jest.fn() } as unknown as InferenceLog,
            thinking,
        });

        await runtime.onPerception({ tick: 100, events: [] });

        expect(state.deceased).toBeUndefined();
        expect(state.attention).toBeGreaterThan(13900);
        expect(state.stuckSince).toBeUndefined();
        expect(state.cognition?.activeMove).toBeUndefined();
        expect(thinking.think).toHaveBeenCalled();
        expect(stateStore.save).toHaveBeenLastCalledWith(expect.objectContaining({ resident: 'res:hans', deceased: undefined }));

        fs.rmSync(memoryDir, { recursive: true, force: true });
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

function progressPerception(tick: number, x: number, y: number, woodcuttingXp: number, inventoryCount: number, hp: number) {
    return {
        tick,
        resident: {
            position: { x, y, level: 0 },
            inventory: Array.from({ length: inventoryCount }, (_, index) => ({ itemId: 1511, key: `rs:logs:${index}`, amount: 1 })),
            skills: { woodcutting: { xp: woodcuttingXp } },
            hp: { current: hp, max: 10 },
        },
        events: [],
    };
}

function readJsonl(filePath: string): Array<Record<string, unknown>> {
    return fs
        .readFileSync(filePath, 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
}
