import type { AgentAction, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const WORLD_EVENT_REACTION_5M_TASK_ID = 'world-event-reaction-5m';
export const WORLD_EVENT_REACTION_5M_TASK_VERSION = '0.1.0';
export const WORLD_EVENT_REACTION_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3225, y: 3230, level: 0 };
const PEER_POSITION = { x: 3227, y: 3230, level: 0 };
const DEFAULT_QUESTION_DELAY_MS = 1500;
const WORLD_EVENT_QUESTION_TEXT = 'agent, what did res:duke do nearby?';

export interface WorldEventReaction5mActionAttempt {
    action: AgentAction;
    sparkModule?: { id: string; version: string };
}

export interface WorldEventReaction5mVerificationInput {
    elapsedMs: number;
    actions: WorldEventReaction5mActionAttempt[];
    events: PerceptionEvent[];
}

export function makeWorldEventReaction5mBenchmarkTask(
    now: () => number = () => Date.now(),
    questionDelayMs: number = DEFAULT_QUESTION_DELAY_MS,
): BenchmarkTask {
    return {
        id: WORLD_EVENT_REACTION_5M_TASK_ID,
        version: WORLD_EVENT_REACTION_5M_TASK_VERSION,
        timeoutMs: WORLD_EVENT_REACTION_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        peers: [
            {
                id: 'codex',
                spawnPosition: PEER_POSITION,
            },
        ],
        run: async context => runWorldEventReaction(context, now, questionDelayMs, false),
        runAutonomous: async context => runWorldEventReaction(context, now, questionDelayMs, true),
    };
}

export function verifyWorldEventReaction5m(input: WorldEventReaction5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = worldEventReactionMetrics(input);
    if (input.elapsedMs > WORLD_EVENT_REACTION_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'world-event-reaction-5m exceeded the 5 minute budget before success was observed',
        };
    }

    if (metrics.worldEventQuestions === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No benchmark peer world-event question was observed',
        };
    }

    if (metrics.sayActions === 0) {
        return {
            status: 'failed',
            score: 0.35,
            metrics,
            failureReason: 'Resident did not answer the cross-resident world-event question in public chat',
        };
    }

    if (metrics.sourceMentions === 0 || metrics.fireMentions === 0) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'Resident answered but did not mention the source resident and fire event',
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['world-event-reaction-5m observed a selected-module chat answer using a cross-resident fire memory.'],
    };
}

async function runWorldEventReaction(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
    now: () => number,
    questionDelayMs: number,
    autonomous: boolean,
): Promise<BenchmarkTaskOutcome> {
    const startedAt = now();
    context.recordSummary('Waiting for benchmark-injected LoreBus fire_lit event before asking the resident to recall it.');
    await sleep(questionDelayMs, context.signal);
    await context.submitPeerAction('codex', {
        kind: 'say',
        text: WORLD_EVENT_QUESTION_TEXT,
        cause: 'benchmark_world_event_reaction_5m_peer_question',
    });
    const actionOffset = selectedModuleActionAttempts(context).length;
    context.recordSummary('Benchmark peer asked about the nearby res:duke fire_lit world event.');

    while (!context.signal.aborted && now() - startedAt < WORLD_EVENT_REACTION_5M_BUDGET_MS) {
        const actions = autonomous ? selectedModuleActionAttempts(context).slice(actionOffset) : selectedModuleActionAttempts(context);
        const outcome = verifyWorldEventReaction5m({
            elapsedMs: now() - startedAt,
            actions,
            events: [...context.events()],
        });
        if (outcome.status === 'passed') {
            return outcome;
        }
        await sleep(500, context.signal);
    }

    return verifyWorldEventReaction5m({
        elapsedMs: now() - startedAt,
        actions: autonomous ? selectedModuleActionAttempts(context).slice(actionOffset) : selectedModuleActionAttempts(context),
        events: [...context.events()],
    });
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): WorldEventReaction5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function worldEventReactionMetrics(input: WorldEventReaction5mVerificationInput): Record<string, number> {
    const reports = input.actions
        .map(attempt => attempt.action)
        .filter(isSayAction)
        .map(action => action.text);
    return {
        actionsAttempted: input.actions.length,
        worldEventQuestions: input.events.filter(isWorldEventQuestion).length,
        sayActions: reports.length,
        sourceMentions: reports.some(report => /\b(res:)?duke\b/i.test(report)) ? 1 : 0,
        fireMentions: reports.some(report => /\b(fire|lit|burn)\b/i.test(report)) ? 1 : 0,
    };
}

function isWorldEventQuestion(event: PerceptionEvent): boolean {
    if (!isRecord(event) || event.kind !== 'chat' || typeof event.text !== 'string') {
        return false;
    }
    const text = event.text.toLowerCase();
    return text.includes('what did') && text.includes('res:duke') && text.includes('nearby');
}

function isSayAction(action: AgentAction): action is AgentAction & { text: string } {
    return action.kind === 'say' && typeof (action as { text?: unknown }).text === 'string';
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
