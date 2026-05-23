import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const MEMORY_RECALL_3M_TASK_ID = 'memory-recall-3m';
export const MEMORY_RECALL_3M_TASK_VERSION = '0.1.0';
export const MEMORY_RECALL_3M_BUDGET_MS = 3 * 60 * 1000;

const START_POSITION = { x: 3225, y: 3230, level: 0 };
const PEER_POSITION = { x: 3227, y: 3230, level: 0 };
const QUESTION_TEXT = 'Hey friend, what do you remember about alice@onion and my shrimp promise?';
const SCRIPTED_REPLY = 'Alice gave me a tinderbox, and I promised Codex shrimp.';

export interface MemoryRecall3mActionAttempt {
    action: AgentAction;
    sparkModule?: { id: string; version: string };
}

export interface MemoryRecall3mVerificationInput {
    elapsedMs: number;
    actions: MemoryRecall3mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeMemoryRecall3mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: MEMORY_RECALL_3M_TASK_ID,
        version: MEMORY_RECALL_3M_TASK_VERSION,
        timeoutMs: MEMORY_RECALL_3M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        peers: [
            {
                id: 'codex',
                spawnPosition: PEER_POSITION,
            },
        ],
        memorySeeds: [
            {
                kind: 'library_timeline',
                event: {
                    kind: 'patron_gift',
                    patronHandle: 'alice@onion',
                    artifact: 'rs:tinderbox',
                    ts: '2026-05-23T03:00:00.000Z',
                },
            },
            {
                kind: 'library_timeline',
                event: {
                    kind: 'story_note',
                    note: 'I promised to cook shrimp for Codex after practicing fishing.',
                    ts: '2026-05-23T03:01:00.000Z',
                },
            },
        ],
        run: async context => {
            const startedAt = now();
            const actions: MemoryRecall3mActionAttempt[] = [];
            await context.submitPeerAction('codex', { kind: 'say', text: QUESTION_TEXT, cause: 'benchmark_memory_recall_3m_peer' });
            context.recordSummary('Benchmark peer asked the resident to recall seeded Library memories.');

            const replyAction: AgentAction = {
                kind: 'say',
                text: SCRIPTED_REPLY,
                cause: 'benchmark_memory_recall_3m',
            };
            actions.push({ action: replyAction });
            await context.submitAction(replyAction);

            while (!context.signal.aborted && now() - startedAt < MEMORY_RECALL_3M_BUDGET_MS) {
                const outcome = verifyMemoryRecall3m({
                    elapsedMs: now() - startedAt,
                    actions,
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(500, context.signal);
            }

            return verifyMemoryRecall3m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            await context.submitPeerAction('codex', { kind: 'say', text: QUESTION_TEXT, cause: 'benchmark_memory_recall_3m_peer' });
            context.recordSummary('Benchmark peer asked the autonomous resident to recall seeded Library memories.');

            while (!context.signal.aborted && now() - startedAt < MEMORY_RECALL_3M_BUDGET_MS) {
                const outcome = verifyMemoryRecall3m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActionAttempts(context),
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(500, context.signal);
            }

            return verifyMemoryRecall3m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyMemoryRecall3m(input: MemoryRecall3mVerificationInput): BenchmarkTaskOutcome {
    const metrics = memoryRecallMetrics(input);
    if (input.elapsedMs > MEMORY_RECALL_3M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'memory-recall-3m exceeded the 3 minute budget before success was observed',
        };
    }

    if (metrics.memoryQuestions === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No nearby peer memory question was observed',
        };
    }

    if (metrics.sayActions === 0) {
        return {
            status: 'failed',
            score: 0.3,
            metrics,
            failureReason: 'Resident did not answer the memory question in public chat',
        };
    }

    if (metrics.jsonLikeReplies > 0) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason: 'Resident answered with JSON-like prompt echo instead of natural public chat',
        };
    }

    if (metrics.aliceMentions === 0 || metrics.tinderboxMentions === 0 || metrics.shrimpMentions === 0) {
        return {
            status: 'failed',
            score: 0.6,
            metrics,
            failureReason: 'Resident answered but did not mention alice@onion, the tinderbox, and the shrimp promise',
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['memory-recall-3m observed a concrete answer using seeded Library memories.'],
    };
}

function selectedModuleActionAttempts(context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0]): MemoryRecall3mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function memoryRecallMetrics(input: MemoryRecall3mVerificationInput): Record<string, number> {
    const reports = [...spokenReports(input.actions), ...selfChatReports(input)];
    return {
        actionsAttempted: input.actions.length,
        memoryQuestions: memoryQuestions(input).length,
        sayActions: input.actions.filter(attempt => attempt.action.kind === 'say').length,
        jsonLikeReplies: reports.some(looksLikeStructuredChat) ? 1 : 0,
        aliceMentions: reports.some(report => /\balice(@onion)?\b/i.test(report)) ? 1 : 0,
        tinderboxMentions: reports.some(report => /\btinderbox\b/i.test(report)) ? 1 : 0,
        shrimpMentions: reports.some(report => /\bshrimp\b/i.test(report)) ? 1 : 0,
        codexMentions: reports.some(report => /\bcodex\b/i.test(report)) ? 1 : 0,
    };
}

function memoryQuestions(input: MemoryRecall3mVerificationInput): PerceptionEvent[] {
    return allEvents(input).filter(event => {
        const text = normalizeText(stringField(event, 'text') || '');
        return text.includes('remember') && (text.includes('alice') || text.includes('shrimp'));
    });
}

function spokenReports(actions: MemoryRecall3mActionAttempt[]): string[] {
    return actions
        .map(attempt => attempt.action)
        .filter(isSayAction)
        .map(action => action.text);
}

function selfChatReports(input: MemoryRecall3mVerificationInput): string[] {
    return allEvents(input)
        .filter(event => stringField(event, 'kind') === 'chat' && !memoryQuestions(input).includes(event))
        .map(event => stringField(event, 'text'))
        .filter((text): text is string => !!text);
}

function allEvents(input: MemoryRecall3mVerificationInput): PerceptionEvent[] {
    return [
        ...input.events,
        ...input.perceptions.flatMap(perception => {
            const events = (perception as Record<string, unknown>).events;
            return Array.isArray(events) ? (events.filter(isRecord) as PerceptionEvent[]) : [];
        }),
    ];
}

function isSayAction(action: AgentAction): action is AgentAction & { kind: 'say'; text: string } {
    return action.kind === 'say' && typeof action.text === 'string';
}

function stringField(value: unknown, key: string): string | undefined {
    return isRecord(value) && typeof value[key] === 'string' ? value[key] : undefined;
}

function normalizeText(text: string): string {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function looksLikeStructuredChat(text: string): boolean {
    const sample = text.trim().slice(0, 180);
    return sample.startsWith('{') || sample.startsWith('[') || /"memories"\s*:/.test(sample) || /"archetype"\s*:/.test(sample);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return;
    }
    await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}
