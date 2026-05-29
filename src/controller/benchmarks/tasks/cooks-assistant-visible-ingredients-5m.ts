import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_TASK_ID = 'cooks-assistant-visible-ingredients-5m';
export const COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_TASK_VERSION = '0.1.0';
export const COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_BUDGET_MS = 5 * 60 * 1000;

const COOKS_ASSISTANT_QUEST_ID = 'rs:cooks_assistant';
const START_POSITION = { x: 3208, y: 3215, level: 0 };
const BUCKET_OF_MILK = 1927;
const POT_OF_FLOUR = 1933;
const EGG = 1944;
const QUEST_INGREDIENT_IDS = new Set([BUCKET_OF_MILK, POT_OF_FLOUR, EGG]);
const SETUP_DROP_CAUSE = 'benchmark_seed_cooks_assistant_visible_ingredients';
const PICKUP_CAUSE = 'cooks_assistant_pickup_ingredient';

export interface CooksAssistantVisibleIngredients5mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    sparkModule?: { id: string; version: string };
}

export interface CooksAssistantVisibleIngredients5mVerificationInput {
    elapsedMs: number;
    actions: CooksAssistantVisibleIngredients5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeCooksAssistantVisibleIngredients5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_TASK_ID,
        version: COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_TASK_VERSION,
        timeoutMs: COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: BUCKET_OF_MILK }, { itemId: POT_OF_FLOUR }, { itemId: EGG }],
        },
        setup: async context => {
            for (const slot of [0, 1, 2]) {
                await context.submitAction({ kind: 'drop', slot, cause: SETUP_DROP_CAUSE });
            }
            context.recordSummary('Dropped Cook Assistant ingredients so the autonomous resident must pick up visible ground items.');
        },
        run: async context => {
            const startedAt = now();
            await submitVisibleIngredientPickups(context);
            while (!context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_BUDGET_MS) {
                const outcome = verifyCooksAssistantVisibleIngredients5m({
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
            return verifyCooksAssistantVisibleIngredients5m({
                elapsedMs: now() - startedAt,
                actions: [...context.actionAttempts()],
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module pickup and completion after benchmark-visible Cook ingredients.');
            while (!context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_BUDGET_MS) {
                const outcome = verifyCooksAssistantVisibleIngredients5m({
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
            return verifyCooksAssistantVisibleIngredients5m({
                elapsedMs: now() - startedAt,
                actions: [...context.actionAttempts()],
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyCooksAssistantVisibleIngredients5m(input: CooksAssistantVisibleIngredients5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = cooksAssistantVisibleIngredientMetrics(input);
    if (input.elapsedMs > COOKS_ASSISTANT_VISIBLE_INGREDIENTS_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'cooks-assistant-visible-ingredients-5m exceeded the 5 minute budget before success was observed',
        };
    }
    if (metrics.setupIngredientDrops < 3) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'Benchmark setup did not drop all three Cook Assistant ingredients',
        };
    }
    if (metrics.ingredientsVisibleOnGround < 3) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            failureReason: 'The resident never perceived all three Cook Assistant ingredients on the ground',
        };
    }
    if (metrics.ingredientPickupActions < 3) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason: 'No selected-module pickup sequence collected all visible Cook Assistant ingredients',
        };
    }
    if (metrics.ingredientsCarriedAfterPickup < 3) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'Pickup actions were attempted, but the resident did not carry all three ingredients afterward',
        };
    }
    if (metrics.questComplete === 0) {
        return {
            status: 'failed',
            score: 0.8,
            metrics,
            failureReason: 'Visible ingredients were collected, but Cook Assistant did not complete',
        };
    }
    if (metrics.ingredientsConsumed < 3) {
        return {
            status: 'failed',
            score: 0.9,
            metrics,
            failureReason: 'Cook Assistant completed but all three gathered ingredients were not shown consumed',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['cooks-assistant-visible-ingredients-5m observed visible ingredient pickup and quest completion.'],
    };
}

function cooksAssistantVisibleIngredientMetrics(input: CooksAssistantVisibleIngredients5mVerificationInput): Record<string, number> {
    const events = [...input.events, ...input.perceptions.flatMap(perception => perceptionEvents(perception))];
    return {
        actionsAttempted: input.actions.length,
        setupIngredientDrops: input.actions.filter(attempt => isSetupIngredientDrop(attempt.action)).length,
        ingredientPickupActions: input.actions.filter(attempt => isSelectedIngredientPickup(attempt)).length,
        ingredientsVisibleOnGround: maxVisibleGroundIngredientCount(input.perceptions),
        ingredientsCarriedAfterPickup: maxCarriedIngredientCountAfterGroundVisibility(input.perceptions),
        handInTalkToCookActions: input.actions.filter(attempt => attempt.action.cause === 'cooks_assistant_hand_in_ingredients').length,
        questStarted: input.perceptions.some(hasCooksAssistantStarted) ? 1 : 0,
        questComplete: input.perceptions.some(hasCooksAssistantComplete) ? 1 : 0,
        ingredientsConsumed: events.filter(isIngredientLossEvent).length || inferredIngredientConsumption(input.perceptions),
    };
}

async function submitVisibleIngredientPickups(context: Parameters<BenchmarkTask['run']>[0]): Promise<void> {
    const seen = new Set<number>();
    for (const item of worldItems(context.latestPerception())) {
        const itemId = numericField(item, 'itemId');
        if (!QUEST_INGREDIENT_IDS.has(itemId) || seen.has(itemId)) {
            continue;
        }
        seen.add(itemId);
        await context.submitAction({ kind: 'interact', target: item, option: 'pick-up', cause: 'benchmark_pickup_visible_ingredient' });
    }
}

function isSetupIngredientDrop(action: AgentAction): boolean {
    return action.kind === 'drop' && action.cause === SETUP_DROP_CAUSE;
}

function isSelectedIngredientPickup(attempt: CooksAssistantVisibleIngredients5mActionAttempt): boolean {
    return (
        Boolean(attempt.sparkModule) &&
        attempt.action.kind === 'interact' &&
        /^pick-up$/i.test(stringField(attempt.action, 'option') || '') &&
        attempt.action.cause === PICKUP_CAUSE &&
        isQuestIngredient(attempt.action.target)
    );
}

function maxVisibleGroundIngredientCount(perceptions: Perception[]): number {
    return perceptions.reduce((max, perception) => Math.max(max, ingredientIdCount(worldItems(perception))), 0);
}

function maxCarriedIngredientCountAfterGroundVisibility(perceptions: Perception[]): number {
    let sawGroundIngredients = false;
    let max = 0;
    for (const perception of perceptions) {
        if (ingredientIdCount(worldItems(perception)) > 0) {
            sawGroundIngredients = true;
        }
        if (sawGroundIngredients) {
            max = Math.max(max, ingredientIdCount(inventory(perception)));
        }
    }
    return max;
}

function inferredIngredientConsumption(perceptions: Perception[]): number {
    if (!perceptions.some(hasCooksAssistantComplete)) {
        return 0;
    }
    const carriedAfterPickup = maxCarriedIngredientCountAfterGroundVisibility(perceptions);
    const finalCount = ingredientIdCount(inventory(perceptions.at(-1)));
    return Math.max(0, carriedAfterPickup - finalCount);
}

function ingredientIdCount(items: Array<Record<string, unknown>>): number {
    const ids = new Set(items.map(item => numericField(item, 'itemId')).filter(itemId => QUEST_INGREDIENT_IDS.has(itemId)));
    return ids.size;
}

function inventory(perception: Perception | undefined): Array<Record<string, unknown>> {
    const resident = isRecord(perception?.resident) ? perception.resident : {};
    return Array.isArray(resident.inventory) ? resident.inventory.filter(isRecord) : [];
}

function worldItems(perception: Perception | undefined): Array<Record<string, unknown>> {
    const nearby = isRecord(perception?.nearby) ? perception.nearby : {};
    return Array.isArray(nearby.worldItems) ? nearby.worldItems.filter(isRecord) : [];
}

function perceptionEvents(perception: Perception | undefined): PerceptionEvent[] {
    return Array.isArray(perception?.events) ? (perception.events.filter(isRecord) as PerceptionEvent[]) : [];
}

function isIngredientLossEvent(event: PerceptionEvent): boolean {
    const kind = stringField(event, 'kind') || '';
    return /item_lost|inventory_item_removed|item_removed/i.test(kind) && QUEST_INGREDIENT_IDS.has(numericField(event, 'itemId'));
}

function hasCooksAssistantStarted(perception: Perception | undefined): boolean {
    const quest = cooksAssistantQuest(perception);
    if (!quest) {
        return false;
    }
    const progress = quest.progress;
    return progress === 'complete' || (typeof progress === 'number' && progress >= 50);
}

function hasCooksAssistantComplete(perception: Perception | undefined): boolean {
    const quest = cooksAssistantQuest(perception);
    return quest?.complete === true || quest?.progress === 'complete';
}

function cooksAssistantQuest(perception: Perception | undefined): Record<string, unknown> | undefined {
    const resident = isRecord(perception?.resident) ? perception.resident : {};
    const quests = isRecord(resident.quests) ? resident.quests : {};
    return isRecord(quests[COOKS_ASSISTANT_QUEST_ID]) ? quests[COOKS_ASSISTANT_QUEST_ID] : undefined;
}

function isQuestIngredient(value: unknown): boolean {
    return isRecord(value) && QUEST_INGREDIENT_IDS.has(numericField(value, 'itemId'));
}

function stringField(record: unknown, key: string): string | undefined {
    return isRecord(record) && typeof record[key] === 'string' ? record[key] : undefined;
}

function numericField(record: unknown, key: string, fallback = 0): number {
    return isRecord(record) && typeof record[key] === 'number' ? record[key] : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
        if (signal.aborted) {
            resolve();
            return;
        }
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
