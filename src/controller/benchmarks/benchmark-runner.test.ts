import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BenchmarkRunner, type BenchmarkGateway, type BenchmarkTask } from './benchmark-runner';

describe('BenchmarkRunner', () => {
    it('creates a disposable resident, runs a bounded task, records evidence, and cleans up', async () => {
        const gateway = new MockBenchmarkGateway();
        const residentName = expect.stringMatching(/^res:bmk_fire_5m_[a-z0-9]{8}$/);
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            resident: {
                spawnPosition: { x: 3235, y: 3235, level: 0 },
                initialInventory: ['tinderbox', 'logs'],
            },
            run: async context => {
                context.recordSummary('Submitted visible hello action.');
                await context.submitAction({ kind: 'say', text: 'benchmark hello' });
                return { status: 'passed', score: 1, metrics: { actionsAttempted: 1 } };
            },
        };

        const artifact = await runner(gateway, task).run();

        expect(gateway.createResident).toHaveBeenCalledWith({
            name: residentName,
            spawnPosition: { x: 3235, y: 3235, level: 0 },
            initialInventory: ['tinderbox', 'logs'],
        });
        expect(gateway.connectResident).toHaveBeenCalledWith({
            name: residentName,
            observe: true,
            control: true,
            onDisconnect: 'idle',
        });
        expect(gateway.submitActionWithRequestId).toHaveBeenCalledWith(residentName, {
            kind: 'say',
            text: 'benchmark hello',
        });
        expect(gateway.disconnectResident).toHaveBeenCalledWith(residentName);
        expect(gateway.deleteResident).toHaveBeenCalledWith(residentName);
        expect(artifact.status).toBe('passed');
        expect(artifact.resident).toMatch(/^res:bmk_fire_5m_[a-z0-9]{8}$/);
        expect(artifact.evidence.actionAttemptIds).toEqual(['request-1']);
        expect(artifact.evidence.summaries).toContain('Submitted visible hello action.');
    });

    it('times out and still cleans up the disposable resident', async () => {
        const gateway = new MockBenchmarkGateway();
        const residentName = expect.stringMatching(/^res:bmk_fire_5m_[a-z0-9]{8}$/);
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 1,
            run: () => new Promise(() => undefined),
        };

        const artifact = await runner(gateway, task).run();

        expect(artifact.status).toBe('timeout');
        expect(artifact.failureReason).toContain('timed out');
        expect(gateway.disconnectResident).toHaveBeenCalledWith(residentName);
        expect(gateway.deleteResident).toHaveBeenCalledWith(residentName);
    });

    it('deduplicates action attempt evidence when action events arrive before submit acknowledgements resolve', async () => {
        const gateway = new MockBenchmarkGateway();
        (gateway.submitActionWithRequestId as jest.Mock).mockImplementation(async resident => {
            gateway.emit('actionResult', resident, 'request-1', { ok: true });
            return { requestId: 'request-1', ackResult: { ok: true } };
        });
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: async context => {
                await context.submitAction({ kind: 'say', text: 'benchmark hello' });
                return { status: 'passed', score: 1 };
            },
        };

        const artifact = await runner(gateway, task).run();

        expect(artifact.evidence.actionAttemptIds).toEqual(['request-1']);
        expect(artifact.metrics.actionsAttempted).toBe(1);
    });

    it('preserves cleanup failures in non-passing benchmark artifacts', async () => {
        const gateway = new MockBenchmarkGateway();
        gateway.deleteResident.mockRejectedValue(new Error('delete disabled'));
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 1,
            run: () => new Promise(() => undefined),
        };

        const artifact = await runner(gateway, task).run();

        expect(artifact.status).toBe('timeout');
        expect(artifact.failureReason).toContain('timed out');
        expect(artifact.failureReason).toContain('cleanup failed: delete disabled');
        expect(artifact.evidence.summaries).toContain('cleanup failed: delete disabled');
    });

    it('preserves task success when cleanup fails and records the cleanup problem as evidence', async () => {
        const gateway = new MockBenchmarkGateway();
        gateway.deleteResident.mockRejectedValue(new Error('delete disabled'));
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: async () => ({ status: 'passed', score: 1, metrics: { successEvents: 1 } }),
        };

        const artifact = await runner(gateway, task).run();

        expect(artifact.status).toBe('passed');
        expect(artifact.score).toBe(1);
        expect(artifact.failureReason).toBeUndefined();
        expect(artifact.metrics.cleanupFailures).toBe(1);
        expect(artifact.evidence.summaries).toContain('cleanup failed: delete disabled');
    });

    it('records gateway delete-disabled cleanup as skipped instead of failed', async () => {
        const gateway = new MockBenchmarkGateway();
        gateway.deleteResident.mockRejectedValue(new Error('EDELETE_DISABLED'));
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: async () => ({ status: 'passed', score: 1, metrics: { successEvents: 1 } }),
        };

        const artifact = await runner(gateway, task).run();

        expect(artifact.status).toBe('passed');
        expect(artifact.failureReason).toBeUndefined();
        expect(artifact.metrics.cleanupFailures).toBeUndefined();
        expect(artifact.metrics.cleanupSkipped).toBe(1);
        expect(artifact.evidence.summaries).toContain('cleanup skipped: delete disabled for 1 disposable resident');
    });

    it('keeps non-passing benchmark failure reasons focused when delete is disabled locally', async () => {
        const gateway = new MockBenchmarkGateway();
        gateway.deleteResident.mockRejectedValue(new Error('EDELETE_DISABLED'));
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 1,
            run: () => new Promise(() => undefined),
        };

        const artifact = await runner(gateway, task).run();

        expect(artifact.status).toBe('timeout');
        expect(artifact.failureReason).toContain('timed out');
        expect(artifact.failureReason).not.toContain('cleanup');
        expect(artifact.metrics.cleanupSkipped).toBe(1);
        expect(artifact.evidence.summaries).toContain('cleanup skipped: delete disabled for 1 disposable resident');
    });

    it('records gateway-client formatted delete-disabled cleanup as skipped', async () => {
        const gateway = new MockBenchmarkGateway();
        gateway.deleteResident.mockRejectedValue(new Error('EDELETE_DISABLED: EDELETE_DISABLED'));
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: async () => ({ status: 'passed', score: 1 }),
        };

        const artifact = await runner(gateway, task).run();

        expect(artifact.status).toBe('passed');
        expect(artifact.metrics.cleanupSkipped).toBe(1);
        expect(artifact.metrics.cleanupFailures).toBeUndefined();
    });

    it('counts delete-disabled cleanup skips for both disposable peer and resident', async () => {
        const gateway = new MockBenchmarkGateway();
        gateway.deleteResident.mockRejectedValue(new Error('EDELETE_DISABLED'));
        const task: BenchmarkTask = {
            id: 'follow-and-chat-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            peers: [{ id: 'codex' }],
            run: async () => ({ status: 'passed', score: 1 }),
        };

        const artifact = await runner(gateway, task).run();

        expect(gateway.deleteResident).toHaveBeenCalledTimes(2);
        expect(artifact.metrics.cleanupSkipped).toBe(2);
        expect(artifact.evidence.summaries).toContain('cleanup skipped: delete disabled for 2 disposable residents');
    });

    it('uses recorded evidence as the canonical attempted action count', async () => {
        const gateway = new MockBenchmarkGateway();
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: async context => {
                await context.submitAction({ kind: 'say', text: 'benchmark hello' });
                return { status: 'passed', score: 1, metrics: { actionsAttempted: 99 } };
            },
        };

        const artifact = await runner(gateway, task).run();

        expect(artifact.metrics.actionsAttempted).toBe(1);
    });

    it('fails autonomous passes whose action evidence is untagged or from another module', async () => {
        const gateway = new MockBenchmarkGateway();
        const autonomousRuntime = {
            start: jest.fn(async context => {
                context.recordActionAttempt({
                    requestId: 'other-module-action',
                    action: { kind: 'say', text: 'not selected' },
                    result: { ok: true },
                    source: 'thinking',
                    sparkModule: { id: 'onion.other', version: '0.1.0' },
                });
                context.recordActionAttempt({
                    requestId: 'untagged-action',
                    action: { kind: 'say', text: 'untagged' },
                    result: { ok: true },
                    source: 'workflow',
                });
            }),
            stop: jest.fn(async () => undefined),
        };
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: async () => ({ status: 'passed', score: 1 }),
            runAutonomous: async () => ({ status: 'passed', score: 1 }),
        };

        const artifact = await runner(gateway, task, { mode: 'autonomous', autonomousRuntime }).run();

        expect(artifact.status).toBe('failed');
        expect(artifact.failureReason).toContain('without selected module action evidence');
        expect(artifact.metrics.selectedModuleActions).toBe(0);
        expect(artifact.metrics.untaggedActions).toBe(1);
        expect(artifact.metrics.actionsAttempted).toBe(2);
    });

    it('allows explicit benchmark-side autonomous proof tasks to pass without selected module action evidence', async () => {
        const gateway = new MockBenchmarkGateway();
        const autonomousRuntime = {
            start: jest.fn(async context => {
                context.recordActionAttempt({
                    requestId: 'controlled-economy-action',
                    action: { kind: 'city_exchange_ap_gp', cause: 'benchmark:ap-gp-exchange-5m', gpAmount: 25, apAmount: 50 },
                    result: { ok: true, status: 'complete' },
                    source: 'benchmark',
                });
            }),
            stop: jest.fn(async () => undefined),
        };
        const task: BenchmarkTask = {
            id: 'ap-gp-exchange-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            autonomousRequiresSelectedModuleAction: false,
            run: async () => ({ status: 'passed', score: 1 }),
            runAutonomous: async () => ({ status: 'passed', score: 1 }),
        };

        const artifact = await runner(gateway, task, { mode: 'autonomous', autonomousRuntime }).run();

        expect(artifact.status).toBe('passed');
        expect(artifact.score).toBe(1);
        expect(artifact.failureReason).toBeUndefined();
        expect(artifact.metrics.selectedModuleActions).toBe(0);
        expect(artifact.metrics.untaggedActions).toBe(1);
        expect(artifact.evidence.summaries).toContain(
            'Autonomous benchmark ap-gp-exchange-5m uses benchmark-side evidence and does not require selected module action evidence.',
        );
    });

    it('passes autonomous selected-module actions without inference evidence and records the inference metric', async () => {
        const gateway = new MockBenchmarkGateway();
        const module = { id: 'onion.runescape.standard', version: '0.1.0' };
        const autonomousRuntime = {
            start: jest.fn(async context => {
                context.recordActionAttempt({
                    requestId: 'selected-module-action',
                    action: { kind: 'say', text: 'selected module action' },
                    result: { ok: true },
                    source: 'thinking',
                    sparkModule: module,
                });
            }),
            stop: jest.fn(async () => undefined),
        };
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: async () => ({ status: 'passed', score: 1 }),
            runAutonomous: async () => ({ status: 'passed', score: 1 }),
        };

        const artifact = await runner(gateway, task, { mode: 'autonomous', autonomousRuntime, module }).run();

        expect(artifact.status).toBe('passed');
        expect(artifact.failureReason).toBeUndefined();
        expect(artifact.score).toBe(1);
        expect(artifact.metrics.selectedModuleActions).toBe(1);
        expect(artifact.metrics.selectedModuleInferences).toBe(0);
    });

    it('can run an autonomous runtime instead of submitting scripted task actions', async () => {
        const gateway = new MockBenchmarkGateway();
        const module = { id: 'onion.runescape.standard', version: '0.1.0' };
        const autonomousRuntime = {
            start: jest.fn(async context => {
                context.recordInferenceRequest({ cause: 'thinking_started', sparkModule: module });
                context.recordInferenceRequest({ requestId: 'infer-1', cause: 'body_tick', sparkModule: module });
                context.recordArtifactPath('/tmp/nullcity-benchmark/evidence/trajectory/current');
                context.recordArtifactPath('/tmp/nullcity-benchmark/evidence/progress/current');
                context.recordActionAttempt({
                    requestId: 'auto-action-1',
                    action: { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'agent_make_fire' },
                    result: { ok: true },
                    source: 'thinking',
                    sparkModule: module,
                    finalStatus: 'success',
                    attentionAfter: 99.5,
                    evidence: [
                        {
                            source: 'perception',
                            detail: {
                                kind: 'action_effect_observed',
                                actionKind: 'use_item_on_item',
                                changed: ['inventory', 'nearbyWorldItems'],
                            },
                        },
                    ],
                });
                context.recordSummary('Autonomous runtime produced make-fire evidence.');
            }),
            stop: jest.fn(async () => undefined),
        };
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: jest.fn(async context => {
                await context.submitAction({ kind: 'say', text: 'scripted path should not run' });
                return { status: 'passed' as const, score: 1 };
            }),
            runAutonomous: jest.fn(async context => ({
                status: 'passed' as const,
                score: 0.8,
                metrics: { autonomousActions: context.actionAttempts().length },
                summaries: ['Autonomous verifier saw module evidence.'],
            })),
        };

        const artifact = await runner(gateway, task, { mode: 'autonomous', autonomousRuntime, module }).run();

        expect(task.run).not.toHaveBeenCalled();
        expect(task.runAutonomous).toHaveBeenCalledTimes(1);
        expect(gateway.submitActionWithRequestId).not.toHaveBeenCalled();
        expect(autonomousRuntime.start).toHaveBeenCalledWith(
            expect.objectContaining({
                resident: expect.stringMatching(/^res:bmk_fire_5m_[a-z0-9]{8}$/),
                task,
                module,
            }),
        );
        expect(autonomousRuntime.stop).toHaveBeenCalledWith('benchmark_complete');
        expect(artifact.mode).toBe('autonomous');
        expect(artifact.metrics.autonomousActions).toBe(1);
        expect(artifact.metrics.selectedModuleInferences).toBe(1);
        expect(artifact.evidence.actionAttemptIds).toEqual(['auto-action-1']);
        expect(artifact.evidence.actionAttempts).toEqual([
            expect.objectContaining({
                requestId: 'auto-action-1',
                actionKind: 'use_item_on_item',
                source: 'thinking',
                finalStatus: 'success',
                effectEvidenceCount: 1,
                attentionAfter: 99.5,
                sparkModule: module,
            }),
        ]);
        expect(artifact.evidence.inferenceRequestIds).toEqual(['infer-1']);
        expect(artifact.evidence.inferenceRequests).toEqual([
            expect.objectContaining({
                cause: 'thinking_started',
                sparkModule: module,
            }),
            expect.objectContaining({
                requestId: 'infer-1',
                cause: 'body_tick',
                sparkModule: module,
            }),
        ]);
        expect(artifact.evidence.artifactPaths).toEqual([
            '/tmp/nullcity-benchmark/evidence/trajectory/current',
            '/tmp/nullcity-benchmark/evidence/progress/current',
        ]);
        expect(artifact.evidence.summaries).toContain('Autonomous runtime produced make-fire evidence.');
        expect(artifact.evidence.summaries).toContain('Autonomous verifier saw module evidence.');
    });

    it('runs task setup before starting autonomous runtime', async () => {
        const gateway = new MockBenchmarkGateway();
        const order: string[] = [];
        const module = { id: 'onion.runescape.standard', version: '0.1.0' };
        const autonomousRuntime = {
            start: jest.fn(async context => {
                order.push('runtime:start');
                context.recordActionAttempt({
                    requestId: 'auto-action-1',
                    action: { kind: 'say', text: 'ready after setup' },
                    result: { ok: true },
                    source: 'thinking',
                    sparkModule: module,
                });
            }),
            stop: jest.fn(async () => undefined),
        };
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            setup: jest.fn(async context => {
                order.push('setup');
                await context.submitAction({ kind: 'drop', slot: 0, cause: 'benchmark_seed_ground_item' });
            }),
            run: jest.fn(async () => ({ status: 'passed' as const, score: 1 })),
            runAutonomous: jest.fn(async () => {
                order.push('runAutonomous');
                return { status: 'passed' as const, score: 1 };
            }),
        };

        const artifact = await runner(gateway, task, { mode: 'autonomous', autonomousRuntime, module }).run();

        expect(order).toEqual(['setup', 'runtime:start', 'runAutonomous']);
        expect(gateway.submitActionWithRequestId).toHaveBeenCalledWith(expect.any(String), {
            kind: 'drop',
            slot: 0,
            cause: 'benchmark_seed_ground_item',
        });
        expect(artifact.status).toBe('passed');
        expect(artifact.metrics.untaggedActions).toBe(1);
        expect(artifact.metrics.selectedModuleActions).toBe(1);
    });

    it('lets setup seed inventory after the disposable resident is connected', async () => {
        const gateway = new MockBenchmarkGateway();
        const task: BenchmarkTask = {
            id: 'low-health-cook-eat-reengage-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            setup: jest.fn(async context => {
                await context.ensureInventoryItem?.({ itemId: 317 }, 1);
                await context.ensureInventoryItem?.({ itemId: 590 }, 1);
            }),
            run: jest.fn(async () => ({ status: 'passed' as const, score: 1 })),
        };

        const artifact = await runner(gateway, task).run();
        const residentName = expect.stringMatching(/^res:bmk_low_hea_[a-z0-9]{8}$/);

        expect(gateway.ensureInventoryItem).toHaveBeenCalledWith(residentName, { itemId: 317 }, 1);
        expect(gateway.ensureInventoryItem).toHaveBeenCalledWith(residentName, { itemId: 590 }, 1);
        expect(gateway.submitActionWithRequestId).not.toHaveBeenCalled();
        expect(artifact.status).toBe('passed');
    });

    it('copies inference metadata into benchmark artifacts', async () => {
        const gateway = new MockBenchmarkGateway();
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: jest.fn(async () => ({ status: 'passed' as const, score: 1 })),
        };

        const artifact = await runner(gateway, task, {
            inference: {
                profileId: 'qwopus',
                endpointId: 'spacetower',
                provider: 'openai-compatible',
                baseUrl: 'http://spacetower.nullcity.ai:8100',
                model: 'qwopus3.5-27b-v3@q4_k_s',
            },
        }).run();

        expect(artifact.inference).toEqual({
            profileId: 'qwopus',
            endpointId: 'spacetower',
            provider: 'openai-compatible',
            baseUrl: 'http://spacetower.nullcity.ai:8100',
            model: 'qwopus3.5-27b-v3@q4_k_s',
        });
    });

    it('summarizes runtime trajectory and progress artifact metrics for autonomous benchmarks', async () => {
        const gateway = new MockBenchmarkGateway();
        const module = { id: 'onion.runescape.standard', version: '0.1.0' };
        const evidenceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'benchmark-evidence-summary-'));
        const trajectoryPath = path.join(evidenceDir, 'trajectory.jsonl');
        const progressPath = path.join(evidenceDir, 'progress.jsonl');
        fs.writeFileSync(
            trajectoryPath,
            [
                JSON.stringify({ kind: 'begin_tick', tick: 1 }),
                JSON.stringify({ kind: 'say', tick: 1 }),
                JSON.stringify({ kind: 'action', tick: 2 }),
                JSON.stringify({ kind: 'end_tick', tick: 2 }),
            ].join('\n'),
        );
        fs.writeFileSync(
            progressPath,
            [
                JSON.stringify({ kind: 'progress', tick: 1, meaningful: true, stuckSince: null }),
                JSON.stringify({ kind: 'progress', tick: 2, meaningful: true, stuckSince: null }),
                JSON.stringify({ kind: 'progress', tick: 3, meaningful: false, stuckSince: 3 }),
            ].join('\n'),
        );
        const autonomousRuntime = {
            start: jest.fn(async context => {
                context.recordArtifactPath(trajectoryPath);
                context.recordArtifactPath(progressPath);
                context.recordActionAttempt({
                    requestId: 'auto-action-1',
                    action: { kind: 'say', text: 'checking evidence' },
                    result: { ok: true },
                    source: 'thinking',
                    sparkModule: module,
                });
            }),
            stop: jest.fn(async () => undefined),
        };
        const task: BenchmarkTask = {
            id: 'make-fire-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            run: jest.fn(async () => ({ status: 'passed' as const, score: 1 })),
            runAutonomous: jest.fn(async () => ({ status: 'passed' as const, score: 1 })),
        };

        const artifact = await runner(gateway, task, { mode: 'autonomous', autonomousRuntime, module }).run();

        expect(artifact.metrics.trajectoryLines).toBe(4);
        expect(artifact.metrics.trajectoryActions).toBe(2);
        expect(artifact.metrics.trajectorySays).toBe(1);
        expect(artifact.metrics.progressLines).toBe(3);
        expect(artifact.metrics.meaningfulProgressTicks).toBe(2);
        expect(artifact.metrics.stuckProgressTicks).toBe(1);
    });

    it('creates disposable peer residents and keeps peer actions out of agent action evidence', async () => {
        const gateway = new MockBenchmarkGateway();
        (gateway.submitActionWithRequestId as jest.Mock).mockImplementation(async (_resident, action) => ({
            requestId: action.kind === 'say' && action.text === 'agent follow me' ? 'peer-request-1' : 'agent-request-1',
            ackResult: { ok: true },
        }));
        const residentName = expect.stringMatching(/^res:bmk_follow_[a-z0-9]{8}$/);
        const peerName = expect.stringMatching(/^res:bmk_codex_[a-z0-9]{8}$/);
        const task: BenchmarkTask = {
            id: 'follow-and-chat-5m',
            version: '0.1.0',
            timeoutMs: 5000,
            resident: {
                spawnPosition: { x: 3225, y: 3230, level: 0 },
            },
            peers: [
                {
                    id: 'codex',
                    spawnPosition: { x: 3229, y: 3230, level: 0 },
                },
            ],
            run: async context => {
                expect(context.peerResident('codex')).toEqual(peerName);
                await context.submitPeerAction('codex', { kind: 'say', text: 'agent follow me' });
                await context.submitAction({ kind: 'say', text: 'I heard you' });
                return { status: 'passed', score: 1 };
            },
        };

        const artifact = await runner(gateway, task).run();

        expect(gateway.createResident).toHaveBeenCalledWith({
            name: residentName,
            spawnPosition: { x: 3225, y: 3230, level: 0 },
        });
        expect(gateway.createResident).toHaveBeenCalledWith({
            name: peerName,
            spawnPosition: { x: 3229, y: 3230, level: 0 },
        });
        expect(gateway.connectResident).toHaveBeenCalledWith({
            name: peerName,
            observe: false,
            control: true,
            onDisconnect: 'idle',
        });
        expect(gateway.submitActionWithRequestId).toHaveBeenCalledWith(peerName, { kind: 'say', text: 'agent follow me' });
        expect(gateway.submitActionWithRequestId).toHaveBeenCalledWith(residentName, { kind: 'say', text: 'I heard you' });
        expect(gateway.disconnectResident).toHaveBeenCalledWith(peerName);
        expect(gateway.deleteResident).toHaveBeenCalledWith(peerName);
        expect(artifact.status).toBe('passed');
        expect(artifact.evidence.actionAttemptIds).toEqual(['agent-request-1']);
        expect(artifact.metrics.actionsAttempted).toBe(1);
    });
});

class MockBenchmarkGateway extends EventEmitter implements BenchmarkGateway {
    createResident = jest.fn(async () => ({ name: 'bench:make-fire-5m:run-1', online: false }));
    connectResident = jest.fn(async () => ({ name: 'bench:make-fire-5m:run-1', online: true }));
    submitActionWithRequestId = jest.fn(async () => ({ requestId: 'request-1', ackResult: { ok: true } }));
    ensureInventoryItem = jest.fn(async () => ({ resident: 'bench:make-fire-5m:run-1', itemId: 317, requestedAmount: 1, previousAmount: 0, amount: 1, addedAmount: 1 }));
    disconnectResident = jest.fn(async () => undefined);
    deleteResident = jest.fn(async () => undefined);
}

function runner(
    gateway: BenchmarkGateway,
    task: BenchmarkTask,
    overrides: Partial<ConstructorParameters<typeof BenchmarkRunner>[0]> = {},
): BenchmarkRunner {
    return new BenchmarkRunner({
        gateway,
        task,
        runId: 'run-1',
        module: { id: 'onion.runescape.standard', version: '0.1.0' },
        modelProfile: 'local-qwen-body',
        commits: [{ repo: 'rs6-nullcity-server', sha: '8e9dfa956aa0ec049bd389b42f43d14089baf8c3' }],
        now: (() => {
            let tick = 0;
            return () => new Date(Date.UTC(2026, 4, 20, 10, 0, tick++));
        })(),
        ...overrides,
    });
}
