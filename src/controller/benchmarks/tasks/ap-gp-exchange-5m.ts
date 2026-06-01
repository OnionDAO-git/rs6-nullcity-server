import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';

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

const COIN_ITEM_ID = 995;
const STARTER_GP = 125;
const BENCH_AP_AMOUNT = 50;
const START_POSITION = { x: 3222, y: 3218, level: 0 };

export interface ApGpExchange5mActionAttempt {
    action: AgentAction;
    result?: { ok?: boolean; [key: string]: unknown };
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
}

export interface ApGpExchange5mVerificationInput {
    elapsedMs: number;
    actions: ApGpExchange5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

function exchangeMetrics(input: ApGpExchange5mVerificationInput): Record<string, number> {
    const exchangeAttempts = input.actions.filter(isExchangeAttempt);
    const completed = exchangeAttempts.filter(attempt => readExchangeStatus(attempt) === 'complete');
    const failedInsufficient = exchangeAttempts.filter(attempt => readExchangeFailure(attempt) === 'insufficient_gold');
    const gpBurned = completed.reduce((total, attempt) => total + readGpBurned(attempt), 0);
    const apCredited = completed.reduce((total, attempt) => total + readApCredited(attempt), 0);
    const selectedModuleActions = input.actions.filter(attempt => !!attempt.sparkModule).length;
    return {
        coinItemId: COIN_ITEM_ID,
        exchangeAttempts: exchangeAttempts.length,
        exchangeCompleted: completed.length,
        failedForInsufficientGold: failedInsufficient.length,
        gpBurned,
        apCredited,
        selectedModuleActions,
        coinInventoryObserved: maxInventoryCoins(input.perceptions),
        lowAttentionObserved: input.perceptions.some(perception => attention(perception) <= 10) ? 1 : 0,
        actionsTotal: input.actions.length,
    };
}

export function verifyApGpExchange5m(input: ApGpExchange5mVerificationInput): BenchmarkTaskOutcome {
    if (input.elapsedMs > AP_GP_EXCHANGE_5M_TIMEOUT_MS) {
        return {
            status: 'timeout',
            score: 0,
            failureReason: 'ap-gp-exchange-5m exceeded the 5 minute budget before exchange evidence was observed',
            metrics: exchangeMetrics(input),
        };
    }

    const metrics = exchangeMetrics(input);
    if (metrics.exchangeAttempts === 0) {
        return {
            status: 'failed',
            score: 0,
            failureReason: 'No AP-for-GP exchange attempt was observed during the benchmark window',
            metrics,
        };
    }

    if (metrics.failedForInsufficientGold > 0 && metrics.exchangeCompleted === 0) {
        return {
            status: 'failed',
            score: 0.5,
            failureReason: 'Resident had insufficient GP to complete the exchange — run after a GP-earning benchmark',
            metrics,
        };
    }

    if (metrics.exchangeCompleted === 0) {
        return {
            status: 'failed',
            score: 0,
            failureReason: 'No complete AP-for-GP exchange was observed during the benchmark window',
            metrics,
        };
    }

    if (metrics.gpBurned <= 0 || metrics.apCredited < BENCH_AP_AMOUNT) {
        return {
            status: 'failed',
            score: 0.75,
            failureReason: 'Exchange completed without usable GP/AP evidence amounts',
            metrics,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['ap-gp-exchange-5m observed a complete AP-for-GP exchange with real coin 995 burn evidence.'],
    };
}

export function makeApGpExchange5mBenchmarkTask(): BenchmarkTask {
    return {
        id: AP_GP_EXCHANGE_5M_TASK_ID,
        version: AP_GP_EXCHANGE_5M_TASK_VERSION,
        timeoutMs: AP_GP_EXCHANGE_5M_TIMEOUT_MS,
        autonomousRequiresSelectedModuleAction: false,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: COIN_ITEM_ID, amount: STARTER_GP }],
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason:
                'ap-gp-exchange-5m requires autonomous mode with a live controller and patron session; run with --mode autonomous',
            metrics: { exchangeAttempts: 0, exchangeCompleted: 0, failedForInsufficientGold: 0, actionsTotal: 0 },
        }),
        runAutonomous: async context => observeExchange(context),
    };
}

async function observeExchange(context: BenchmarkTaskContext): Promise<BenchmarkTaskOutcome> {
    const startedAt = Date.now();
    context.recordSummary('Observing benchmark AP-for-GP exchange evidence (coin item 995 burn + AP credit).');
    while (!context.signal.aborted && Date.now() - startedAt < AP_GP_EXCHANGE_5M_TIMEOUT_MS) {
        const outcome = verifyApGpExchange5m({
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
    return verifyApGpExchange5m({
        elapsedMs: Date.now() - startedAt,
        actions: [...context.actionAttempts()],
        perceptions: [...context.perceptions()],
        events: [...context.events()],
    });
}

function isExchangeAttempt(attempt: ApGpExchange5mActionAttempt): boolean {
    return attempt.action.kind === 'city_exchange_ap_gp';
}

function readExchangeStatus(attempt: ApGpExchange5mActionAttempt): string | undefined {
    if (!isRecord(attempt.result)) {
        return undefined;
    }
    const status = attempt.result['status'];
    return typeof status === 'string' ? status : undefined;
}

function readExchangeFailure(attempt: ApGpExchange5mActionAttempt): string | undefined {
    if (!isRecord(attempt.result)) {
        return undefined;
    }
    const failure = attempt.result['failureReason'];
    return typeof failure === 'string' ? failure : undefined;
}

function readGpBurned(attempt: ApGpExchange5mActionAttempt): number {
    if (!isRecord(attempt.result) || !isRecord(attempt.result['gpEvidence'])) {
        return 0;
    }
    const gpEvidence = attempt.result['gpEvidence'];
    const itemId = numericField(gpEvidence, 'itemId', 0);
    if (itemId !== COIN_ITEM_ID) {
        return 0;
    }
    return numericField(gpEvidence, 'burnedAmount', 0);
}

function readApCredited(attempt: ApGpExchange5mActionAttempt): number {
    if (!isRecord(attempt.result) || !isRecord(attempt.result['apEvidence'])) {
        return 0;
    }
    return numericField(attempt.result['apEvidence'], 'creditedAmount', 0);
}

function maxInventoryCoins(perceptions: Perception[]): number {
    return perceptions.reduce((max, perception) => Math.max(max, inventoryCoins(perception)), 0);
}

function inventoryCoins(perception: Perception): number {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const inventory = Array.isArray(resident.inventory) ? resident.inventory : [];
    return inventory.reduce((total, entry) => {
        if (!isRecord(entry)) {
            return total;
        }
        const itemId = numericField(entry, 'itemId', 0);
        if (itemId !== COIN_ITEM_ID) {
            return total;
        }
        return total + numericField(entry, 'amount', 1);
    }, 0);
}

function attention(perception: Perception): number {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return numericField(resident, 'attention', Number.POSITIVE_INFINITY);
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
