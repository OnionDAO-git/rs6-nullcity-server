import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const FISHING_COOKING_10M_TASK_ID = 'fishing-cooking-10m';
export const FISHING_COOKING_10M_TASK_VERSION = '0.1.0';
export const FISHING_COOKING_10M_BUDGET_MS = 10 * 60 * 1000;

const START_POSITION = { x: 3240, y: 3244, level: 0 };
const SMALL_FISHING_NET_ITEM_IDS = new Set([303]);
const RAW_STARTER_FISH_ITEM_IDS = new Set([317, 321]);
const COOKED_STARTER_FISH_ITEM_IDS = new Set([315, 319]);
const HEAT_SOURCE_OBJECT_IDS = new Set([2732, 114, 2728, 2729, 2730, 2731, 2859, 4172, 9682]);
const NET_CAPABLE_FISHING_SPOT_KEYS = new Set(['rs:fishing_spot_net_bait', 'rs:fishing_spot_net_harpoon']);
const RAW_STARTER_FISH_KEY_PATTERN = /^rs:raw_(shrimp|anchovies)$/i;
const COOKED_STARTER_FISH_KEY_PATTERN = /^rs:(shrimp|anchovies)$/i;
const MAX_REPEATED_WORKFLOW_ACTIONS = 12;

export interface FishingCooking10mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
}

export interface FishingCooking10mVerificationInput {
    elapsedMs: number;
    actions: FishingCooking10mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeFishingCooking10mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: FISHING_COOKING_10M_TASK_ID,
        version: FISHING_COOKING_10M_TASK_VERSION,
        timeoutMs: FISHING_COOKING_10M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: 303 }, { itemId: 590 }, { itemId: 1511 }],
        },
        run: async context => {
            const startedAt = now();
            const actions: FishingCooking10mActionAttempt[] = [];
            context.recordSummary('Running scripted fishing-cooking-10m smoke.');

            while (!context.signal.aborted && now() - startedAt < FISHING_COOKING_10M_BUDGET_MS) {
                const latest = context.latestPerception();
                const nextAction = scriptedNextAction(latest);
                if (nextAction && !alreadyTried(actions, nextAction)) {
                    const attempt: FishingCooking10mActionAttempt = { action: nextAction };
                    actions.push(attempt);
                    attempt.result = await context.submitAction(nextAction);
                }

                const outcome = verifyFishingCooking10m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed' || outcome.metrics?.unsafeLoops) {
                    return outcome;
                }
                await sleep(1000, context.signal);
            }

            return verifyFishingCooking10m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for fishing-cooking-10m.');

            while (!context.signal.aborted && now() - startedAt < FISHING_COOKING_10M_BUDGET_MS) {
                const outcome = verifyFishingCooking10m({
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

            return verifyFishingCooking10m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyFishingCooking10m(input: FishingCooking10mVerificationInput): BenchmarkTaskOutcome {
    const metrics = fishingCookingMetrics(input);
    if (input.elapsedMs > FISHING_COOKING_10M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'fishing-cooking-10m exceeded the 10 minute budget before success was observed',
        };
    }

    if (metrics.netActions === 0) {
        return {
            status: 'failed',
            score: metrics.fishingSpotObserved && metrics.smallNetPresent ? 0.2 : 0,
            metrics,
            failureReason: 'No net fishing action was attempted at a starter Fishing spot',
        };
    }

    if (metrics.successfulNetActions === 0) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            failureReason: 'No successful net fishing action was observed at a starter Fishing spot',
        };
    }

    if (metrics.externalFishSupplyActions > 0) {
        return {
            status: 'failed',
            score: 0.35,
            metrics,
            failureReason: 'Starter fish appeared, but it was externally supplied instead of caught and cooked',
        };
    }

    if (metrics.rawFishEvidence === 0) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason: 'No caught raw starter fish evidence was observed after net fishing',
        };
    }

    if (metrics.cookingActions === 0) {
        return {
            status: 'failed',
            score: 0.6,
            metrics,
            failureReason: 'No cooking action was attempted after catching starter fish',
        };
    }

    if (metrics.successfulCookingActions === 0) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'No successful cooking action was observed on a fire or range',
        };
    }

    if (metrics.orderedActionChain === 0) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'No ordered fishing-to-cooking action chain was observed',
        };
    }

    if (metrics.cookingSuccess > 0) {
        return {
            status: 'passed',
            score: 1,
            metrics,
            summaries: ['fishing-cooking-10m observed net fishing, raw starter fish evidence, cooking action, and cooked food evidence.'],
        };
    }

    if (metrics.unsafeLoops > 0) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            failureReason: 'Detected unsafe loop: repeated fishing/cooking action without cooked food evidence',
        };
    }

    return {
        status: 'failed',
        score: 0.75,
        metrics,
        failureReason: 'Cooking was attempted after catching fish, but no cooked food or Cooking XP evidence was observed',
    };
}

function fishingCookingMetrics(input: FishingCooking10mVerificationInput): Record<string, number> {
    const netActions = input.actions.filter(attempt => isNetFishingAction(attempt.action));
    const cookingActions = input.actions.filter(attempt => isCookingAction(attempt.action));
    const successfulNetActions = netActions.filter(isSuccessfulAttempt);
    const successfulCookingActions = cookingActions.filter(isSuccessfulAttempt);
    const rawFishGainedValue = rawFishGained(input.perceptions) ? 1 : 0;
    const rawFishReceivedEvents = allEvents(input).filter(isRawStarterFishReceivedEvent).length;
    const fishingXpIncreasedValue = skillXpIncreased(input.perceptions, 'fishing') ? 1 : 0;
    const cookedFishGainedValue = cookedFishGained(input.perceptions) ? 1 : 0;
    const cookedFishReceivedEvents = allEvents(input).filter(isCookedStarterFishReceivedEvent).length;
    const cookingXpIncreasedValue = skillXpIncreased(input.perceptions, 'cooking') ? 1 : 0;
    const cookingSuccessEvents = allEvents(input).filter(isCookingSuccessEvent).length;
    const rawFishEvidence = rawFishGainedValue || rawFishReceivedEvents || fishingXpIncreasedValue ? 1 : 0;
    const cookingSuccess = cookedFishGainedValue || cookedFishReceivedEvents || cookingXpIncreasedValue || cookingSuccessEvents ? 1 : 0;
    const externalFishSupplyActions = input.actions.filter(attempt => isExternalFishSupplyAction(attempt.action)).length;
    return {
        actionsAttempted: input.actions.length,
        netActions: netActions.length,
        successfulNetActions: successfulNetActions.length,
        cookingActions: cookingActions.length,
        successfulCookingActions: successfulCookingActions.length,
        rawFishGained: rawFishGainedValue,
        rawFishReceivedEvents,
        fishingXpIncreased: fishingXpIncreasedValue,
        rawFishEvidence,
        cookedFishGained: cookedFishGainedValue,
        cookedFishReceivedEvents,
        cookingXpIncreased: cookingXpIncreasedValue,
        cookingSuccessEvents,
        cookingSuccess,
        externalFishSupplyActions,
        smallNetPresent: input.perceptions.some(perception => inventory(perception).some(isSmallFishingNetItem)) ? 1 : 0,
        fishingSpotObserved: input.perceptions.some(perception => nearbyNpcs(perception).some(isNetCapableFishingSpot)) ? 1 : 0,
        heatSourceObserved: input.perceptions.some(perception => nearbyObjects(perception).some(isHeatSourceObject)) ? 1 : 0,
        orderedActionChain: orderedActionChain(input.actions, isNetFishingAction, isCookingAction) ? 1 : 0,
        unsafeLoops: repeatedWorkflowLoop([...netActions, ...cookingActions]) ? 1 : 0,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): FishingCooking10mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function scriptedNextAction(perception: Perception | undefined): AgentAction | undefined {
    if (!perception) {
        return undefined;
    }
    const rawSlot = findInventorySlot(perception, isRawStarterFishItem);
    const heatSource = nearbyObjects(perception).find(isHeatSourceObject);
    if (rawSlot !== undefined && heatSource) {
        return { kind: 'use_item_on', itemSlot: rawSlot, target: heatSource, cause: 'benchmark_fishing_cooking_10m' };
    }
    if (rawSlot !== undefined) {
        const tinderboxSlot = findInventorySlot(perception, isTinderboxItem);
        const logSlot = findInventorySlot(perception, isFiremakingLogItem);
        if (tinderboxSlot !== undefined && logSlot !== undefined) {
            return {
                kind: 'use_item_on_item',
                itemSlot: tinderboxSlot,
                targetSlot: logSlot,
                cause: 'benchmark_fishing_cooking_make_fire',
            };
        }
    }
    const spot = nearbyNpcs(perception).find(isNetCapableFishingSpot);
    if (spot && rawSlot === undefined) {
        return { kind: 'interact', target: spot, option: 'net', cause: 'benchmark_fishing_cooking_10m' };
    }
    return undefined;
}

function alreadyTried(actions: FishingCooking10mActionAttempt[], action: AgentAction): boolean {
    const key = workflowActionKey(action);
    return actions.some(attempt => workflowActionKey(attempt.action) === key);
}

function isNetFishingAction(action: AgentAction): boolean {
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    return /^net$/i.test(stringField(action, 'option') || '') && isNetCapableFishingSpot(action.target);
}

function isCookingAction(action: AgentAction): boolean {
    if (action.kind !== 'use_item_on' || !isRecord(action.target)) {
        return false;
    }
    return isHeatSourceObject(action.target) || /cook|cooking/i.test(stringField(action, 'cause') || '');
}

function isSuccessfulAttempt(attempt: FishingCooking10mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    const status = attempt.finalStatus || stringField(attempt as unknown as Record<string, unknown>, 'status');
    return !status || !/fail|reject|error|timeout|blocked/i.test(status);
}

function orderedActionChain(
    actions: FishingCooking10mActionAttempt[],
    firstPredicate: (action: AgentAction) => boolean,
    secondPredicate: (action: AgentAction) => boolean,
): boolean {
    const first = actions.findIndex(attempt => firstPredicate(attempt.action));
    const second = actions.findIndex(attempt => secondPredicate(attempt.action));
    return first >= 0 && second > first;
}

function repeatedWorkflowLoop(attempts: FishingCooking10mActionAttempt[]): boolean {
    let lastKey: string | undefined;
    let repeated = 0;
    for (const attempt of attempts) {
        const key = workflowActionKey(attempt.action);
        repeated = key === lastKey ? repeated + 1 : 1;
        lastKey = key;
        if (repeated >= MAX_REPEATED_WORKFLOW_ACTIONS) {
            return true;
        }
    }
    return false;
}

function workflowActionKey(action: AgentAction): string {
    const actionRecord = action as Record<string, unknown>;
    const target = isRecord(actionRecord.target) ? actionRecord.target : {};
    return JSON.stringify({
        kind: action.kind,
        option: stringField(action, 'option')?.toLowerCase(),
        targetKey:
            stringField(target, 'key') || stringField(target, 'name') || stringField(target, 'id') || numericField(target, 'objectId'),
    });
}

function rawFishGained(perceptions: Perception[]): boolean {
    return itemCountIncreases(perceptions, isRawStarterFishItem);
}

function cookedFishGained(perceptions: Perception[]): boolean {
    return itemCountIncreases(perceptions, isCookedStarterFishItem);
}

function itemCountIncreases(perceptions: Perception[], predicate: (item: Record<string, unknown> | null) => boolean): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let maxCount = matchingItemCount(perceptions[0], predicate);
    for (const perception of perceptions.slice(1)) {
        const count = matchingItemCount(perception, predicate);
        if (count > maxCount) {
            return true;
        }
        maxCount = Math.max(maxCount, count);
    }
    return false;
}

function matchingItemCount(perception: Perception, predicate: (item: Record<string, unknown> | null) => boolean): number {
    return inventory(perception).reduce((total, item) => {
        if (!item || !predicate(item)) {
            return total;
        }
        return total + numericField(item, 'amount', 1);
    }, 0);
}

function isRawStarterFishReceivedEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'item_received' && isRecord(event.item) && isRawStarterFishItem(event.item);
}

function isCookedStarterFishReceivedEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'item_received' && isRecord(event.item) && isCookedStarterFishItem(event.item);
}

function isCookingSuccessEvent(event: PerceptionEvent): boolean {
    const kind = stringField(event, 'kind');
    if (kind === 'xp_gained' && stringField(event, 'skill') === 'cooking') {
        return true;
    }
    const text = stringField(event, 'text') || stringField(event, 'message') || '';
    return /successfully cook|cooking xp|cook(ed)? the/i.test(text);
}

function skillXpIncreased(perceptions: Perception[], skill: string): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let maxXp = skillXp(perceptions[0], skill);
    for (const perception of perceptions.slice(1)) {
        const xp = skillXp(perception, skill);
        if (xp !== undefined && maxXp !== undefined && xp > maxXp) {
            return true;
        }
        if (xp !== undefined && (maxXp === undefined || xp > maxXp)) {
            maxXp = xp;
        }
    }
    return false;
}

function skillXp(perception: Perception, skill: string): number | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const skills = isRecord(resident.skills) ? resident.skills : {};
    const entry = isRecord(skills[skill]) ? skills[skill] : undefined;
    if (!entry) {
        return undefined;
    }
    const xp = numericField(entry, 'xp', Number.NaN);
    return Number.isFinite(xp) ? xp : undefined;
}

function isExternalFishSupplyAction(action: AgentAction): boolean {
    if (action.kind === 'trade_offer_item' || action.kind === 'trade_accept_stage_1' || action.kind === 'trade_accept_stage_2') {
        return true;
    }
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    const option = stringField(action, 'option') || '';
    return /pick.?up|take/i.test(option) && (isRawStarterFishItem(action.target) || isCookedStarterFishItem(action.target));
}

function findInventorySlot(perception: Perception, predicate: (item: Record<string, unknown> | null) => boolean): number | undefined {
    const items = inventory(perception);
    for (let index = 0; index < items.length; index += 1) {
        if (predicate(items[index])) {
            return index;
        }
    }
    return undefined;
}

function allEvents(input: FishingCooking10mVerificationInput): PerceptionEvent[] {
    return [...input.events, ...input.perceptions.flatMap(perceptionEvents)];
}

function perceptionEvents(perception: Perception): PerceptionEvent[] {
    return Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
}

function inventory(perception: Perception): Array<Record<string, unknown> | null> {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return Array.isArray(resident.inventory) ? (resident.inventory as Array<Record<string, unknown> | null>) : [];
}

function nearbyNpcs(perception: Perception): Array<Record<string, unknown>> {
    const nearby = isRecord(perception.nearby) ? perception.nearby : {};
    return Array.isArray(nearby.npcs) ? (nearby.npcs.filter(isRecord) as Array<Record<string, unknown>>) : [];
}

function nearbyObjects(perception: Perception): Array<Record<string, unknown>> {
    const nearby = isRecord(perception.nearby) ? perception.nearby : {};
    return Array.isArray(nearby.objects) ? (nearby.objects.filter(isRecord) as Array<Record<string, unknown>>) : [];
}

function isNetCapableFishingSpot(value: Record<string, unknown>): boolean {
    return NET_CAPABLE_FISHING_SPOT_KEYS.has(stringField(value, 'key') || '');
}

function isHeatSourceObject(value: Record<string, unknown>): boolean {
    return HEAT_SOURCE_OBJECT_IDS.has(numericField(value, 'objectId'));
}

function isSmallFishingNetItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    return SMALL_FISHING_NET_ITEM_IDS.has(numericField(item, 'itemId')) || /\bsmall_fishing_net\b/i.test(stringField(item, 'key') || '');
}

function isTinderboxItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    return numericField(item, 'itemId') === 590 || /\btinderbox\b/i.test(stringField(item, 'key') || '');
}

function isFiremakingLogItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    return numericField(item, 'itemId') === 1511 || /^rs:(logs|.*_logs)$/i.test(stringField(item, 'key') || '');
}

function isRawStarterFishItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    const key = stringField(item, 'key');
    return RAW_STARTER_FISH_ITEM_IDS.has(numericField(item, 'itemId')) || Boolean(key && RAW_STARTER_FISH_KEY_PATTERN.test(key));
}

function isCookedStarterFishItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    const key = stringField(item, 'key');
    return COOKED_STARTER_FISH_ITEM_IDS.has(numericField(item, 'itemId')) || Boolean(key && COOKED_STARTER_FISH_KEY_PATTERN.test(key));
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
