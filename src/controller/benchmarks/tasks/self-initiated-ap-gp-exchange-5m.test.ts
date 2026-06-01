import {
    SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_ID,
    SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_VERSION,
    SELF_INITIATED_AP_GP_EXCHANGE_5M_TIMEOUT_MS,
    makeSelfInitiatedApGpExchange5mBenchmarkTask,
    verifySelfInitiatedApGpExchange5m,
    type SelfInitiatedApGpExchange5mVerificationInput,
} from './self-initiated-ap-gp-exchange-5m';

const COIN_ITEM_ID = 995;
const SELF_CAUSE = 'nervous:self-initiated-ap-gp-exchange';

function completeSelfInitiatedAttempt() {
    return {
        action: { kind: 'city_exchange_ap_gp', cause: SELF_CAUSE, gpAmount: 50, apAmount: 100 },
        result: {
            ok: true,
            status: 'complete',
            apEvidence: { creditedAmount: 100, attentionBefore: 115, attentionAfter: 215 },
            gpEvidence: { itemId: COIN_ITEM_ID, burnedAmount: 50, remainingAmount: 50 },
        },
    };
}

function baseInput(overrides: Partial<SelfInitiatedApGpExchange5mVerificationInput> = {}): SelfInitiatedApGpExchange5mVerificationInput {
    return {
        elapsedMs: 1000,
        actions: [],
        perceptions: [],
        events: [],
        ...overrides,
    };
}

describe('self-initiated-ap-gp-exchange-5m task wiring', () => {
    it('exposes a stable task id, version, and 5 minute timeout', () => {
        expect(SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_ID).toBe('self-initiated-ap-gp-exchange-5m');
        expect(SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_VERSION).toBe('0.1.0');
        expect(SELF_INITIATED_AP_GP_EXCHANGE_5M_TIMEOUT_MS).toBe(5 * 60 * 1000);
    });

    it('spawns the resident with real coin 995 in inventory', () => {
        const task = makeSelfInitiatedApGpExchange5mBenchmarkTask();
        expect(task.id).toBe(SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_ID);
        const coins = (task.resident?.initialInventory || []).find(
            (entry): entry is { itemId: number; amount: number } =>
                typeof entry === 'object' && entry !== null && (entry as { itemId?: number }).itemId === COIN_ITEM_ID,
        );
        expect(coins).toBeDefined();
        expect(coins!.amount).toBeGreaterThan(0);
    });

    it('fails in scripted mode (requires autonomous live controller)', async () => {
        const task = makeSelfInitiatedApGpExchange5mBenchmarkTask();
        const outcome = await task.run({} as never);
        expect(outcome.status).toBe('failed');
    });
});

describe('verifySelfInitiatedApGpExchange5m', () => {
    it('passes when a self-initiated exchange completes with AP up and GP down', () => {
        const outcome = verifySelfInitiatedApGpExchange5m(baseInput({ actions: [completeSelfInitiatedAttempt()] }));
        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.selfInitiatedAttempts).toBe(1);
        expect(outcome.metrics?.selfInitiatedCompleted).toBe(1);
    });

    it('fails when no exchange action was emitted at all', () => {
        const outcome = verifySelfInitiatedApGpExchange5m(baseInput());
        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.selfInitiatedAttempts).toBe(0);
    });

    it('fails when an exchange completed but was NOT self-initiated (patron/benchmark cause)', () => {
        const patronAttempt = {
            action: { kind: 'city_exchange_ap_gp', cause: 'benchmark:ap-gp-exchange-5m', gpAmount: 25, apAmount: 50 },
            result: {
                ok: true,
                status: 'complete',
                apEvidence: { creditedAmount: 50, attentionBefore: 10, attentionAfter: 60 },
                gpEvidence: { itemId: COIN_ITEM_ID, burnedAmount: 25, remainingAmount: 75 },
            },
        };
        const outcome = verifySelfInitiatedApGpExchange5m(baseInput({ actions: [patronAttempt] }));
        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.selfInitiatedAttempts).toBe(0);
    });

    it('fails when the self-initiated exchange was attempted but never completed', () => {
        const attempt = {
            action: { kind: 'city_exchange_ap_gp', cause: SELF_CAUSE, gpAmount: 50, apAmount: 100 },
            result: { ok: false, status: 'failed_gp', failureReason: 'insufficient_gold' },
        };
        const outcome = verifySelfInitiatedApGpExchange5m(baseInput({ actions: [attempt] }));
        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.selfInitiatedAttempts).toBe(1);
        expect(outcome.metrics?.selfInitiatedCompleted).toBe(0);
    });

    it('fails when the completed exchange lacks an AP increase (post-AP not greater than pre-AP)', () => {
        const attempt = {
            action: { kind: 'city_exchange_ap_gp', cause: SELF_CAUSE, gpAmount: 50, apAmount: 100 },
            result: {
                ok: true,
                status: 'complete',
                apEvidence: { creditedAmount: 0, attentionBefore: 115, attentionAfter: 115 },
                gpEvidence: { itemId: COIN_ITEM_ID, burnedAmount: 50, remainingAmount: 50 },
            },
        };
        const outcome = verifySelfInitiatedApGpExchange5m(baseInput({ actions: [attempt] }));
        expect(outcome.status).toBe('failed');
    });

    it('times out when elapsed exceeds the budget without a completed self-initiated exchange', () => {
        const outcome = verifySelfInitiatedApGpExchange5m(baseInput({ elapsedMs: SELF_INITIATED_AP_GP_EXCHANGE_5M_TIMEOUT_MS + 1 }));
        expect(outcome.status).toBe('timeout');
    });
});
