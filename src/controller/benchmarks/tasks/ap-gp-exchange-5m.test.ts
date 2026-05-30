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

    it('seeds the resident with real coin item 995 for exchange proof', () => {
        const task = makeApGpExchange5mBenchmarkTask();
        expect(task.resident?.initialInventory).toEqual([{ itemId: 995, amount: 125 }]);
    });

    it('has a run handler', () => {
        const task = makeApGpExchange5mBenchmarkTask();
        expect(typeof task.run).toBe('function');
    });

    it('has an autonomous run handler', () => {
        const task = makeApGpExchange5mBenchmarkTask();
        expect(typeof task.runAutonomous).toBe('function');
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
        perceptions: [],
        events: [],
    };

    it('passes when exchange completes with AP and GP evidence', () => {
        const result = verifyApGpExchange5m({
            ...baseInput,
            actions: [
                {
                    action: { kind: 'city_exchange_ap_gp', cause: 'benchmark:ap-gp-exchange-5m', apAmount: 50, gpAmount: 25 },
                    finalStatus: 'success',
                    result: {
                        ok: true,
                        status: 'complete',
                        apEvidence: { creditedAmount: 50, attentionBefore: 7, attentionAfter: 57 },
                        gpEvidence: { itemId: 995, burnedAmount: 25, remainingAmount: 100 },
                    },
                },
            ],
        });
        expect(result.status).toBe('passed');
        expect(result.score).toBe(1);
        expect(result.metrics).toMatchObject({
            exchangeAttempts: 1,
            exchangeCompleted: 1,
            gpBurned: 25,
            apCredited: 50,
            coinItemId: 995,
        });
    });

    it('fails when no exchange attempt was observed', () => {
        const result = verifyApGpExchange5m({ ...baseInput });
        expect(result.status).toBe('failed');
        expect(result.score).toBe(0);
        expect(result.failureReason).toContain('No AP-for-GP exchange attempt');
    });

    it('fails with partial score when exchange fails for insufficient GP', () => {
        const result = verifyApGpExchange5m({
            ...baseInput,
            actions: [
                {
                    action: { kind: 'city_exchange_ap_gp', cause: 'benchmark:ap-gp-exchange-5m', apAmount: 50, gpAmount: 25 },
                    finalStatus: 'failed',
                    result: { ok: false, status: 'failed_gp', failureReason: 'insufficient_gold' },
                },
            ],
        });
        expect(result.status).toBe('failed');
        expect(result.score).toBe(0.5);
        expect(result.failureReason).toContain('insufficient GP');
    });

    it('fails when exchange status is complete but evidence is malformed', () => {
        const result = verifyApGpExchange5m({
            ...baseInput,
            actions: [
                {
                    action: { kind: 'city_exchange_ap_gp', cause: 'benchmark:ap-gp-exchange-5m', apAmount: 50, gpAmount: 25 },
                    finalStatus: 'success',
                    result: {
                        ok: true,
                        status: 'complete',
                        apEvidence: { creditedAmount: 50, attentionBefore: 7, attentionAfter: 57 },
                        gpEvidence: { itemId: 100, burnedAmount: 25, remainingAmount: 100 },
                    },
                },
            ],
        });
        expect(result.status).toBe('failed');
        expect(result.score).toBe(0.75);
        expect(result.failureReason).toContain('usable GP/AP evidence');
    });

    it('times out when elapsed time exceeds budget', () => {
        const result = verifyApGpExchange5m({
            ...baseInput,
            elapsedMs: AP_GP_EXCHANGE_5M_TIMEOUT_MS + 1,
        });
        expect(result.status).toBe('timeout');
        expect(result.score).toBe(0);
    });
});
