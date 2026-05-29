import type { AgentAction, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

/**
 * AP-for-GP exchange benchmark (5-minute window).
 *
 * Proves a resident can:
 * 1. Hold real GP (coin item 995) from prior earning activity.
 * 2. Respond to a human offering AP in exchange for GP.
 * 3. Complete a safe exchange resulting in a `city_ap_gp_exchange`
 *    Library event with status `complete` (both AP and GP evidence present).
 *
 * Requires live controller, resident with coins, and an active patron session.
 * Substrate + unit tests ship in S3a; live exchange proof is S3b.
 */

export const AP_GP_EXCHANGE_5M_TASK_ID = 'ap-gp-exchange-5m';
export const AP_GP_EXCHANGE_5M_TASK_VERSION = '0.1.0';
export const AP_GP_EXCHANGE_5M_TIMEOUT_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3222, y: 3218, level: 0 };

export interface ApGpExchange5mActionAttempt {
    action: AgentAction;
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
}

export interface ApGpExchange5mVerificationInput {
    elapsedMs: number;
    actions: ApGpExchange5mActionAttempt[];
    events: PerceptionEvent[];
    /** Starting GP balance (coin item 995) before the benchmark window. */
    startingGp: number;
    /** Starting AP balance before the benchmark window. */
    startingAp: number;
    /** Whether a city_ap_gp_exchange Library event with status 'complete' was produced. */
    exchangeCompleted: boolean;
    /** Whether exchange failed due to insufficient gold. */
    failedForInsufficientGold: boolean;
}

function exchangeMetrics(input: ApGpExchange5mVerificationInput): Record<string, number> {
    return {
        startingGp: input.startingGp,
        startingAp: input.startingAp,
        exchangeCompleted: input.exchangeCompleted ? 1 : 0,
        failedForInsufficientGold: input.failedForInsufficientGold ? 1 : 0,
        actionsTotal: input.actions.length,
    };
}

export function verifyApGpExchange5m(input: ApGpExchange5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = exchangeMetrics(input);

    if (input.failedForInsufficientGold) {
        return {
            status: 'failed',
            score: 0.5,
            failureReason: 'Resident had insufficient GP to complete the exchange — run after a GP-earning benchmark',
            metrics,
        };
    }

    if (!input.exchangeCompleted) {
        return {
            status: 'failed',
            score: 0,
            failureReason: 'No complete city_ap_gp_exchange Library event produced during the benchmark window',
            metrics,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
    };
}

export function makeApGpExchange5mBenchmarkTask(): BenchmarkTask {
    return {
        id: AP_GP_EXCHANGE_5M_TASK_ID,
        version: AP_GP_EXCHANGE_5M_TASK_VERSION,
        timeoutMs: AP_GP_EXCHANGE_5M_TIMEOUT_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason:
                'ap-gp-exchange-5m requires autonomous mode with a live controller and patron session; run with --mode autonomous',
            metrics: { startingGp: 0, startingAp: 0, exchangeCompleted: 0, failedForInsufficientGold: 0, actionsTotal: 0 },
        }),
    };
}
