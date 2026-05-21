import { objectIds } from '../../../engine/world/config/object-ids';
import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const WOODCUTTING_FIREMAKING_10M_TASK_ID = 'woodcutting-firemaking-10m';
export const WOODCUTTING_FIREMAKING_10M_TASK_VERSION = '0.1.0';
export const WOODCUTTING_FIREMAKING_10M_BUDGET_MS = 10 * 60 * 1000;

const START_POSITION = { x: 3225, y: 3230, level: 0 };
const START_TREE = { objectId: objectIds.tree.normal[0].default, position: { x: 3225, y: 3232, level: 0 }, orientation: 0 };
const MAX_REPEATED_CHAIN_ACTIONS = 12;
const TINDERBOX_SLOT = 0;
const LOG_ITEM_IDS = new Set([1511, 2862, 1521, 1519, 6333, 1517, 6332, 1515, 1513]);
const LEVEL_ONE_TREE_IDS = new Set([...objectIds.tree.normal.map(tree => tree.default), ...objectIds.tree.dead.map(tree => tree.default)]);

export interface WoodcuttingFiremaking10mActionAttempt {
    action: AgentAction;
    finalStatus?: string;
}

export interface WoodcuttingFiremaking10mVerificationInput {
    elapsedMs: number;
    actions: WoodcuttingFiremaking10mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeWoodcuttingFiremaking10mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: WOODCUTTING_FIREMAKING_10M_TASK_ID,
        version: WOODCUTTING_FIREMAKING_10M_TASK_VERSION,
        timeoutMs: WOODCUTTING_FIREMAKING_10M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: 590 }, { itemId: 1351 }],
        },
        run: async context => {
            const startedAt = now();
            const actions: WoodcuttingFiremaking10mActionAttempt[] = [];
            const chopAction: AgentAction = {
                kind: 'interact',
                target: START_TREE,
                option: 'chop down',
                cause: 'benchmark_woodcutting_firemaking_10m',
            };
            actions.push({ action: chopAction });
            await context.submitAction(chopAction);
            context.recordSummary('Submitted starter tree chop action for woodcutting-firemaking-10m.');

            await waitForWoodcuttingEvidence(context, actions, startedAt, now);

            const logSlot = await waitForLogSlot(context, startedAt, now);
            if (logSlot === undefined) {
                return verifyWoodcuttingFiremaking10m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
            }

            const fireAction: AgentAction = {
                kind: 'use_item_on_item',
                itemSlot: TINDERBOX_SLOT,
                targetSlot: logSlot,
                cause: 'benchmark_woodcutting_firemaking_10m',
            };
            actions.push({ action: fireAction });
            await context.submitAction(fireAction);
            context.recordSummary('Submitted tinderbox-on-self-supplied-logs action for woodcutting-firemaking-10m.');

            while (!context.signal.aborted && now() - startedAt < WOODCUTTING_FIREMAKING_10M_BUDGET_MS) {
                const outcome = verifyWoodcuttingFiremaking10m({
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

            return verifyWoodcuttingFiremaking10m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for woodcutting-firemaking-10m.');

            while (!context.signal.aborted && now() - startedAt < WOODCUTTING_FIREMAKING_10M_BUDGET_MS) {
                const outcome = verifyWoodcuttingFiremaking10m({
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

            return verifyWoodcuttingFiremaking10m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyWoodcuttingFiremaking10m(input: WoodcuttingFiremaking10mVerificationInput): BenchmarkTaskOutcome {
    const metrics = woodcuttingFiremakingMetrics(input);
    if (input.elapsedMs > WOODCUTTING_FIREMAKING_10M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'woodcutting-firemaking-10m exceeded the 10 minute budget before success was observed',
        };
    }

    if (metrics.woodcuttingActions === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No woodcutting action was attempted before firemaking evidence',
        };
    }

    if (
        metrics.woodcuttingEvidence > 0 &&
        metrics.validFiremakingActions > 0 &&
        metrics.orderedActionChain > 0 &&
        metrics.firemakingSuccess > 0
    ) {
        return {
            status: 'passed',
            score: 1,
            metrics,
            summaries: ['woodcutting-firemaking-10m observed self-supplied logs and firemaking success.'],
        };
    }

    if (metrics.unsafeLoops > 0) {
        return {
            status: 'failed',
            score: 0.15,
            metrics,
            failureReason: 'Detected unsafe loop: repeated woodcutting/firemaking action without success evidence',
        };
    }

    if (metrics.woodcuttingEvidence === 0) {
        return {
            status: 'failed',
            score: 0.25,
            metrics,
            failureReason: 'No self-supplied logs or woodcutting success evidence was observed',
        };
    }

    if (metrics.validFiremakingActions === 0) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason:
                metrics.firemakingActions === 0
                    ? 'Woodcutting evidence was observed, but no firemaking action was attempted'
                    : 'Firemaking-like actions were attempted, but no valid tinderbox/log firemaking action was observed',
        };
    }

    if (metrics.orderedActionChain === 0) {
        return {
            status: 'failed',
            score: 0.55,
            metrics,
            failureReason: 'No ordered woodcutting-to-firemaking action chain was observed',
        };
    }

    return {
        status: 'failed',
        score: 0.7,
        metrics,
        failureReason: 'Firemaking was attempted after woodcutting, but no firemaking success was observed',
    };
}

function woodcuttingFiremakingMetrics(input: WoodcuttingFiremaking10mVerificationInput): Record<string, number> {
    const woodcuttingActions = input.actions.filter(attempt => isWoodcuttingAction(attempt.action));
    const firemakingActions = input.actions.filter(attempt => isFiremakingAction(attempt.action));
    const validFiremakingActions = input.actions.filter(attempt => isValidFiremakingAction(attempt.action, input.perceptions));
    const logsGainedValue = logsGained(input.perceptions) ? 1 : 0;
    const logsConsumedAfterGainValue = logsConsumedAfterGain(input.perceptions) ? 1 : 0;
    const firesObserved = input.perceptions.some(perception => hasNearbyFire(perception)) ? 1 : 0;
    const woodcuttingSuccessEvents = allEvents(input).some(isWoodcuttingSuccessEvent) ? 1 : 0;
    const firemakingSuccessEvents = allEvents(input).some(isFiremakingSuccessEvent) ? 1 : 0;
    const externalLogSupplyActions = input.actions.filter(attempt => isExternalLogSupplyAction(attempt.action)).length;
    const woodcuttingEvidence = woodcuttingSuccessEvents || (logsGainedValue && externalLogSupplyActions === 0) ? 1 : 0;
    return {
        actionsAttempted: input.actions.length,
        woodcuttingActions: woodcuttingActions.length,
        firemakingActions: firemakingActions.length,
        validFiremakingActions: validFiremakingActions.length,
        orderedActionChain: orderedActionChain(input.actions, input.perceptions) ? 1 : 0,
        logsGained: logsGainedValue,
        logsConsumedAfterGain: logsConsumedAfterGainValue,
        externalLogSupplyActions,
        firesObserved,
        woodcuttingSuccessEvents,
        firemakingSuccessEvents,
        woodcuttingEvidence,
        firemakingSuccess: firemakingSuccessEvents || (logsConsumedAfterGainValue && firesObserved) ? 1 : 0,
        unsafeLoops: repeatedActionLoop(
            input.actions.filter(attempt => isWoodcuttingAction(attempt.action) || isFiremakingAction(attempt.action)),
        )
            ? 1
            : 0,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): WoodcuttingFiremaking10mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

async function waitForWoodcuttingEvidence(
    context: Parameters<BenchmarkTask['run']>[0],
    actions: WoodcuttingFiremaking10mActionAttempt[],
    startedAt: number,
    now: () => number,
): Promise<void> {
    while (!context.signal.aborted && now() - startedAt < 120_000) {
        const metrics = woodcuttingFiremakingMetrics({
            elapsedMs: now() - startedAt,
            actions,
            perceptions: [...context.perceptions()],
            events: [...context.events()],
        });
        if (metrics.woodcuttingEvidence > 0) {
            return;
        }
        await sleep(1000, context.signal);
    }
}

async function waitForLogSlot(
    context: Parameters<BenchmarkTask['run']>[0],
    startedAt: number,
    now: () => number,
): Promise<number | undefined> {
    while (!context.signal.aborted && now() - startedAt < WOODCUTTING_FIREMAKING_10M_BUDGET_MS) {
        const slot = firstLogSlot(context.latestPerception());
        if (slot !== undefined) {
            return slot;
        }
        await sleep(1000, context.signal);
    }
    return undefined;
}

function firstLogSlot(perception: Perception | undefined): number | undefined {
    const slot = inventory(perception).findIndex(isLogItem);
    return slot >= 0 ? slot : undefined;
}

function isWoodcuttingAction(action: AgentAction): boolean {
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    const option = stringField(action, 'option') || '';
    return /chop/i.test(option) && LEVEL_ONE_TREE_IDS.has(numericField(action.target, 'objectId'));
}

function isFiremakingAction(action: AgentAction): boolean {
    return action.kind === 'use_item_on_item' || action.kind === 'use_item_on';
}

function isExternalLogSupplyAction(action: AgentAction): boolean {
    if (action.kind === 'trade_offer_item' || action.kind === 'trade_accept_stage_1' || action.kind === 'trade_accept_stage_2') {
        return true;
    }
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    const option = stringField(action, 'option') || '';
    return /pick.?up|take/i.test(option) && isLogItem(action.target);
}

function isValidFiremakingAction(action: AgentAction, perceptions: Perception[]): boolean {
    if (action.kind === 'use_item_on_item') {
        const itemSlot = numericField(action, 'itemSlot', -1);
        const targetSlot = numericField(action, 'targetSlot', -1);
        return perceptions.some(perception => inventoryHasTinderboxAndLogAt(inventory(perception), itemSlot, targetSlot));
    }

    if (action.kind === 'use_item_on') {
        const itemSlot = numericField(action, 'itemSlot', -1);
        return perceptions.some(perception => isTinderboxItem(inventory(perception)[itemSlot] || null)) && isLogTarget(action.target);
    }

    return false;
}

function orderedActionChain(actions: WoodcuttingFiremaking10mActionAttempt[], perceptions: Perception[]): boolean {
    const woodcuttingIndex = actions.findIndex(attempt => isWoodcuttingAction(attempt.action));
    if (woodcuttingIndex < 0) {
        return false;
    }
    return (
        actions.findIndex((attempt, index) => index > woodcuttingIndex && isValidFiremakingAction(attempt.action, perceptions)) >
        woodcuttingIndex
    );
}

function inventoryHasTinderboxAndLogAt(inventory: Array<Record<string, unknown> | null>, itemSlot: number, targetSlot: number): boolean {
    if (itemSlot < 0 || targetSlot < 0) {
        return false;
    }
    const item = inventory[itemSlot] || null;
    const target = inventory[targetSlot] || null;
    return (isTinderboxItem(item) && isLogItem(target)) || (isLogItem(item) && isTinderboxItem(target));
}

function isTinderboxItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    return numericField(item, 'itemId') === 590 || /\btinderbox\b/i.test(stringField(item, 'key') || '');
}

function isLogTarget(target: unknown): boolean {
    return isRecord(target) && isLogItem(target);
}

function repeatedActionLoop(actions: WoodcuttingFiremaking10mActionAttempt[]): boolean {
    let lastKey: string | undefined;
    let repeated = 0;
    for (const attempt of actions) {
        const key = JSON.stringify(attempt.action);
        repeated = key === lastKey ? repeated + 1 : 1;
        lastKey = key;
        if (repeated >= MAX_REPEATED_CHAIN_ACTIONS) {
            return true;
        }
    }
    return false;
}

function logsGained(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let maxLogs = logCount(perceptions[0]);
    for (const perception of perceptions.slice(1)) {
        const count = logCount(perception);
        if (count > maxLogs) {
            return true;
        }
        maxLogs = Math.max(maxLogs, count);
    }
    return false;
}

function logsConsumedAfterGain(perceptions: Perception[]): boolean {
    if (perceptions.length < 3) {
        return false;
    }

    let maxLogs = logCount(perceptions[0]);
    let sawGain = false;
    for (const perception of perceptions.slice(1)) {
        const count = logCount(perception);
        if (count > maxLogs) {
            sawGain = true;
            maxLogs = count;
        } else if (sawGain && count < maxLogs) {
            return true;
        }
    }
    return false;
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

function isWoodcuttingSuccessEvent(event: PerceptionEvent): boolean {
    const kind = stringField(event, 'kind');
    const skill = stringField(event, 'skill');
    if (kind === 'xp_gained' && skill === 'woodcutting') {
        return true;
    }
    const text = stringField(event, 'text') || stringField(event, 'message');
    return text ? /manage to chop|woodcutting xp|chop some logs/i.test(text) : false;
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

function allEvents(input: WoodcuttingFiremaking10mVerificationInput): PerceptionEvent[] {
    return [...input.events, ...input.perceptions.flatMap(perceptionEvents)];
}

function perceptionEvents(perception: Perception): PerceptionEvent[] {
    return Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
}

function inventory(perception: Perception | undefined): Array<Record<string, unknown> | null> {
    const resident = isRecord(perception?.resident) ? perception.resident : {};
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
