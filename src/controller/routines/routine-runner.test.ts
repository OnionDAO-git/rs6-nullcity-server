import { ROUTINE_CATALOG, type RoutineContext, type RunRoutineRequest, RoutineRunner } from './routine-runner';

describe('RoutineRunner', () => {
    describe('ROUTINE_CATALOG shape', () => {
        it('exposes make_fire as the first whitelisted routine', () => {
            expect(ROUTINE_CATALOG.make_fire).toBeDefined();
            expect(ROUTINE_CATALOG.make_fire.id).toBe('make_fire');
            expect(typeof ROUTINE_CATALOG.make_fire.impl).toBe('function');
        });

        it('each routine entry has a Zod paramSchema', () => {
            for (const [id, entry] of Object.entries(ROUTINE_CATALOG)) {
                expect(entry.paramSchema).toBeDefined();
                expect(typeof entry.paramSchema.parse).toBe('function');
                expect(entry.id).toBe(id);
            }
        });
    });

    describe('RoutineRunner.run — request validation', () => {
        function makeRunner() {
            return new RoutineRunner({
                runtimes: new Map(),
            });
        }

        it('rejects when the resident is not registered (status=rejected, lastError=resident_not_found)', async () => {
            const runner = makeRunner();
            const result = await runner.run({ resident: 'res:nobody', routine: 'make_fire' });
            expect(result.status).toBe('rejected');
            expect(result.lastError).toBe('resident_not_found');
            expect(result.ticksUsed).toBe(0);
        });

        it('rejects when the routine is not in the catalog (status=rejected, lastError=routine_not_whitelisted)', async () => {
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', mockRuntime()]]) });
            const result = await runner.run({
                resident: 'res:agent',
                routine: 'unknown_routine' as any,
            });
            expect(result.status).toBe('rejected');
            expect(result.lastError).toBe('routine_not_whitelisted');
        });

        it('rejects when maxTicks is out of [1, 1200] range', async () => {
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', mockRuntime()]]) });
            const tooSmall = await runner.run({ resident: 'res:agent', routine: 'make_fire', maxTicks: 0 });
            expect(tooSmall.lastError).toBe('maxticks_out_of_range');
            const tooBig = await runner.run({ resident: 'res:agent', routine: 'make_fire', maxTicks: 1500 });
            expect(tooBig.lastError).toBe('maxticks_out_of_range');
        });

        it('accepts default maxTicks (200) when not provided', async () => {
            const runtime = mockRuntime();
            runtime.tick = jest.fn().mockResolvedValue('completed');
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', runtime]]) });
            const result = await runner.run({ resident: 'res:agent', routine: 'make_fire' });
            expect(result.status).toBe('completed');
        });
    });

    describe('make_fire impl — completed path', () => {
        it('returns status=completed when the runtime tick yields fire_lit signal', async () => {
            const runtime = mockRuntime();
            runtime.tick = jest.fn().mockResolvedValueOnce('completed');
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', runtime]]) });

            const result = await runner.run({ resident: 'res:agent', routine: 'make_fire', maxTicks: 100 });

            expect(result.status).toBe('completed');
            expect(result.ticksUsed).toBe(1);
            expect(result.effectEvidenceCount).toBeGreaterThanOrEqual(1);
            expect(runtime.tick).toHaveBeenCalled();
        });
    });

    describe('make_fire impl — stuck path', () => {
        it('returns status=stuck when 3 consecutive no-progress ticks elapse', async () => {
            const runtime = mockRuntime();
            runtime.tick = jest.fn().mockResolvedValue('no_progress');
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', runtime]]) });

            const result = await runner.run({ resident: 'res:agent', routine: 'make_fire', maxTicks: 100 });

            expect(result.status).toBe('stuck');
            expect(result.ticksUsed).toBe(3);
            expect(runtime.tick).toHaveBeenCalledTimes(3);
        });
    });

    describe('make_fire impl — timeout path', () => {
        it('returns status=timeout when maxTicks elapses without completion or 3-tick stuck pattern', async () => {
            // tick alternates 'progress' (resets stuck counter) for the entire budget.
            const runtime = mockRuntime();
            runtime.tick = jest.fn().mockResolvedValue('progress');
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', runtime]]) });

            const result = await runner.run({ resident: 'res:agent', routine: 'make_fire', maxTicks: 5 });

            expect(result.status).toBe('timeout');
            expect(result.ticksUsed).toBe(5);
        });
    });

    describe('make_fire impl — preempted path', () => {
        it('returns status=preempted with lastError when Nervous System takes the action slot', async () => {
            const runtime = mockRuntime();
            runtime.tick = jest.fn().mockResolvedValueOnce({ preempted: 'nervous_flee_when_outmatched' });
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', runtime]]) });

            const result = await runner.run({ resident: 'res:agent', routine: 'make_fire', maxTicks: 100 });

            expect(result.status).toBe('preempted');
            expect(result.lastError).toBe('nervous_flee_when_outmatched');
        });
    });

    describe('AbortSignal cancellation', () => {
        it('returns status=preempted with lastError=aborted when the caller aborts', async () => {
            const runtime = mockRuntime();
            runtime.tick = jest.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve('progress'), 50)));
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', runtime]]) });
            const controller = new AbortController();

            const promise = runner.run({
                resident: 'res:agent',
                routine: 'make_fire',
                maxTicks: 100,
                signal: controller.signal,
            } satisfies RunRoutineRequest);
            // Abort after one tick has started.
            setTimeout(() => controller.abort(), 10);
            const result = await promise;

            expect(result.status).toBe('preempted');
            expect(result.lastError).toBe('aborted');
        });
    });

    describe('trajectoryHints collection', () => {
        it("populates trajectoryHints with the routine's labeled hints across ticks", async () => {
            const runtime = mockRuntime();
            runtime.tick = jest.fn().mockImplementation(async (_ctx: RoutineContext) => {
                runtime._lastHints = ['tinderbox_used'];
                return 'completed';
            });
            const runner = new RoutineRunner({ runtimes: new Map([['res:agent', runtime]]) });

            const result = await runner.run({ resident: 'res:agent', routine: 'make_fire', maxTicks: 100 });

            expect(result.status).toBe('completed');
            expect(result.trajectoryHints).toEqual(expect.arrayContaining(['tinderbox_used']));
        });
    });
});

/**
 * Minimal runtime stub used by RoutineRunner. The real RoutineRunner will
 * accept an interface; this stub satisfies it via a sentinel-string contract:
 *   runtime.tick(ctx) returns:
 *     - 'completed' → routine finishes
 *     - 'progress'  → keep going, reset stuck counter
 *     - 'no_progress' → keep going, increment stuck counter
 *     - { preempted: <lastError-string> } → routine preempts
 *
 * The contract test below verifies the wire shape.
 */
function mockRuntime(): any {
    return {
        _lastHints: [] as string[],
        tick: jest.fn().mockResolvedValue('progress'),
    };
}
