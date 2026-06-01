import {
    SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_ID,
    SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_VERSION,
    SELF_INITIATED_AP_GP_RECURRENCE_10M_TIMEOUT_MS,
    makeSelfInitiatedApGpRecurrence10mBenchmarkTask,
    verifySelfInitiatedApGpRecurrence10m,
    type SelfInitiatedApGpRecurrence10mVerificationInput,
} from './self-initiated-ap-gp-recurrence-10m';

const COIN_ITEM_ID = 995;
const SELF_CAUSE = 'nervous:self-initiated-ap-gp-exchange';

function completeSelfInitiatedAttempt(overrides: Partial<Record<string, number>> = {}) {
    const burnedAmount = overrides.burnedAmount ?? 50;
    const attentionBefore = overrides.attentionBefore ?? 15;
    const attentionAfter = overrides.attentionAfter ?? 115;
    const remainingAmount = overrides.remainingAmount ?? 450;
    return {
        action: { kind: 'city_exchange_ap_gp', cause: SELF_CAUSE, gpAmount: burnedAmount, apAmount: burnedAmount * 2 },
        result: {
            ok: true,
            status: 'complete',
            apEvidence: { creditedAmount: attentionAfter - attentionBefore, attentionBefore, attentionAfter },
            gpEvidence: { itemId: COIN_ITEM_ID, burnedAmount, remainingAmount },
        },
    };
}

function baseInput(
    overrides: Partial<SelfInitiatedApGpRecurrence10mVerificationInput> = {},
): SelfInitiatedApGpRecurrence10mVerificationInput {
    return {
        elapsedMs: 1000,
        actions: [],
        perceptions: [],
        events: [],
        ...overrides,
    };
}

describe('self-initiated-ap-gp-recurrence-10m task wiring', () => {
    it('exposes a stable task id, version, and 10 minute timeout', () => {
        expect(SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_ID).toBe('self-initiated-ap-gp-recurrence-10m');
        expect(SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_VERSION).toBe('0.1.0');
        expect(SELF_INITIATED_AP_GP_RECURRENCE_10M_TIMEOUT_MS).toBe(10 * 60 * 1000);
    });

    it('spawns the resident with enough real coin 995 for repeated exchanges', () => {
        const task = makeSelfInitiatedApGpRecurrence10mBenchmarkTask();
        expect(task.id).toBe(SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_ID);
        const coins = (task.resident?.initialInventory || []).find(
            (entry): entry is { itemId: number; amount: number } =>
                typeof entry === 'object' && entry !== null && (entry as { itemId?: number }).itemId === COIN_ITEM_ID,
        );
        expect(coins).toBeDefined();
        expect(coins!.amount).toBeGreaterThanOrEqual(500);
    });

    it('fails in scripted mode (requires autonomous live controller)', async () => {
        const task = makeSelfInitiatedApGpRecurrence10mBenchmarkTask();
        const outcome = await task.run({} as never);
        expect(outcome.status).toBe('failed');
    });
});

describe('verifySelfInitiatedApGpRecurrence10m', () => {
    it('passes when two self-initiated exchanges complete with AP up and GP down', () => {
        const first = completeSelfInitiatedAttempt({ burnedAmount: 246, attentionBefore: 8, attentionAfter: 500, remainingAmount: 1850 });
        const second = completeSelfInitiatedAttempt({ burnedAmount: 241, attentionBefore: 19, attentionAfter: 501, remainingAmount: 1609 });
        const outcome = verifySelfInitiatedApGpRecurrence10m(baseInput({ actions: [first, second] }));
        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics?.selfInitiatedAttempts).toBe(2);
        expect(outcome.metrics?.fullyProvenExchanges).toBe(2);
    });

    it('fails when no self-initiated exchange action was observed', () => {
        const outcome = verifySelfInitiatedApGpRecurrence10m(baseInput());
        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.selfInitiatedAttempts).toBe(0);
    });

    it('fails when only one self-initiated exchange is fully proven', () => {
        const first = completeSelfInitiatedAttempt({ burnedAmount: 246, attentionBefore: 8, attentionAfter: 500, remainingAmount: 1850 });
        const outcome = verifySelfInitiatedApGpRecurrence10m(baseInput({ actions: [first] }));
        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.fullyProvenExchanges).toBe(1);
    });

    it('times out when elapsed exceeds the 10 minute budget without recurrence proof', () => {
        const outcome = verifySelfInitiatedApGpRecurrence10m(baseInput({ elapsedMs: SELF_INITIATED_AP_GP_RECURRENCE_10M_TIMEOUT_MS + 1 }));
        expect(outcome.status).toBe('timeout');
    });
});
