import { objectIds } from '@engine/world/config/object-ids';
import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const STARTER_MINING_5M_TASK_ID = 'starter-mining-5m';
export const STARTER_MINING_5M_TASK_VERSION = '0.1.0';
export const STARTER_MINING_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3228, y: 3145, level: 0 };
const BRONZE_PICKAXE_ITEM_ID = 1265;
const STARTER_ORE_OBJECT_IDS = new Set([
    ...objectIds.default.clay.map(rock => rock.default),
    ...objectIds.default.copper.map(rock => rock.default),
    ...objectIds.default.tin.map(rock => rock.default),
]);
const STARTER_ORE_ITEM_IDS = new Set([434, 436, 438]);
const PICKAXE_ITEM_IDS = new Set([1265, 1267, 1269, 1273, 1271, 1275]);
const STARTER_ORE_KEY_PATTERN = /^rs:(clay|copper_ore|tin_ore)$/i;
const PICKAXE_KEY_PATTERN = /(^|[:_\s-])pickaxe([:_\s-]|$)/i;

const FALLBACK_COPPER_ROCK = {
    objectId: objectIds.default.copper.find(rock => rock.default === 11936)?.default || objectIds.default.copper[0].default,
    position: { x: 3228, y: 3144, level: 0 },
};

export interface StarterMining5mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
}

export interface StarterMining5mVerificationInput {
    elapsedMs: number;
    actions: StarterMining5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeStarterMining5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: STARTER_MINING_5M_TASK_ID,
        version: STARTER_MINING_5M_TASK_VERSION,
        timeoutMs: STARTER_MINING_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: BRONZE_PICKAXE_ITEM_ID }],
            initialSkills: { mining: { exp: 0, level: 1 } },
        },
        run: async context => {
            const startedAt = now();
            const actions: StarterMining5mActionAttempt[] = [];
            const rock = (await waitForStarterOreRock(context, startedAt, now)) || FALLBACK_COPPER_ROCK;
            const action: AgentAction = {
                kind: 'interact',
                target: rock,
                option: 'mine',
                cause: 'benchmark_starter_mining_5m',
            };
            const attempt: StarterMining5mActionAttempt = { action };
            actions.push(attempt);
            attempt.result = await context.submitAction(action);
            context.recordSummary('Submitted mine action for starter-mining-5m.');

            while (!context.signal.aborted && now() - startedAt < STARTER_MINING_5M_BUDGET_MS) {
                const outcome = verifyStarterMining5m({
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

            return verifyStarterMining5m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for starter-mining-5m.');

            while (!context.signal.aborted && now() - startedAt < STARTER_MINING_5M_BUDGET_MS) {
                const outcome = verifyStarterMining5m({
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

            return verifyStarterMining5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyStarterMining5m(input: StarterMining5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = starterMiningMetrics(input);
    if (input.elapsedMs > STARTER_MINING_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'starter-mining-5m exceeded the 5 minute budget before success was observed',
        };
    }

    if (metrics.mineActions === 0) {
        return {
            status: 'failed',
            score: noMineActionScore(metrics),
            metrics,
            failureReason: 'No mine action was attempted at a starter ore rock',
        };
    }

    if (metrics.successfulMineActions === 0) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            failureReason: 'No successful mine action was observed at a starter ore rock',
        };
    }

    if (metrics.miningSuccess > 0) {
        return {
            status: 'passed',
            score: 1,
            metrics,
            summaries: ['starter-mining-5m observed a mine action and starter ore or Mining XP evidence.'],
        };
    }

    if (metrics.externalOreSupplyActions > 0 && (metrics.oreGained > 0 || metrics.oreReceivedEvents > 0)) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason: 'Starter ore appeared after mining, but it was externally supplied rather than mined',
        };
    }

    return {
        status: 'failed',
        score: 0.65,
        metrics,
        failureReason: 'No starter ore or Mining XP evidence was observed after mining',
    };
}

function starterMiningMetrics(input: StarterMining5mVerificationInput): Record<string, number> {
    const mineActions = input.actions.filter(attempt => isStarterOreMineAction(attempt.action));
    const successfulMineActions = mineActions.filter(isSuccessfulAttempt);
    const oreGainedValue = oreGained(input.perceptions) ? 1 : 0;
    const oreReceivedEvents = allEvents(input).filter(isStarterOreReceivedEvent).length;
    const miningLevelEvents = allEvents(input).filter(isMiningLevelEvent).length;
    const miningXpIncreasedValue = miningXpIncreased(input.perceptions) ? 1 : 0;
    const externalOreSupplyActions = input.actions.filter(attempt => isExternalOreSupplyAction(attempt.action)).length;
    const oreInventoryEvidence = oreGainedValue || oreReceivedEvents ? 1 : 0;
    const miningSkillEvidence = miningLevelEvents || miningXpIncreasedValue ? 1 : 0;
    return {
        actionsAttempted: input.actions.length,
        approachActions: input.actions.filter(attempt => attempt.action.kind === 'move_to' && targetIsStarterMine(attempt.action.target))
            .length,
        mineActions: mineActions.length,
        successfulMineActions: successfulMineActions.length,
        pickaxePresent: input.perceptions.some(perception => inventory(perception).some(isPickaxeItem)) ? 1 : 0,
        starterOreObserved: input.perceptions.some(perception => nearbyObjects(perception).some(isStarterOreRock)) ? 1 : 0,
        oreGained: oreGainedValue,
        oreReceivedEvents,
        miningLevelEvents,
        miningXpIncreased: miningXpIncreasedValue,
        externalOreSupplyActions,
        miningEvidence: oreInventoryEvidence || miningSkillEvidence ? 1 : 0,
        miningSuccess: miningSkillEvidence || (oreInventoryEvidence && externalOreSupplyActions === 0) ? 1 : 0,
        movedTowardStarterMine: movedTowardStarterMine(input.perceptions) ? 1 : 0,
    };
}

function noMineActionScore(metrics: Record<string, number>): number {
    if (metrics.approachActions > 0 || metrics.movedTowardStarterMine > 0) {
        return 0.35;
    }
    if (metrics.starterOreObserved > 0 && metrics.pickaxePresent > 0) {
        return 0.25;
    }
    return 0;
}

function selectedModuleActionAttempts(context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0]): StarterMining5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

async function waitForStarterOreRock(
    context: Parameters<BenchmarkTask['run']>[0],
    startedAt: number,
    now: () => number,
): Promise<Record<string, unknown> | undefined> {
    for (
        let attempts = 0;
        attempts < LIVE_ROCK_DISCOVERY_ATTEMPTS && !context.signal.aborted && now() - startedAt < STARTER_MINING_5M_BUDGET_MS;
        attempts += 1
    ) {
        const rock = findNearbyStarterOreRock(context.latestPerception());
        if (rock) {
            return rock;
        }
        await sleep(1000, context.signal);
    }
    return undefined;
}

function findNearbyStarterOreRock(perception: Perception | undefined): Record<string, unknown> | undefined {
    if (!perception) {
        return undefined;
    }
    const rocks = nearbyObjects(perception).filter(isStarterOreRock);
    const here = residentPosition(perception);
    if (!here) {
        return rocks[0];
    }
    return rocks.sort((a, b) => {
        const aPosition = positionField(a, 'position') || positionFromRecord(a);
        const bPosition = positionField(b, 'position') || positionFromRecord(b);
        return distance(aPosition || FALLBACK_COPPER_ROCK.position, here) - distance(bPosition || FALLBACK_COPPER_ROCK.position, here);
    })[0];
}

function isStarterOreMineAction(action: AgentAction): boolean {
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    const option = stringField(action, 'option') || '';
    return /^mine$/i.test(option) && isStarterOreRock(action.target);
}

function isSuccessfulAttempt(attempt: StarterMining5mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    const status = attempt.finalStatus || stringField(attempt as unknown as Record<string, unknown>, 'status');
    return !status || !/fail|reject|error|timeout|blocked/i.test(status);
}

function isExternalOreSupplyAction(action: AgentAction): boolean {
    if (action.kind === 'trade_offer_item' || action.kind === 'trade_accept_stage_1' || action.kind === 'trade_accept_stage_2') {
        return true;
    }
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    const option = stringField(action, 'option') || '';
    return /pick.?up|take/i.test(option) && isStarterOreItem(action.target);
}

function targetIsStarterMine(target: unknown): boolean {
    if (!isRecord(target)) {
        return false;
    }
    const position = positionField(target, 'position') || positionFromRecord(target);
    if (!position) {
        return false;
    }
    return distance(position, FALLBACK_COPPER_ROCK.position) <= 8;
}

function oreGained(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let maxOre = starterOreCount(perceptions[0]);
    for (const perception of perceptions.slice(1)) {
        const count = starterOreCount(perception);
        if (count > maxOre) {
            return true;
        }
        maxOre = Math.max(maxOre, count);
    }
    return false;
}

function starterOreCount(perception: Perception): number {
    return inventory(perception).reduce((total, item) => {
        if (!isStarterOreItem(item)) {
            return total;
        }
        return total + numericField(item, 'amount', 1);
    }, 0);
}

function movedTowardStarterMine(perceptions: Perception[]): boolean {
    const positions = perceptions
        .map(residentPosition)
        .filter((position): position is { x: number; y: number; level: number } => !!position);
    if (positions.length < 2) {
        return false;
    }
    const first = distance(positions[0], FALLBACK_COPPER_ROCK.position);
    return positions.slice(1).some(position => distance(position, FALLBACK_COPPER_ROCK.position) < first);
}

function residentPosition(perception: Perception): { x: number; y: number; level: number } | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    return positionField(resident, 'position');
}

function isStarterOreReceivedEvent(event: PerceptionEvent): boolean {
    if (stringField(event, 'kind') !== 'item_received' || !isRecord(event.item)) {
        return false;
    }
    return isStarterOreItem(event.item);
}

function isMiningLevelEvent(event: PerceptionEvent): boolean {
    return stringField(event, 'kind') === 'level_up' && stringField(event, 'skill') === 'mining';
}

function miningXpIncreased(perceptions: Perception[]): boolean {
    if (perceptions.length < 2) {
        return false;
    }
    let maxXp = miningXp(perceptions[0]);
    for (const perception of perceptions.slice(1)) {
        const xp = miningXp(perception);
        if (xp !== undefined && maxXp !== undefined && xp > maxXp) {
            return true;
        }
        if (xp !== undefined && (maxXp === undefined || xp > maxXp)) {
            maxXp = xp;
        }
    }
    return false;
}

function miningXp(perception: Perception): number | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const skills = isRecord(resident.skills) ? resident.skills : {};
    const mining = isRecord(skills.mining) ? skills.mining : undefined;
    if (!mining) {
        return undefined;
    }
    const xp = numericField(mining, 'xp', Number.NaN);
    return Number.isFinite(xp) ? xp : undefined;
}

function allEvents(input: StarterMining5mVerificationInput): PerceptionEvent[] {
    return [...input.events, ...input.perceptions.flatMap(perceptionEvents)];
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

function isStarterOreRock(value: Record<string, unknown>): boolean {
    return STARTER_ORE_OBJECT_IDS.has(numericField(value, 'objectId'));
}

function isStarterOreItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    const key = stringField(item, 'key');
    if (key && STARTER_ORE_KEY_PATTERN.test(key)) {
        return true;
    }
    return STARTER_ORE_ITEM_IDS.has(numericField(item, 'itemId'));
}

function isPickaxeItem(item: Record<string, unknown> | null): item is Record<string, unknown> {
    if (!item) {
        return false;
    }
    const key = stringField(item, 'key') || '';
    return PICKAXE_ITEM_IDS.has(numericField(item, 'itemId')) || PICKAXE_KEY_PATTERN.test(key);
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
const LIVE_ROCK_DISCOVERY_ATTEMPTS = 5;
