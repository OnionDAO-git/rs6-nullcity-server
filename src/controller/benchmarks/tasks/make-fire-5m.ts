import { objectIds } from '../../../engine/world/config/object-ids';
import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const MAKE_FIRE_5M_TASK_ID = 'make-fire-5m';
export const MAKE_FIRE_5M_TASK_VERSION = '0.1.0';
export const MAKE_FIRE_5M_BUDGET_MS = 5 * 60 * 1000;

const MAX_REPEATED_FIREMAKING_ACTIONS = 8;
const LOG_ITEM_IDS = new Set([1511, 1521, 1519, 6333, 1517, 6332, 1515, 1513]);

export interface MakeFire5mActionAttempt {
    action: AgentAction;
    finalStatus?: string;
}

export interface MakeFire5mVerificationInput {
    elapsedMs: number;
    actions: MakeFire5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeFire5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: MAKE_FIRE_5M_TASK_ID,
        version: MAKE_FIRE_5M_TASK_VERSION,
        timeoutMs: MAKE_FIRE_5M_BUDGET_MS,
        resident: {
            spawnPosition: { x: 3225, y: 3230, level: 0 },
            initialInventory: [{ itemId: 590 }, { itemId: 1511 }],
        },
        run: async context => {
            const startedAt = now();
            const actions: MakeFire5mActionAttempt[] = [];
            const action: AgentAction = { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'benchmark_make_fire_5m' };
            actions.push({ action });
            await context.submitAction(action);
            context.recordSummary('Submitted tinderbox-on-logs action for make-fire-5m.');

            while (!context.signal.aborted && now() - startedAt < MAKE_FIRE_5M_BUDGET_MS) {
                const outcome = verifyMakeFire5m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }

            return verifyMakeFire5m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for make-fire-5m.');

            while (!context.signal.aborted && now() - startedAt < MAKE_FIRE_5M_BUDGET_MS) {
                const outcome = verifyMakeFire5m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActionAttempts(context),
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed' || outcome.metrics?.unsafeLoops) {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }

            return verifyMakeFire5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyMakeFire5m(input: MakeFire5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = makeFireMetrics(input);
    if (input.elapsedMs > MAKE_FIRE_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'make-fire-5m exceeded the 5 minute budget before success was observed',
        };
    }

    if (metrics.firemakingActions === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No tinderbox/log firemaking action was attempted',
        };
    }

    if (metrics.successEvents > 0 || (metrics.logsConsumed > 0 && metrics.firesObserved > 0)) {
        return {
            status: 'passed',
            score: 1,
            metrics,
            summaries: ['make-fire-5m observed firemaking success.'],
        };
    }

    if (metrics.unsafeLoops > 0) {
        return {
            status: 'failed',
            score: 0.15,
            metrics,
            failureReason: 'Detected unsafe loop: repeated firemaking action without success evidence',
        };
    }

    return {
        status: 'failed',
        score: progressScore(metrics),
        metrics,
        failureReason: 'Firemaking action was attempted but no fire, consumed logs, or success event was observed',
    };
}

function makeFireMetrics(input: MakeFire5mVerificationInput): Record<string, number> {
    const firemakingActions = input.actions.filter(attempt => isFiremakingAction(attempt.action));
    return {
        actionsAttempted: input.actions.length,
        firemakingActions: firemakingActions.length,
        logsConsumed: logsConsumed(input.perceptions) ? 1 : 0,
        firesObserved: input.perceptions.some(perception => hasNearbyFire(perception)) ? 1 : 0,
        successEvents:
            input.events.some(isFiremakingSuccessEvent) ||
            input.perceptions.some(perception => perceptionEvents(perception).some(isFiremakingSuccessEvent))
                ? 1
                : 0,
        unsafeLoops: repeatedFiremakingLoop(firemakingActions) ? 1 : 0,
    };
}

function selectedModuleActionAttempts(context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0]): MakeFire5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function progressScore(metrics: Record<string, number>): number {
    if (metrics.logsConsumed > 0 || metrics.firesObserved > 0) {
        return 0.6;
    }
    if (metrics.firemakingActions > 0) {
        return 0.3;
    }
    return 0;
}

function isFiremakingAction(action: AgentAction): boolean {
    return action.kind === 'use_item_on_item' || action.kind === 'use_item_on';
}

function repeatedFiremakingLoop(firemakingActions: MakeFire5mActionAttempt[]): boolean {
    let lastKey: string | undefined;
    let repeated = 0;
    for (const attempt of firemakingActions) {
        const key = JSON.stringify(attempt.action);
        repeated = key === lastKey ? repeated + 1 : 1;
        lastKey = key;
        if (repeated >= MAX_REPEATED_FIREMAKING_ACTIONS) {
            return true;
        }
    }
    return false;
}

function logsConsumed(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }

    const first = logCount(perceptions[0]);
    if (first <= 0) {
        return false;
    }
    return perceptions.slice(1).some(perception => logCount(perception) < first);
}

function logCount(perception: Perception): number {
    return inventory(perception).reduce((total, item) => {
        if (!isLogItem(item)) {
            return total;
        }
        return total + numericField(item, 'amount', 1);
    }, 0);
}

function hasNearbyFire(perception: Perception): boolean {
    return nearbyObjects(perception).some(object => {
        if (numericField(object, 'objectId') === objectIds.fire) {
            return true;
        }
        const key = stringField(object, 'key') || stringField(object, 'name');
        return key ? /\bfire\b/i.test(key) : false;
    });
}

function isFiremakingSuccessEvent(event: PerceptionEvent): boolean {
    const kind = stringField(event, 'kind');
    const skill = stringField(event, 'skill');
    if (kind === 'fire_lit' || kind === 'firemaking_success') {
        return true;
    }
    if (kind === 'xp_gained' && skill === 'firemaking') {
        return true;
    }
    const text = stringField(event, 'text') || stringField(event, 'message');
    return text ? /fire catches|logs begin to burn/i.test(text) : false;
}

function perceptionEvents(perception: Perception): PerceptionEvent[] {
    return Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
}

function inventory(perception: Perception): Array<Record<string, unknown> | null> {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return Array.isArray(resident.inventory) ? (resident.inventory as Array<Record<string, unknown> | null>) : [];
}

function nearbyObjects(perception: Perception): Array<Record<string, unknown>> {
    const nearby = isRecord(perception.nearby) ? perception.nearby : {};
    return Array.isArray(nearby.objects) ? (nearby.objects.filter(isRecord) as Array<Record<string, unknown>>) : [];
}

function isLogItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    const key = stringField(item, 'key');
    if (key && /^rs:(logs|.*_logs)$/i.test(key)) {
        return true;
    }
    return LOG_ITEM_IDS.has(numericField(item, 'itemId'));
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
