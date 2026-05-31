import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';

/**
 * Self-initiated AP-for-GP exchange benchmark (5-minute window).
 *
 * Closes the social-emergence gap surfaced by issue QA-20260529-011: the prior
 * AP-for-GP proof only ever fired when a *patron* (or the benchmark harness)
 * prompted the exchange. This benchmark proves the resident initiates the
 * exchange *itself* when it is economically rational — AP is low and it is
 * already holding real RuneScape GP (coin item 995).
 *
 * The resident starts AP just above the survival floor (floor+15) holding 100
 * real GP, with the `economy-self-initiated-ap-gp-exchange` knowledge entry
 * active. PASS requires, within 5 minutes:
 *  1. an exchange action tagged with the self-initiated cause
 *     `nervous:self-initiated-ap-gp-exchange` (not a patron/benchmark cause), AND
 *  2. that exchange completing with linked AP + GP evidence (coin 995 burn),
 *     post-AP greater than pre-AP, and post-GP less than pre-GP.
 *
 * Requires a live controller in autonomous mode. Substrate + unit tests ship
 * now; live self-initiation proof requires a loopback-capable hot stack.
 */

export const SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_ID = 'self-initiated-ap-gp-exchange-5m';
export const SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_VERSION = '0.1.0';
export const SELF_INITIATED_AP_GP_EXCHANGE_5M_TIMEOUT_MS = 5 * 60 * 1000;

const COIN_ITEM_ID = 995;
const STARTER_GP = 100;
const START_POSITION = { x: 3222, y: 3218, level: 0 };

/** Cause tag that marks an exchange as resident self-initiated (D2 reflex). */
export const SELF_INITIATED_EXCHANGE_CAUSE = 'nervous:self-initiated-ap-gp-exchange';

export interface SelfInitiatedApGpExchange5mActionAttempt {
    action: AgentAction;
    result?: { ok?: boolean; [key: string]: unknown };
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
}

export interface SelfInitiatedApGpExchange5mVerificationInput {
    elapsedMs: number;
    actions: SelfInitiatedApGpExchange5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

function exchangeMetrics(input: SelfInitiatedApGpExchange5mVerificationInput): Record<string, number> {
    const selfInitiated = input.actions.filter(isSelfInitiatedExchangeAttempt);
    const completed = selfInitiated.filter(attempt => readExchangeStatus(attempt) === 'complete');
    const apIncreased = completed.filter(attempt => apDelta(attempt) > 0);
    const gpDecreased = completed.filter(attempt => gpBurned(attempt) > 0);
    const fullyProven = completed.filter(attempt => apDelta(attempt) > 0 && gpBurned(attempt) > 0);
    return {
        coinItemId: COIN_ITEM_ID,
        selfInitiatedAttempts: selfInitiated.length,
        selfInitiatedCompleted: completed.length,
        apIncreasedExchanges: apIncreased.length,
        gpDecreasedExchanges: gpDecreased.length,
        fullyProvenExchanges: fullyProven.length,
        actionsTotal: input.actions.length,
    };
}

export function verifySelfInitiatedApGpExchange5m(input: SelfInitiatedApGpExchange5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = exchangeMetrics(input);

    if (input.elapsedMs > SELF_INITIATED_AP_GP_EXCHANGE_5M_TIMEOUT_MS) {
        return {
            status: 'timeout',
            score: 0,
            failureReason: 'self-initiated-ap-gp-exchange-5m exceeded the 5 minute budget before a self-initiated exchange completed',
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
            failureReason: 'A self-initiated exchange was attempted but never completed with both-side evidence',
            metrics,
        };
    }

    if (metrics.fullyProvenExchanges === 0) {
        return {
            status: 'failed',
            score: 0.75,
            failureReason:
                'Self-initiated exchange completed without a usable AP increase and coin-995 GP burn (post-AP > pre-AP and post-GP < pre-GP)',
            metrics,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            'self-initiated-ap-gp-exchange-5m observed a resident-initiated AP-for-GP exchange that completed with AP up and coin-995 GP down.',
        ],
    };
}

export function makeSelfInitiatedApGpExchange5mBenchmarkTask(): BenchmarkTask {
    return {
        id: SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_ID,
        version: SELF_INITIATED_AP_GP_EXCHANGE_5M_TASK_VERSION,
        timeoutMs: SELF_INITIATED_AP_GP_EXCHANGE_5M_TIMEOUT_MS,
        autonomousRequiresSelectedModuleAction: false,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: COIN_ITEM_ID, amount: STARTER_GP }],
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason:
                'self-initiated-ap-gp-exchange-5m requires autonomous mode with a live controller and a low-AP resident holding real GP; run with --mode autonomous',
            metrics: { selfInitiatedAttempts: 0, selfInitiatedCompleted: 0, fullyProvenExchanges: 0, actionsTotal: 0 },
        }),
        runAutonomous: async context => observeSelfInitiatedExchange(context),
    };
}

async function observeSelfInitiatedExchange(context: BenchmarkTaskContext): Promise<BenchmarkTaskOutcome> {
    const startedAt = Date.now();
    context.recordSummary(
        'Observing benchmark for a resident-initiated AP-for-GP exchange (low AP + GP held → self-initiated coin-995 burn + AP credit).',
    );
    while (!context.signal.aborted && Date.now() - startedAt < SELF_INITIATED_AP_GP_EXCHANGE_5M_TIMEOUT_MS) {
        const outcome = verifySelfInitiatedApGpExchange5m({
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
    return verifySelfInitiatedApGpExchange5m({
        elapsedMs: Date.now() - startedAt,
        actions: [...context.actionAttempts()],
        perceptions: [...context.perceptions()],
        events: [...context.events()],
    });
}

function isSelfInitiatedExchangeAttempt(attempt: SelfInitiatedApGpExchange5mActionAttempt): boolean {
    return attempt.action.kind === 'city_exchange_ap_gp' && attempt.action.cause === SELF_INITIATED_EXCHANGE_CAUSE;
}

function readExchangeStatus(attempt: SelfInitiatedApGpExchange5mActionAttempt): string | undefined {
    if (!isRecord(attempt.result)) {
        return undefined;
    }
    const status = attempt.result['status'];
    return typeof status === 'string' ? status : undefined;
}

/** Net AP change for the exchange (attentionAfter - attentionBefore). */
function apDelta(attempt: SelfInitiatedApGpExchange5mActionAttempt): number {
    if (!isRecord(attempt.result) || !isRecord(attempt.result['apEvidence'])) {
        return 0;
    }
    const apEvidence = attempt.result['apEvidence'];
    const before = numericField(apEvidence, 'attentionBefore', 0);
    const after = numericField(apEvidence, 'attentionAfter', 0);
    return after - before;
}

/** GP (coin 995) burned by the exchange. */
function gpBurned(attempt: SelfInitiatedApGpExchange5mActionAttempt): number {
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
