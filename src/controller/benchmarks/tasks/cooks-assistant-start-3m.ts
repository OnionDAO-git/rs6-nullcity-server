import type { ActionResult, AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const COOKS_ASSISTANT_START_3M_TASK_ID = 'cooks-assistant-start-3m';
export const COOKS_ASSISTANT_START_3M_TASK_VERSION = '0.1.0';
export const COOKS_ASSISTANT_START_3M_BUDGET_MS = 3 * 60 * 1000;

const COOKS_ASSISTANT_QUEST_ID = 'rs:cooks_assistant';
const COOK_KEY = 'rs:lumbridge_castle_cook';
const START_POSITION = { x: 3208, y: 3215, level: 0 };
const LIVE_COOK_DISCOVERY_ATTEMPTS = 10;
const DEFAULT_DIALOGUE_STEP_DELAY_MS = 600;

const START_QUEST_DIALOGUE_SEQUENCE: AgentAction[] = [
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_choice', optionIndex: 0, cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_continue', cause: 'benchmark_cooks_assistant_start' },
    { kind: 'dialogue_choice', optionIndex: 0, cause: 'benchmark_cooks_assistant_start' },
];

export interface CooksAssistantStart3mActionAttempt {
    action: AgentAction;
    result?: ActionResult;
    finalStatus?: string;
}

export interface CooksAssistantStart3mVerificationInput {
    elapsedMs: number;
    actions: CooksAssistantStart3mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeCooksAssistantStart3mBenchmarkTask(
    now: () => number = () => Date.now(),
    dialogueStepDelayMs = DEFAULT_DIALOGUE_STEP_DELAY_MS,
): BenchmarkTask {
    return {
        id: COOKS_ASSISTANT_START_3M_TASK_ID,
        version: COOKS_ASSISTANT_START_3M_TASK_VERSION,
        timeoutMs: COOKS_ASSISTANT_START_3M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        run: async context => {
            const startedAt = now();
            const actions: CooksAssistantStart3mActionAttempt[] = [];
            const cook = await waitForCook(context, startedAt, now);
            if (cook) {
                const talk: AgentAction = {
                    kind: 'interact',
                    target: cook,
                    option: 'talk-to',
                    cause: 'benchmark_cooks_assistant_start',
                };
                await submitAndRecord(context, actions, talk);
                context.recordSummary('Submitted talk-to Cook action for cooks-assistant-start-3m.');

                for (const dialogueAction of START_QUEST_DIALOGUE_SEQUENCE) {
                    await sleep(dialogueStepDelayMs, context.signal);
                    await submitAndRecord(context, actions, dialogueAction);
                    const outcome = verifyCooksAssistantStart3m({
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

            while (!context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_START_3M_BUDGET_MS) {
                const outcome = verifyCooksAssistantStart3m({
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

            return verifyCooksAssistantStart3m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for cooks-assistant-start-3m.');

            while (!context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_START_3M_BUDGET_MS) {
                const outcome = verifyCooksAssistantStart3m({
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

            return verifyCooksAssistantStart3m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyCooksAssistantStart3m(input: CooksAssistantStart3mVerificationInput): BenchmarkTaskOutcome {
    const metrics = cooksAssistantStartMetrics(input);
    if (input.elapsedMs > COOKS_ASSISTANT_START_3M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'cooks-assistant-start-3m exceeded the 3 minute budget before quest progress was observed',
        };
    }

    if (metrics.talkToCookActions === 0) {
        return {
            status: 'failed',
            score: metrics.cookObserved > 0 ? 0.2 : 0,
            metrics,
            failureReason: 'No talk-to Cook action was attempted',
        };
    }

    if (metrics.questStarted > 0) {
        return {
            status: 'passed',
            score: 1,
            metrics,
            summaries: ['cooks-assistant-start-3m observed Cook dialogue actions and quest progress stage 50.'],
        };
    }

    return {
        status: 'failed',
        score: metrics.dialogueActions > 0 ? 0.55 : 0.35,
        metrics,
        failureReason: 'Quest progress did not reach stage 50 after Cook dialogue actions',
    };
}

function cooksAssistantStartMetrics(input: CooksAssistantStart3mVerificationInput): Record<string, number> {
    return {
        actionsAttempted: input.actions.length,
        cookObserved: input.perceptions.some(perception => npcs(perception).some(isCook)) ? 1 : 0,
        talkToCookActions: input.actions.filter(attempt => isTalkToCookAction(attempt.action)).length,
        successfulTalkToCookActions: input.actions.filter(attempt => isTalkToCookAction(attempt.action) && isSuccessfulAttempt(attempt))
            .length,
        dialogueActions: input.actions.filter(attempt => isDialogueAction(attempt.action)).length,
        firstOptionChoices: input.actions.filter(
            attempt => attempt.action.kind === 'dialogue_choice' && numericField(attempt.action, 'optionIndex') === 0,
        ).length,
        questStarted: input.perceptions.some(hasCooksAssistantStarted) ? 1 : 0,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): CooksAssistantStart3mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

async function submitAndRecord(
    context: Parameters<BenchmarkTask['run']>[0],
    actions: CooksAssistantStart3mActionAttempt[],
    action: AgentAction,
): Promise<void> {
    const attempt: CooksAssistantStart3mActionAttempt = { action };
    actions.push(attempt);
    attempt.result = await context.submitAction(action);
}

async function waitForCook(
    context: Parameters<BenchmarkTask['run']>[0],
    startedAt: number,
    now: () => number,
): Promise<Record<string, unknown> | undefined> {
    for (
        let attempts = 0;
        attempts < LIVE_COOK_DISCOVERY_ATTEMPTS && !context.signal.aborted && now() - startedAt < COOKS_ASSISTANT_START_3M_BUDGET_MS;
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

function isTalkToCookAction(action: AgentAction): boolean {
    if (action.kind !== 'interact' || !isRecord(action.target)) {
        return false;
    }
    return isCook(action.target) && /^talk-to$/i.test(stringField(action, 'option') || '');
}

function isDialogueAction(action: AgentAction): boolean {
    return action.kind === 'dialogue_continue' || action.kind === 'dialogue_choice';
}

function isSuccessfulAttempt(attempt: CooksAssistantStart3mActionAttempt): boolean {
    if (attempt.result?.ok === false) {
        return false;
    }
    const status = attempt.finalStatus || stringField(attempt as unknown as Record<string, unknown>, 'status');
    return !status || !/fail|reject|error|timeout|blocked/i.test(status);
}

function hasCooksAssistantStarted(perception: Perception): boolean {
    const resident = isRecord(perception.resident) ? perception.resident : {};
    const quests = isRecord(resident.quests) ? resident.quests : {};
    const quest = isRecord(quests[COOKS_ASSISTANT_QUEST_ID]) ? quests[COOKS_ASSISTANT_QUEST_ID] : undefined;
    if (!quest) {
        return false;
    }
    const progress = quest.progress;
    return progress === 'complete' || (typeof progress === 'number' && progress >= 50);
}

function npcs(perception: Perception | undefined): Array<Record<string, unknown>> {
    if (!perception || !isRecord(perception.nearby)) {
        return [];
    }
    return Array.isArray(perception.nearby.npcs) ? (perception.nearby.npcs.filter(isRecord) as Array<Record<string, unknown>>) : [];
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
