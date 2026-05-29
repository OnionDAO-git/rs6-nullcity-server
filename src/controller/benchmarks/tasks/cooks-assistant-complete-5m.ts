import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const COOKS_ASSISTANT_COMPLETE_5M_TASK_ID = 'cooks-assistant-complete-5m';
export const COOKS_ASSISTANT_COMPLETE_5M_TASK_VERSION = '0.1.0';
export const COOKS_ASSISTANT_COMPLETE_5M_BUDGET_MS = 5 * 60 * 1000;
const RUNNER_TIMEOUT_HEADROOM_MS = 10_000;

const COOKS_ASSISTANT_QUEST_ID = 'rs:cooks_assistant';
const COOK_KEY = 'rs:lumbridge_castle_cook';
const START_POSITION = { x: 3208, y: 3215, level: 0 };
const LIVE_COOK_DISCOVERY_ATTEMPTS = 10;
const DEFAULT_DIALOGUE_STEP_DELAY_MS = 600;
const BUCKET_OF_MILK = 1927;
const POT_OF_FLOUR = 1933;
const EGG = 1944;
const QUEST_INGREDIENT_IDS = new Set([BUCKET_OF_MILK, POT_OF_FLOUR, EGG]);
const TALK_TO_COOK_RETRY_ATTEMPTS = 8;

const START_QUEST_DIALOGUE_SEQUENCE: AgentAction[] = [
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_choice', optionIndex: 0, cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_choice', optionIndex: 0, cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_choice', optionIndex: 3, cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
];

const HAND_IN_DIALOGUE_SEQUENCE: AgentAction[] = Array.from({ length: 24 }, () => ({
    kind: 'dialogue_continue',
    cause: 'benchmark_cooks_assistant_hand_in',
}));

export interface CooksAssistantComplete5mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
}

export interface CooksAssistantComplete5mVerificationInput {
    elapsedMs: number;
    actions: CooksAssistantComplete5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeCooksAssistantComplete5mBenchmarkTask(
    now: () => number = () => Date.now(),
    dialogueStepDelayMs = DEFAULT_DIALOGUE_STEP_DELAY_MS,
): BenchmarkTask {
    return {
        id: COOKS_ASSISTANT_COMPLETE_5M_TASK_ID,
        version: COOKS_ASSISTANT_COMPLETE_5M_TASK_VERSION,
        timeoutMs: COOKS_ASSISTANT_COMPLETE_5M_BUDGET_MS + RUNNER_TIMEOUT_HEADROOM_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: BUCKET_OF_MILK }, { itemId: POT_OF_FLOUR }, { itemId: EGG }],
        },
        run: async context => {
            const startedAt = now();
            const actions: CooksAssistantComplete5mActionAttempt[] = [];
            const cook = await waitForCook(context, startedAt, now);
            if (cook) {
                const startTalked = await talkToCookUntilSuccessful(
                    context,
                    actions,
                    'benchmark_cooks_assistant_start',
                    startedAt,
                    now,
                    dialogueStepDelayMs,
                    cook,
                );
                if (startTalked) {
                    context.recordSummary("Submitted start-dialogue sequence for Cook's Assistant completion proof.");
                    for (const dialogueAction of START_QUEST_DIALOGUE_SEQUENCE) {
                        await sleep(dialogueStepDelayMs, context.signal);
                        await submitAndRecord(context, actions, dialogueAction);
                    }
                }

                const handInTalked = await talkToCookUntilSuccessful(
                    context,
                    actions,
                    'benchmark_cooks_assistant_hand_in',
                    startedAt,
                    now,
                    dialogueStepDelayMs,
                );
                if (handInTalked) {
                    context.recordSummary("Submitted hand-in sequence for Cook's Assistant completion proof.");
                    for (const dialogueAction of HAND_IN_DIALOGUE_SEQUENCE) {
                        await sleep(dialogueStepDelayMs, context.signal);
                        await submitAndRecord(context, actions, dialogueAction);
                        const outcome = verifyCooksAssistantComplete5m({
                            elapsedMs: now() - startedAt,
                            actions,
                            perceptions: [...context.perceptions()],
                            events: [...context.events()],
                        });
                        if (outcome.status === 'passed') {
                            return outcome;
                        }
                    }
                }
            }

            while (!context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_COMPLETE_5M_BUDGET_MS) {
                const outcome = verifyCooksAssistantComplete5m({
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

            return verifyCooksAssistantComplete5m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary("Observing autonomous module actions for Cook's Assistant full completion.");

            while (!context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_COMPLETE_5M_BUDGET_MS) {
                const outcome = verifyCooksAssistantComplete5m({
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

            return verifyCooksAssistantComplete5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyCooksAssistantComplete5m(input: CooksAssistantComplete5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = cooksAssistantCompleteMetrics(input);
    if (input.elapsedMs > COOKS_ASSISTANT_COMPLETE_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: "cooks-assistant-complete-5m exceeded the 5 minute budget before Cook's Assistant completed",
        };
    }
    if (metrics.ingredientsCarriedAtStart < 3) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'The resident did not start with all three Cook Assistant ingredients',
        };
    }
    if (metrics.startTalkToCookActions === 0) {
        return { status: 'failed', score: 0.15, metrics, failureReason: 'No start talk-to Cook action was attempted' };
    }
    if (metrics.questStarted === 0) {
        return { status: 'failed', score: 0.35, metrics, failureReason: 'Cook Assistant was not started before hand-in' };
    }
    if (metrics.handInTalkToCookActions === 0) {
        return { status: 'failed', score: 0.55, metrics, failureReason: 'No hand-in talk-to Cook action was attempted' };
    }
    if (metrics.questComplete === 0) {
        return { status: 'failed', score: 0.75, metrics, failureReason: 'Cook Assistant did not complete after hand-in dialogue' };
    }
    if (metrics.ingredientsConsumed < 3) {
        return {
            status: 'failed',
            score: 0.9,
            metrics,
            failureReason: 'Cook Assistant completed but the artifact did not show all three ingredients consumed',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['cooks-assistant-complete-5m observed quest start, ingredient hand-in, completion, and ingredient consumption.'],
    };
}

function cooksAssistantCompleteMetrics(input: CooksAssistantComplete5mVerificationInput): Record<string, number> {
    const firstInventory = inventory(input.perceptions[0]);
    const latestInventory = inventory(input.perceptions[input.perceptions.length - 1]);
    const ingredientLossEvents = [...input.events, ...input.perceptions.flatMap(perception => events(perception))].filter(
        isIngredientLossEvent,
    );
    const started = input.perceptions.some(hasCooksAssistantStarted);
    const complete = input.perceptions.some(hasCooksAssistantComplete);
    const latestIngredientCount = ingredientCount(latestInventory);
    return {
        actionsAttempted: input.actions.length,
        cookObserved: input.perceptions.some(perception => npcs(perception).some(isCook)) ? 1 : 0,
        ingredientsCarriedAtStart: ingredientCount(firstInventory),
        ingredientsCarriedAtEnd: latestIngredientCount,
        ingredientsConsumed: Math.max(ingredientLossEvents.length, complete ? 3 - latestIngredientCount : 0),
        startTalkToCookActions: input.actions.filter(attempt => isTalkToCookAction(attempt.action, 'benchmark_cooks_assistant_start'))
            .length,
        handInTalkToCookActions: input.actions.filter(attempt => isTalkToCookAction(attempt.action, 'benchmark_cooks_assistant_hand_in'))
            .length,
        dialogueActions: input.actions.filter(attempt => isDialogueAction(attempt.action)).length,
        firstOptionChoices: input.actions.filter(
            attempt => attempt.action.kind === 'dialogue_choice' && numericField(attempt.action, 'optionIndex') === 0,
        ).length,
        questStarted: started ? 1 : 0,
        questComplete: complete ? 1 : 0,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): CooksAssistantComplete5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

async function talkToCookUntilSuccessful(
    context: Parameters<BenchmarkTask['run']>[0],
    actions: CooksAssistantComplete5mActionAttempt[],
    cause: string,
    startedAt: number,
    now: () => number,
    retryDelayMs: number,
    initialCook?: Record<string, unknown>,
): Promise<boolean> {
    for (
        let attempt = 0;
        attempt < TALK_TO_COOK_RETRY_ATTEMPTS && !context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_COMPLETE_5M_BUDGET_MS;
        attempt += 1
    ) {
        const cook = (attempt === 0 ? initialCook : undefined) || npcs(context.latestPerception()).find(isCook);
        if (!cook) {
            await sleep(Math.max(250, retryDelayMs), context.signal);
            continue;
        }
        const result = await submitAndRecord(context, actions, { kind: 'interact', target: cook, option: 'talk-to', cause });
        if (result.ok !== false) {
            return true;
        }
        await sleep(Math.max(250, retryDelayMs), context.signal);
    }
    context.recordSummary(`Could not open Cook dialogue for ${cause} after ${TALK_TO_COOK_RETRY_ATTEMPTS} attempts.`);
    return false;
}

async function submitAndRecord(
    context: Parameters<BenchmarkTask['run']>[0],
    actions: CooksAssistantComplete5mActionAttempt[],
    action: AgentAction,
): Promise<ActionResult> {
    const attempt: CooksAssistantComplete5mActionAttempt = { action };
    actions.push(attempt);
    attempt.result = await context.submitAction(action);
    return attempt.result;
}

async function waitForCook(
    context: Parameters<BenchmarkTask['run']>[0],
    startedAt: number,
    now: () => number,
): Promise<Record<string, unknown> | undefined> {
    for (
        let attempts = 0;
        attempts < LIVE_COOK_DISCOVERY_ATTEMPTS && !context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_COMPLETE_5M_BUDGET_MS;
        attempts += 1
    ) {
        const cook = npcs(context.latestPerception()).find(isCook);
        if (cook) {
            return cook;
        }
        await sleep(1000, context.signal);
    }
    return undefined;
}

function isTalkToCookAction(action: AgentAction, cause: string): boolean {
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    return isCook(action.target) && /^talk-to$/i.test(stringField(action, 'option') || '') && actionCauseMatches(action, cause);
}

function actionCauseMatches(action: AgentAction, expectedCause: string): boolean {
    const cause = stringField(action, 'cause');
    if (cause === expectedCause) {
        return true;
    }
    if (expectedCause === 'benchmark_cooks_assistant_start') {
        return cause === 'cooks_assistant_talk_to_cook';
    }
    if (expectedCause === 'benchmark_cooks_assistant_hand_in') {
        return cause === 'cooks_assistant_hand_in_ingredients';
    }
    return false;
}

function isDialogueAction(action: AgentAction): boolean {
    return action.kind === 'dialogue_continue' || action.kind === 'dialogue_choice';
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

function npcs(perception: Perception | undefined): Array<Record<string, unknown>> {
    if (!perception || !isRecord(perception.nearby)) {
        return [];
    }
    return Array.isArray(perception.nearby.npcs) ? (perception.nearby.npcs.filter(isRecord) as Array<Record<string, unknown>>) : [];
}

function inventory(perception: Perception | undefined): Array<Record<string, unknown>> {
    const resident = isRecord(perception?.resident) ? perception.resident : {};
    return Array.isArray(resident.inventory) ? (resident.inventory.filter(isRecord) as Array<Record<string, unknown>>) : [];
}

function events(perception: Perception | undefined): PerceptionEvent[] {
    return Array.isArray(perception?.events) ? (perception.events.filter(isRecord) as PerceptionEvent[]) : [];
}

function isIngredientLossEvent(event: PerceptionEvent): boolean {
    const kind = stringField(event, 'kind');
    const itemId = numericField(event, 'itemId');
    return /item_lost|inventory_item_removed|item_removed/i.test(kind || '') && QUEST_INGREDIENT_IDS.has(itemId);
}

function ingredientCount(items: Array<Record<string, unknown>>): number {
    const ids = new Set(items.map(item => numericField(item, 'itemId')).filter(itemId => QUEST_INGREDIENT_IDS.has(itemId)));
    return ids.size;
}

function isCook(value: Record<string, unknown>): boolean {
    return stringField(value, 'kind') === 'npc' && stringField(value, 'key') === COOK_KEY;
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
    if (signal.aborted || ms <= 0) {
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
