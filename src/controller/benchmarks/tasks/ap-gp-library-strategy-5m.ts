import type { AgentAction, Perception } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';

export const AP_GP_LIBRARY_STRATEGY_5M_TASK_ID = 'ap-gp-library-strategy-5m';
export const AP_GP_LIBRARY_STRATEGY_5M_TASK_VERSION = '0.1.0';
export const AP_GP_LIBRARY_STRATEGY_5M_BUDGET_MS = 5 * 60 * 1000;

const COIN_ITEM_ID = 995;
const COIN_AMOUNT = 25;
const START_POSITION = { x: 3225, y: 3230, level: 0 };
const SETUP_DROP_CAUSE = 'benchmark_seed_ap_gp_library_strategy';

export interface ApGpLibraryStrategy5mActionAttempt {
    action: AgentAction;
    result?: { ok?: boolean };
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
    attentionAfter?: number;
}

export interface ApGpLibraryStrategy5mVerificationInput {
    elapsedMs: number;
    actions: ApGpLibraryStrategy5mActionAttempt[];
    perceptions: Perception[];
}

export function makeApGpLibraryStrategy5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: AP_GP_LIBRARY_STRATEGY_5M_TASK_ID,
        version: AP_GP_LIBRARY_STRATEGY_5M_TASK_VERSION,
        timeoutMs: AP_GP_LIBRARY_STRATEGY_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: COIN_ITEM_ID, amount: COIN_AMOUNT }],
        },
        setup: async context => {
            await context.submitAction({ kind: 'drop', slot: 0, cause: SETUP_DROP_CAUSE });
            await waitForVisibleGroundCoins(context, now);
            context.recordSummary('Seeded visible RuneScape GP and waiting for AP/GP-first strategy behavior.');
        },
        run: async context => runLoop(context, now, () => [...context.actionAttempts()]),
        runAutonomous: async context =>
            runLoop(context, now, () =>
                context.actionAttempts().filter(attempt => {
                    const module = attempt.sparkModule;
                    return (
                        (module?.id === context.module.id && module.version === context.module.version) ||
                        (typeof attempt.attentionAfter === 'number' && attempt.attentionAfter <= 10)
                    );
                }),
            ),
    };
}

function runLoop(
    context: BenchmarkTaskContext,
    now: () => number,
    readActions: () => ApGpLibraryStrategy5mActionAttempt[],
): Promise<BenchmarkTaskOutcome> {
    return observeUntilBudget(context, now, () =>
        verifyApGpLibraryStrategy5m({
            elapsedMs: 0,
            actions: readActions(),
            perceptions: [...context.perceptions()],
        }),
    );
}

async function observeUntilBudget(
    context: BenchmarkTaskContext,
    now: () => number,
    check: () => BenchmarkTaskOutcome,
): Promise<BenchmarkTaskOutcome> {
    const startedAt = now();
    while (!context.signal.aborted && now() - startedAt < AP_GP_LIBRARY_STRATEGY_5M_BUDGET_MS) {
        const outcome = checkOutcome(check, now() - startedAt);
        if (outcome.status === 'passed') {
            return outcome;
        }
        await sleep(1000, context.signal);
    }
    return checkOutcome(check, now() - startedAt);
}

function checkOutcome(check: () => BenchmarkTaskOutcome, elapsedMs: number): BenchmarkTaskOutcome {
    const outcome = check();
    return { ...outcome, metrics: { ...(outcome.metrics || {}), elapsedMs } };
}

export function verifyApGpLibraryStrategy5m(input: ApGpLibraryStrategy5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = apGpLibraryStrategyMetrics(input);
    if (input.elapsedMs > AP_GP_LIBRARY_STRATEGY_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'ap-gp-library-strategy-5m exceeded the 5 minute budget before AP/GP strategy evidence was observed',
        };
    }
    if (metrics.lowAttentionObserved === 0) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            failureReason: 'No low-attention/AP perception was observed',
        };
    }
    if (metrics.coinGroundObserved === 0) {
        return {
            status: 'failed',
            score: 0.3,
            metrics,
            failureReason: 'No visible ground GP coins were observed after setup',
        };
    }
    if (metrics.coinPickupActions === 0 || metrics.successfulCoinPickupActions === 0 || metrics.gpGainedFromGround === 0) {
        return {
            status: 'failed',
            score: 0.6,
            metrics,
            failureReason: 'No successful practical GP pickup step was observed',
        };
    }
    if (metrics.practicalStrategySayActions === 0) {
        return {
            status: 'failed',
            score: 0.8,
            metrics,
            failureReason: 'No AP/GP-first strategy narration referencing Library writeback was observed',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['ap-gp-library-strategy-5m observed AP/GP-first practical behavior plus strategy narration.'],
    };
}

function apGpLibraryStrategyMetrics(input: ApGpLibraryStrategy5mVerificationInput): Record<string, number> {
    const coinPickupActions = input.actions.filter(attempt => isCoinPickupAction(attempt.action));
    return {
        coinItemId: COIN_ITEM_ID,
        actionsAttempted: input.actions.length,
        lowAttentionObserved: lowAttentionObserved(input) ? 1 : 0,
        coinGroundObserved: input.perceptions.some(perception => worldItems(perception).some(isCoinItem)) ? 1 : 0,
        coinPickupActions: coinPickupActions.length,
        successfulCoinPickupActions: coinPickupActions.filter(isSuccessfulAttempt).length,
        gpGainedFromGround: gpGainedFromGround(input.perceptions) ? 1 : 0,
        gpObservedAmount: maxInventoryCoins(input.perceptions),
        practicalStrategySayActions: input.actions.filter(attempt => isPracticalStrategySayAction(attempt.action)).length,
    };
}

function lowAttentionObserved(input: ApGpLibraryStrategy5mVerificationInput): boolean {
    return (
        input.perceptions.some(perception => attentionFromPerception(perception) <= 10) ||
        input.actions.some(attempt => typeof attempt.attentionAfter === 'number' && attempt.attentionAfter <= 10)
    );
}

function attentionFromPerception(perception: Perception): number {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return numericField(resident, 'attention', Number.POSITIVE_INFINITY);
}

function isCoinPickupAction(action: AgentAction): boolean {
    return (
        action.kind === 'interact' &&
        /^pick-up$/i.test(stringField(action, 'option') || '') &&
        isRecord(action.target) &&
        isCoinItem(action.target)
    );
}

function isSuccessfulAttempt(attempt: ApGpLibraryStrategy5mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    const status = attempt.finalStatus || '';
    return !/fail|reject|error|timeout|blocked/i.test(status);
}

function isPracticalStrategySayAction(action: AgentAction): boolean {
    if (action.kind !== 'say') {
        return false;
    }
    const text = stringField(action, 'text') || '';
    const cause = stringField(action, 'cause') || '';
    const combined = `${text} ${cause}`.toLowerCase();
    return /ap|attention/.test(combined) && /gp|coin/.test(combined) && /library|strategy|goal/.test(combined);
}

function gpGainedFromGround(perceptions: Perception[]): boolean {
    let sawGroundCoinsWithNoInventoryCoins = false;
    for (const perception of perceptions) {
        const inventoryCoins = inventoryCoinAmount(perception);
        if (worldItems(perception).some(isCoinItem) && inventoryCoins === 0) {
            sawGroundCoinsWithNoInventoryCoins = true;
        }
        if (sawGroundCoinsWithNoInventoryCoins && inventoryCoins > 0) {
            return true;
        }
    }
    return false;
}

function maxInventoryCoins(perceptions: Perception[]): number {
    return perceptions.reduce((max, perception) => Math.max(max, inventoryCoinAmount(perception)), 0);
}

function inventoryCoinAmount(perception: Perception): number {
    return inventory(perception).reduce((total, item) => total + (isCoinItem(item) ? numericField(item, 'amount', 1) : 0), 0);
}

function inventory(perception: Perception): Array<Record<string, unknown> | null> {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return Array.isArray(resident.inventory) ? (resident.inventory as Array<Record<string, unknown> | null>) : [];
}

function worldItems(perception: Perception): Array<Record<string, unknown>> {
    const nearby = isRecord(perception.nearby) ? perception.nearby : {};
    return Array.isArray(nearby.worldItems) ? (nearby.worldItems.filter(isRecord) as Array<Record<string, unknown>>) : [];
}

function isCoinItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    const key = stringField(item, 'key') || '';
    return numericField(item, 'itemId') === COIN_ITEM_ID || /^rs:coins$/i.test(key);
}

function latestVisibleCoins(perception: Perception | undefined): Record<string, unknown> | undefined {
    if (!perception) {
        return undefined;
    }
    return worldItems(perception).find(isCoinItem);
}

async function waitForVisibleGroundCoins(context: BenchmarkTaskContext, now: () => number): Promise<void> {
    const startedAt = now();
    while (!context.signal.aborted && now() - startedAt < 10_000) {
        if (latestVisibleCoins(context.latestPerception())) {
            return;
        }
        await sleep(500, context.signal);
    }
}

function numericField(record: Record<string, unknown>, key: string, fallback = 0): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timeout);
            signal.removeEventListener('abort', onAbort);
            reject(new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    }).catch(() => undefined);
}
