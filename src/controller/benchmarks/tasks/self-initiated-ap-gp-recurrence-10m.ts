import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';

export const SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_ID = 'self-initiated-ap-gp-recurrence-10m';
export const SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_VERSION = '0.1.0';
export const SELF_INITIATED_AP_GP_RECURRENCE_10M_TIMEOUT_MS = 10 * 60 * 1000;

const COIN_ITEM_ID = 995;
const STARTER_GP = 500;
const START_POSITION = { x: 3222, y: 3218, level: 0 };
const REQUIRED_FULLY_PROVEN_EXCHANGES = 2;

const SELF_INITIATED_EXCHANGE_CAUSE = 'nervous:self-initiated-ap-gp-exchange';

export interface SelfInitiatedApGpRecurrence10mActionAttempt {
    action: AgentAction;
    result?: { ok?: boolean; [key: string]: unknown };
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
}

export interface SelfInitiatedApGpRecurrence10mVerificationInput {
    elapsedMs: number;
    actions: SelfInitiatedApGpRecurrence10mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

function exchangeMetrics(input: SelfInitiatedApGpRecurrence10mVerificationInput): Record<string, number> {
    const selfInitiated = input.actions.filter(isSelfInitiatedExchangeAttempt);
    const completed = selfInitiated.filter(attempt => readExchangeStatus(attempt) === 'complete');
    const fullyProven = completed.filter(attempt => apDelta(attempt) > 0 && gpBurned(attempt) > 0);
    return {
        coinItemId: COIN_ITEM_ID,
        requiredFullyProvenExchanges: REQUIRED_FULLY_PROVEN_EXCHANGES,
        selfInitiatedAttempts: selfInitiated.length,
        selfInitiatedCompleted: completed.length,
        fullyProvenExchanges: fullyProven.length,
        actionsTotal: input.actions.length,
    };
}

export function verifySelfInitiatedApGpRecurrence10m(input: SelfInitiatedApGpRecurrence10mVerificationInput): BenchmarkTaskOutcome {
    const metrics = exchangeMetrics(input);

    if (input.elapsedMs > SELF_INITIATED_AP_GP_RECURRENCE_10M_TIMEOUT_MS) {
        return {
            status: 'timeout',
            score: 0,
            failureReason:
                'self-initiated-ap-gp-recurrence-10m exceeded the 10 minute budget before repeated self-initiated exchanges were proven',
            metrics,
        };
    }

    if (metrics.selfInitiatedAttempts === 0) {
        return {
            status: 'failed',
            score: 0,
            failureReason: 'No resident-initiated AP-for-GP exchange (cause nervous:self-initiated-ap-gp-exchange) was observed',
            metrics,
        };
    }

    if (metrics.selfInitiatedCompleted === 0) {
        return {
            status: 'failed',
            score: 0.5,
            failureReason: 'A self-initiated AP-for-GP exchange was attempted but never completed with both-side evidence',
            metrics,
        };
    }

    if (metrics.fullyProvenExchanges < REQUIRED_FULLY_PROVEN_EXCHANGES) {
        return {
            status: 'failed',
            score: 0.75,
            failureReason:
                'Self-initiated AP-for-GP recurrence not yet proven: need two completed exchanges with AP increase and coin-995 GP burn',
            metrics,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            'self-initiated-ap-gp-recurrence-10m observed repeated resident-initiated AP-for-GP exchanges with AP up and coin-995 GP down.',
        ],
    };
}

export function makeSelfInitiatedApGpRecurrence10mBenchmarkTask(): BenchmarkTask {
    return {
        id: SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_ID,
        version: SELF_INITIATED_AP_GP_RECURRENCE_10M_TASK_VERSION,
        timeoutMs: SELF_INITIATED_AP_GP_RECURRENCE_10M_TIMEOUT_MS,
        autonomousRequiresSelectedModuleAction: false,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: COIN_ITEM_ID, amount: STARTER_GP }],
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason:
                'self-initiated-ap-gp-recurrence-10m requires autonomous mode with a live controller and a low-AP resident holding real GP; run with --mode autonomous',
            metrics: {
                selfInitiatedAttempts: 0,
                selfInitiatedCompleted: 0,
                fullyProvenExchanges: 0,
                requiredFullyProvenExchanges: REQUIRED_FULLY_PROVEN_EXCHANGES,
                actionsTotal: 0,
            },
        }),
        runAutonomous: async context => observeSelfInitiatedExchangeRecurrence(context),
    };
}

async function observeSelfInitiatedExchangeRecurrence(context: BenchmarkTaskContext): Promise<BenchmarkTaskOutcome> {
    const startedAt = Date.now();
    context.recordSummary(
        'Observing benchmark for repeated resident-initiated AP-for-GP exchanges (self-initiated cause + AP increase + coin-995 burn, twice).',
    );
    while (!context.signal.aborted && Date.now() - startedAt < SELF_INITIATED_AP_GP_RECURRENCE_10M_TIMEOUT_MS) {
        const outcome = verifySelfInitiatedApGpRecurrence10m({
            elapsedMs: Date.now() - startedAt,
            actions: [...context.actionAttempts()],
            perceptions: [...context.perceptions()],
            events: [...context.events()],
        });
        if (outcome.status === 'passed') {
            return outcome;
        }
        await sleep(1000, context.signal);
    }
    return verifySelfInitiatedApGpRecurrence10m({
        elapsedMs: Date.now() - startedAt,
        actions: [...context.actionAttempts()],
        perceptions: [...context.perceptions()],
        events: [...context.events()],
    });
}

function isSelfInitiatedExchangeAttempt(attempt: SelfInitiatedApGpRecurrence10mActionAttempt): boolean {
    return attempt.action.kind === 'city_exchange_ap_gp' && attempt.action.cause === SELF_INITIATED_EXCHANGE_CAUSE;
}

function readExchangeStatus(attempt: SelfInitiatedApGpRecurrence10mActionAttempt): string | undefined {
    if (!isRecord(attempt.result)) {
        return undefined;
    }
    const status = attempt.result['status'];
    return typeof status === 'string' ? status : undefined;
}

function apDelta(attempt: SelfInitiatedApGpRecurrence10mActionAttempt): number {
    if (!isRecord(attempt.result) || !isRecord(attempt.result['apEvidence'])) {
        return 0;
    }
    const apEvidence = attempt.result['apEvidence'];
    const before = numericField(apEvidence, 'attentionBefore', 0);
    const after = numericField(apEvidence, 'attentionAfter', 0);
    return after - before;
}

function gpBurned(attempt: SelfInitiatedApGpRecurrence10mActionAttempt): number {
    if (!isRecord(attempt.result) || !isRecord(attempt.result['gpEvidence'])) {
        return 0;
    }
    const gpEvidence = attempt.result['gpEvidence'];
    if (numericField(gpEvidence, 'itemId', 0) !== COIN_ITEM_ID) {
        return 0;
    }
    return numericField(gpEvidence, 'burnedAmount', 0);
}

function numericField(record: Record<string, unknown>, key: string, fallback = 0): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return Promise.resolve();
    }
    return new Promise(resolve => {
        const timeout = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timeout);
                resolve();
            },
            { once: true },
        );
    });
}
