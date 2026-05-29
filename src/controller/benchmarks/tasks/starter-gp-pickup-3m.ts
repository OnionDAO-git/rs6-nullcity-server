import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';

export const STARTER_GP_PICKUP_3M_TASK_ID = 'starter-gp-pickup-3m';
export const STARTER_GP_PICKUP_3M_TASK_VERSION = '0.1.0';
export const STARTER_GP_PICKUP_3M_BUDGET_MS = 3 * 60 * 1000;

const COIN_ITEM_ID = 995;
const COIN_AMOUNT = 25;
const START_POSITION = { x: 3225, y: 3230, level: 0 };
const SETUP_DROP_CAUSE = 'benchmark_seed_starter_gp_pickup';
const PICKUP_CAUSE = 'benchmark_starter_gp_pickup_3m';

export interface StarterGpPickup3mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
}

export interface StarterGpPickup3mVerificationInput {
    elapsedMs: number;
    actions: StarterGpPickup3mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeStarterGpPickup3mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: STARTER_GP_PICKUP_3M_TASK_ID,
        version: STARTER_GP_PICKUP_3M_TASK_VERSION,
        timeoutMs: STARTER_GP_PICKUP_3M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: COIN_ITEM_ID, amount: COIN_AMOUNT }],
        },
        setup: async context => {
            await context.submitAction({ kind: 'drop', slot: 0, cause: SETUP_DROP_CAUSE });
            await waitForVisibleGroundCoins(context, now);
            context.recordSummary('Dropped starter GP so the resident must earn observable GP by picking up visible coins.');
        },
        run: async context => {
            const startedAt = now();
            const target = latestVisibleCoins(context.latestPerception()) || fallbackCoins();
            await context.submitAction({ kind: 'interact', target, option: 'pick-up', cause: PICKUP_CAUSE });
            while (!context.signal.aborted && now() - startedAt < STARTER_GP_PICKUP_3M_BUDGET_MS) {
                const outcome = verifyStarterGpPickup3m({
                    elapsedMs: now() - startedAt,
                    actions: [...context.actionAttempts()],
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }
            return verifyStarterGpPickup3m({
                elapsedMs: now() - startedAt,
                actions: [...context.actionAttempts()],
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous pickup behavior for visible starter GP.');
            while (!context.signal.aborted && now() - startedAt < STARTER_GP_PICKUP_3M_BUDGET_MS) {
                const outcome = verifyStarterGpPickup3m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActionAttempts(context),
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }
            return verifyStarterGpPickup3m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyStarterGpPickup3m(input: StarterGpPickup3mVerificationInput): BenchmarkTaskOutcome {
    const metrics = starterGpPickupMetrics(input);
    if (input.elapsedMs > STARTER_GP_PICKUP_3M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'starter-gp-pickup-3m exceeded the 3 minute budget before success was observed',
        };
    }
    if (metrics.coinPickupActions === 0) {
        return {
            status: 'failed',
            score: 0.3,
            metrics,
            failureReason: 'No coin pickup action was attempted against visible RuneScape GP',
        };
    }
    if (metrics.coinGroundObserved === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No visible ground coins were observed after benchmark setup',
        };
    }
    if (metrics.successfulCoinPickupActions === 0) {
        return {
            status: 'failed',
            score: 0.55,
            metrics,
            failureReason: 'A coin pickup action was attempted, but no successful pickup action was observed',
        };
    }
    if (metrics.gpGainedFromGround === 0) {
        return {
            status: 'failed',
            score: 0.7,
            metrics,
            failureReason: 'Coin pickup was attempted, but carried GP did not increase after visible ground coins',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['starter-gp-pickup-3m observed visible RuneScape GP pickup into inventory.'],
    };
}

function starterGpPickupMetrics(input: StarterGpPickup3mVerificationInput): Record<string, number> {
    const coinPickupActions = input.actions.filter(attempt => isCoinPickupAction(attempt.action));
    return {
        coinItemId: COIN_ITEM_ID,
        actionsAttempted: input.actions.length,
        setupDropActions: input.actions.filter(attempt => attempt.action.kind === 'drop' && attempt.action.cause === SETUP_DROP_CAUSE)
            .length,
        coinGroundObserved: input.perceptions.some(perception => worldItems(perception).some(isCoinItem)) ? 1 : 0,
        coinPickupActions: coinPickupActions.length,
        successfulCoinPickupActions: coinPickupActions.filter(isSuccessfulAttempt).length,
        gpGainedFromGround: gpGainedFromGround(input.perceptions) ? 1 : 0,
        gpObservedAmount: maxInventoryCoins(input.perceptions),
        coinReceivedEvents: allEvents(input).filter(isCoinReceivedEvent).length,
        coinLostEvents: allEvents(input).filter(isCoinLostEvent).length,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): StarterGpPickup3mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
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

function latestVisibleCoins(perception: Perception | undefined): Record<string, unknown> | undefined {
    if (!perception) {
        return undefined;
    }
    return worldItems(perception).find(isCoinItem);
}

function fallbackCoins(): Record<string, unknown> {
    return { itemId: COIN_ITEM_ID, key: 'rs:coins', amount: COIN_AMOUNT, position: START_POSITION };
}

function isCoinPickupAction(action: AgentAction): boolean {
    return (
        action.kind === 'interact' &&
        /^pick-up$/i.test(stringField(action, 'option') || '') &&
        isRecord(action.target) &&
        isCoinItem(action.target)
    );
}

function isSuccessfulAttempt(attempt: StarterGpPickup3mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    const status = attempt.finalStatus || stringField(attempt as unknown as Record<string, unknown>, 'status');
    return !status || !/fail|reject|error|timeout|blocked/i.test(status);
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

function allEvents(input: StarterGpPickup3mVerificationInput): PerceptionEvent[] {
    return [...input.events, ...input.perceptions.flatMap(perceptionEvents)];
}

function perceptionEvents(perception: Perception): PerceptionEvent[] {
    return Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
}

function isCoinReceivedEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'item_received' && isRecord(event.item) && isCoinItem(event.item);
}

function isCoinLostEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'item_lost' && isRecord(event.item) && isCoinItem(event.item);
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

function numericField(record: Record<string, unknown>, key: string, fallback = 0): number {
    const value = record[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
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
