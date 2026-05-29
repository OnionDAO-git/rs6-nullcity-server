import {
    AP_GP_EXCHANGE_5M_TASK_ID,
    AP_GP_EXCHANGE_5M_TASK_VERSION,
    AP_GP_EXCHANGE_5M_TIMEOUT_MS,
    makeApGpExchange5mBenchmarkTask,
    verifyApGpExchange5m,
} from './ap-gp-exchange-5m';

describe('makeApGpExchange5mBenchmarkTask', () => {
    it('returns a task with the correct id', () => {
        const task = makeApGpExchange5mBenchmarkTask();
        expect(task.id).toBe(AP_GP_EXCHANGE_5M_TASK_ID);
    });

    it('returns a task with the correct version', () => {
        const task = makeApGpExchange5mBenchmarkTask();
        expect(task.version).toBe(AP_GP_EXCHANGE_5M_TASK_VERSION);
    });

    it('has a 5-minute timeout', () => {
        const task = makeApGpExchange5mBenchmarkTask();
        expect(task.timeoutMs).toBe(AP_GP_EXCHANGE_5M_TIMEOUT_MS);
        expect(task.timeoutMs).toBe(5 * 60 * 1000);
    });

    it('spawns at a known world position', () => {
        const task = makeApGpExchange5mBenchmarkTask();
        expect(task.resident?.spawnPosition).toEqual({ x: 3222, y: 3218, level: 0 });
    });

    it('has a run handler', () => {
        const task = makeApGpExchange5mBenchmarkTask();
        expect(typeof task.run).toBe('function');
    });

    it('scripted run returns a failed outcome (requires autonomous mode)', async () => {
        const task = makeApGpExchange5mBenchmarkTask();
        const outcome = await task.run({} as Parameters<typeof task.run>[0]);
        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('autonomous mode');
    });
});

describe('verifyApGpExchange5m', () => {
    const baseInput = {
        elapsedMs: 120_000,
        actions: [],
        events: [],
        startingGp: 500,
        startingAp: 20,
        exchangeCompleted: false,
        failedForInsufficientGold: false,
    };

    it('passes when exchange completed', () => {
        const result = verifyApGpExchange5m({ ...baseInput, exchangeCompleted: true });
        expect(result.status).toBe('passed');
        expect(result.score).toBe(1);
    });

    it('fails when exchange not completed and no gold failure', () => {
        const result = verifyApGpExchange5m({ ...baseInput, exchangeCompleted: false });
        expect(result.status).toBe('failed');
        expect(result.score).toBe(0);
        expect(result.failureReason).toContain('No complete city_ap_gp_exchange');
    });

    it('fails with partial score when insufficient gold', () => {
        const result = verifyApGpExchange5m({ ...baseInput, failedForInsufficientGold: true });
        expect(result.status).toBe('failed');
        expect(result.score).toBe(0.5);
        expect(result.failureReason).toContain('insufficient GP');
    });

    it('includes exchange metrics in the result', () => {
        const result = verifyApGpExchange5m({ ...baseInput, exchangeCompleted: true, startingGp: 1000, startingAp: 50 });
        expect(result.metrics).toMatchObject({ startingGp: 1000, startingAp: 50, exchangeCompleted: 1 });
    });

    it('favors insufficient-gold check over no-exchange check', () => {
        const result = verifyApGpExchange5m({ ...baseInput, failedForInsufficientGold: true, exchangeCompleted: false });
        expect(result.score).toBe(0.5);
    });
});
