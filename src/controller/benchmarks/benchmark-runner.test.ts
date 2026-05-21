import { EventEmitter } from 'events';
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
});

class MockBenchmarkGateway extends EventEmitter implements BenchmarkGateway {
    createResident = jest.fn(async () => ({ name: 'bench:make-fire-5m:run-1', online: false }));
    connectResident = jest.fn(async () => ({ name: 'bench:make-fire-5m:run-1', online: true }));
    submitActionWithRequestId = jest.fn(async () => ({ requestId: 'request-1', ackResult: { ok: true } }));
    disconnectResident = jest.fn(async () => undefined);
    deleteResident = jest.fn(async () => undefined);
}

function runner(gateway: BenchmarkGateway, task: BenchmarkTask): BenchmarkRunner {
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
    });
}
