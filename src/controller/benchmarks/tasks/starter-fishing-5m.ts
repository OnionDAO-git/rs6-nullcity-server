import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const STARTER_FISHING_5M_TASK_ID = 'starter-fishing-5m';
export const STARTER_FISHING_5M_TASK_VERSION = '0.1.0';
export const STARTER_FISHING_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3240, y: 3244, level: 0 };
const FISHING_SPOT = {
    id: 'npc:316',
    kind: 'npc',
    key: 'rs:fishing_spot_net_bait',
    name: 'Fishing spot',
    position: { x: 3239, y: 3244, level: 0 },
    hpFraction: 1,
};
const MAX_REPEATED_NET_ACTIONS = 10;
const SMALL_FISHING_NET_ITEM_IDS = new Set([303]);
const STARTER_FISH_ITEM_IDS = new Set([317, 321]);
const NET_CAPABLE_FISHING_SPOT_KEYS = new Set(['rs:fishing_spot_net_bait', 'rs:fishing_spot_net_harpoon']);
const STARTER_FISH_KEY_PATTERN = /^rs:raw_(shrimp|anchovies)$/i;

export interface StarterFishing5mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
}

export interface StarterFishing5mVerificationInput {
    elapsedMs: number;
    actions: StarterFishing5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeStarterFishing5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: STARTER_FISHING_5M_TASK_ID,
        version: STARTER_FISHING_5M_TASK_VERSION,
        timeoutMs: STARTER_FISHING_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: 303 }],
        },
        run: async context => {
            const startedAt = now();
            const actions: StarterFishing5mActionAttempt[] = [];
            const fishingSpot = (await waitForFishingSpot(context, startedAt, now)) || FISHING_SPOT;
            const action: AgentAction = {
                kind: 'interact',
                target: fishingSpot,
                option: 'net',
                cause: 'benchmark_starter_fishing_5m',
            };
            const attempt: StarterFishing5mActionAttempt = { action };
            actions.push(attempt);
            attempt.result = await context.submitAction(action);
            context.recordSummary('Submitted net fishing action for starter-fishing-5m.');

            while (!context.signal.aborted && now() - startedAt < STARTER_FISHING_5M_BUDGET_MS) {
                const outcome = verifyStarterFishing5m({
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

            return verifyStarterFishing5m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for starter-fishing-5m.');

            while (!context.signal.aborted && now() - startedAt < STARTER_FISHING_5M_BUDGET_MS) {
                const outcome = verifyStarterFishing5m({
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

            return verifyStarterFishing5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyStarterFishing5m(input: StarterFishing5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = starterFishingMetrics(input);
    if (input.elapsedMs > STARTER_FISHING_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'starter-fishing-5m exceeded the 5 minute budget before success was observed',
        };
    }

    if (metrics.netActions === 0) {
        return {
            status: 'failed',
            score: noNetActionScore(metrics),
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

    if (metrics.fishingSuccess > 0) {
        return {
            status: 'passed',
            score: 1,
            metrics,
            summaries: ['starter-fishing-5m observed a net action and starter fish catch evidence.'],
        };
    }

    if (metrics.externalFishSupplyActions > 0 && (metrics.fishGained > 0 || metrics.fishReceivedEvents > 0)) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason: 'Raw fish appeared after net fishing, but it was externally supplied rather than caught',
        };
    }

    if (metrics.unsafeLoops > 0) {
        return {
            status: 'failed',
            score: 0.15,
            metrics,
            failureReason: 'Detected unsafe loop: repeated net fishing action without catch evidence',
        };
    }

    return {
        status: 'failed',
        score: 0.65,
        metrics,
        failureReason: 'No starter fish catch evidence was observed after net fishing',
    };
}

function starterFishingMetrics(input: StarterFishing5mVerificationInput): Record<string, number> {
    const netActions = input.actions.filter(attempt => isNetFishingAction(attempt.action));
    const successfulNetActions = netActions.filter(isSuccessfulAttempt);
    const fishGainedValue = fishGained(input.perceptions) ? 1 : 0;
    const fishReceivedEvents = allEvents(input).filter(isStarterFishReceivedEvent).length;
    const fishingLevelEvents = allEvents(input).filter(isFishingLevelEvent).length;
    const fishingXpIncreasedValue = fishingXpIncreased(input.perceptions) ? 1 : 0;
    const externalFishSupplyActions = input.actions.filter(attempt => isExternalFishSupplyAction(attempt.action)).length;
    const fishInventoryEvidence = fishGainedValue || fishReceivedEvents ? 1 : 0;
    const fishingSkillEvidence = fishingLevelEvents || fishingXpIncreasedValue ? 1 : 0;
    return {
        actionsAttempted: input.actions.length,
        approachActions: input.actions.filter(attempt => attempt.action.kind === 'move_to' && targetIsFishingSpot(attempt.action.target))
            .length,
        netActions: netActions.length,
        successfulNetActions: successfulNetActions.length,
        smallNetPresent: input.perceptions.some(perception => inventory(perception).some(isSmallFishingNetItem)) ? 1 : 0,
        fishGained: fishGainedValue,
        fishReceivedEvents,
        fishingLevelEvents,
        fishingXpIncreased: fishingXpIncreasedValue,
        externalFishSupplyActions,
        fishingEvidence: fishInventoryEvidence || fishingSkillEvidence ? 1 : 0,
        fishingSuccess: fishingSkillEvidence || (fishInventoryEvidence && externalFishSupplyActions === 0) ? 1 : 0,
        fishingSpotObserved: input.perceptions.some(perception => nearbyNpcs(perception).some(isNetCapableFishingSpot)) ? 1 : 0,
        movedTowardSpot: movedTowardFishingSpot(input.perceptions) ? 1 : 0,
        unsafeLoops: repeatedNetLoop(netActions) ? 1 : 0,
    };
}

function noNetActionScore(metrics: Record<string, number>): number {
    if (metrics.approachActions > 0 || metrics.movedTowardSpot > 0) {
        return 0.35;
    }
    if (metrics.fishingSpotObserved > 0 && metrics.smallNetPresent > 0) {
        return 0.25;
    }
    return 0;
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): StarterFishing5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

async function waitForFishingSpot(
    context: Parameters<BenchmarkTask['run']>[0],
    startedAt: number,
    now: () => number,
): Promise<Record<string, unknown> | undefined> {
    for (let attempts = 0; attempts < 30 && !context.signal.aborted && now() - startedAt < STARTER_FISHING_5M_BUDGET_MS; attempts += 1) {
        const spot = findNearbyFishingSpot(context.latestPerception());
        if (spot) {
            return spot;
        }
        await sleep(1000, context.signal);
    }
    return undefined;
}

function findNearbyFishingSpot(perception: Perception | undefined): Record<string, unknown> | undefined {
    if (!perception) {
        return undefined;
    }
    return nearbyNpcs(perception).find(isNetCapableFishingSpot);
}

function isNetFishingAction(action: AgentAction): boolean {
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    const option = stringField(action, 'option') || '';
    return /^net$/i.test(option) && isNetCapableFishingSpot(action.target);
}

function isSuccessfulAttempt(attempt: StarterFishing5mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    const status = attempt.finalStatus || stringField(attempt as unknown as Record<string, unknown>, 'status');
    return !status || !/fail|reject|error|timeout|blocked/i.test(status);
}

function isExternalFishSupplyAction(action: AgentAction): boolean {
    if (action.kind === 'trade_offer_item' || action.kind === 'trade_accept_stage_1' || action.kind === 'trade_accept_stage_2') {
        return true;
    }
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    const option = stringField(action, 'option') || '';
    return /pick.?up|take/i.test(option) && isStarterFishItem(action.target);
}

function targetIsFishingSpot(target: unknown): boolean {
    if (!isRecord(target)) {
        return false;
    }
    const spot = FISHING_SPOT.position;
    const position = positionField(target, 'position') || positionFromRecord(target);
    if (!position) {
        return false;
    }
    return distance(position, spot) <= 2;
}

function repeatedNetLoop(netActions: StarterFishing5mActionAttempt[]): boolean {
    let lastKey: string | undefined;
    let repeated = 0;
    for (const attempt of netActions) {
        const key = netActionLoopKey(attempt.action);
        repeated = key === lastKey ? repeated + 1 : 1;
        lastKey = key;
        if (repeated >= MAX_REPEATED_NET_ACTIONS) {
            return true;
        }
    }
    return false;
}

function netActionLoopKey(action: AgentAction): string {
    const targetValue = (action as Record<string, unknown>).target;
    const target = isRecord(targetValue) ? targetValue : {};
    return JSON.stringify({
        kind: action.kind,
        option: stringField(action, 'option')?.toLowerCase(),
        targetKey: stringField(target, 'key') || stringField(target, 'name') || stringField(target, 'id'),
    });
}

function fishGained(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let maxFish = starterFishCount(perceptions[0]);
    for (const perception of perceptions.slice(1)) {
        const count = starterFishCount(perception);
        if (count > maxFish) {
            return true;
        }
        maxFish = Math.max(maxFish, count);
    }
    return false;
}

function starterFishCount(perception: Perception): number {
    return inventory(perception).reduce((total, item) => {
        if (!isStarterFishItem(item)) {
            return total;
        }
        return total + numericField(item, 'amount', 1);
    }, 0);
}

function movedTowardFishingSpot(perceptions: Perception[]): boolean {
    const positions = perceptions
        .map(residentPosition)
        .filter((position): position is { x: number; y: number; level: number } => !!position);
    if (positions.length < 2) {
        return false;
    }
    const spot = FISHING_SPOT.position;
    const first = distance(positions[0], spot);
    return positions.slice(1).some(position => distance(position, spot) < first);
}

function residentPosition(perception: Perception): { x: number; y: number; level: number } | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return positionField(resident, 'position');
}

function isStarterFishReceivedEvent(event: PerceptionEvent): boolean {
    if (stringField(event, 'kind') !== 'item_received' || !isRecord(event.item)) {
        return false;
    }
    return isStarterFishItem(event.item);
}

function isFishingLevelEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'level_up' && stringField(event, 'skill') === 'fishing';
}

function fishingXpIncreased(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let maxXp = fishingXp(perceptions[0]);
    for (const perception of perceptions.slice(1)) {
        const xp = fishingXp(perception);
        if (xp !== undefined && maxXp !== undefined && xp > maxXp) {
            return true;
        }
        if (xp !== undefined && (maxXp === undefined || xp > maxXp)) {
            maxXp = xp;
        }
    }
    return false;
}

function fishingXp(perception: Perception): number | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const skills = isRecord(resident.skills) ? resident.skills : {};
    const fishing = isRecord(skills.fishing) ? skills.fishing : undefined;
    if (!fishing) {
        return undefined;
    }
    const xp = numericField(fishing, 'xp', Number.NaN);
    return Number.isFinite(xp) ? xp : undefined;
}

function allEvents(input: StarterFishing5mVerificationInput): PerceptionEvent[] {
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

function isNetCapableFishingSpot(value: Record<string, unknown>): boolean {
    return NET_CAPABLE_FISHING_SPOT_KEYS.has(stringField(value, 'key') || '');
}

function isStarterFishItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    const key = stringField(item, 'key');
    if (key && STARTER_FISH_KEY_PATTERN.test(key)) {
        return true;
    }
    return STARTER_FISH_ITEM_IDS.has(numericField(item, 'itemId'));
}

function isSmallFishingNetItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    const key = stringField(item, 'key') || '';
    return SMALL_FISHING_NET_ITEM_IDS.has(numericField(item, 'itemId')) || /\bsmall_fishing_net\b/i.test(key);
}

function positionField(record: Record<string, unknown>, key: string): { x: number; y: number; level: number } | undefined {
    const value = record[key];
    if (!isRecord(value)) {
        return undefined;
    }
    return positionFromRecord(value);
}

function positionFromRecord(record: Record<string, unknown>): { x: number; y: number; level: number } | undefined {
    const { x, y, level } = record;
    if (typeof x !== 'number' || typeof y !== 'number') {
        return undefined;
    }
    return { x, y, level: typeof level === 'number' ? level : 0 };
}

function distance(a: { x: number; y: number; level?: number }, b: { x: number; y: number; level?: number }): number {
    if ((a.level ?? 0) !== (b.level ?? 0)) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
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
