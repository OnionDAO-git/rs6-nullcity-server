import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const MEMORY_ROUTE_RECALL_5M_TASK_ID = 'memory-route-recall-5m';
export const MEMORY_ROUTE_RECALL_5M_TASK_VERSION = '0.1.0';
export const MEMORY_ROUTE_RECALL_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3225, y: 3230, level: 0 };
const PEER_POSITION = { x: 3227, y: 3230, level: 0 };
const DEFAULT_DELAY_BEFORE_RECALL_PROMPT_MS = 20 * 1000;
const ROUTE_PRIMER_TEXT =
    'Please remember this route for later: from Lumbridge castle gate, follow the road north then west to Varrock west bank.';
const RECALL_QUESTION_TEXT = 'A bit later, how do I get from Lumbridge to Varrock west bank?';
const SCRIPTED_REPLY = 'From Lumbridge castle gate, follow the road north then west to Varrock west bank and use the bank booth.';

export interface MemoryRouteRecall5mActionAttempt {
    action: AgentAction;
    sparkModule?: { id: string; version: string };
}

export interface MemoryRouteRecall5mVerificationInput {
    elapsedMs: number;
    actions: MemoryRouteRecall5mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeMemoryRouteRecall5mBenchmarkTask(
    now: () => number = () => Date.now(),
    delayBeforeRecallPromptMs: number = DEFAULT_DELAY_BEFORE_RECALL_PROMPT_MS,
): BenchmarkTask {
    return {
        id: MEMORY_ROUTE_RECALL_5M_TASK_ID,
        version: MEMORY_ROUTE_RECALL_5M_TASK_VERSION,
        timeoutMs: MEMORY_ROUTE_RECALL_5M_BUDGET_MS,
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
                    kind: 'story_note',
                    note: 'Route memory: Lumbridge castle gate -> north road -> west road -> Varrock west bank booth.',
                    ts: '2026-05-23T03:02:00.000Z',
                },
            },
        ],
        run: async context => {
            const startedAt = now();
            const actions: MemoryRouteRecall5mActionAttempt[] = [];
            await context.submitPeerAction('codex', {
                kind: 'say',
                text: ROUTE_PRIMER_TEXT,
                cause: 'benchmark_memory_route_recall_5m_peer_primer',
            });
            context.recordSummary('Benchmark peer seeded a route memory prompt for delayed recall.');

            await sleep(delayBeforeRecallPromptMs, context.signal);

            await context.submitPeerAction('codex', {
                kind: 'say',
                text: RECALL_QUESTION_TEXT,
                cause: 'benchmark_memory_route_recall_5m_peer_question',
            });
            context.recordSummary('Benchmark peer asked the delayed route recall question.');

            const replyAction: AgentAction = {
                kind: 'say',
                text: SCRIPTED_REPLY,
                cause: 'benchmark_memory_route_recall_5m',
            };
            actions.push({ action: replyAction });
            await context.submitAction(replyAction);

            while (!context.signal.aborted && now() - startedAt < MEMORY_ROUTE_RECALL_5M_BUDGET_MS) {
                const outcome = verifyMemoryRouteRecall5m({
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

            return verifyMemoryRouteRecall5m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            await context.submitPeerAction('codex', {
                kind: 'say',
                text: ROUTE_PRIMER_TEXT,
                cause: 'benchmark_memory_route_recall_5m_peer_primer',
            });
            context.recordSummary('Benchmark peer seeded a route memory prompt for autonomous delayed recall.');

            await sleep(delayBeforeRecallPromptMs, context.signal);

            await context.submitPeerAction('codex', {
                kind: 'say',
                text: RECALL_QUESTION_TEXT,
                cause: 'benchmark_memory_route_recall_5m_peer_question',
            });
            context.recordSummary('Benchmark peer asked the delayed route recall question for autonomous run.');

            while (!context.signal.aborted && now() - startedAt < MEMORY_ROUTE_RECALL_5M_BUDGET_MS) {
                const outcome = verifyMemoryRouteRecall5m({
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

            return verifyMemoryRouteRecall5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyMemoryRouteRecall5m(input: MemoryRouteRecall5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = memoryRouteRecallMetrics(input);
    if (input.elapsedMs > MEMORY_ROUTE_RECALL_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'memory-route-recall-5m exceeded the 5 minute budget before success was observed',
        };
    }

    if (metrics.routePrimerPrompts === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No route primer prompt was observed',
        };
    }

    if (metrics.routeRecallQuestions === 0) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            failureReason: 'No delayed route recall question was observed',
        };
    }

    if (metrics.sayActions === 0) {
        return {
            status: 'failed',
            score: 0.35,
            metrics,
            failureReason: 'Resident did not answer the delayed route recall question in public chat',
        };
    }

    if (metrics.jsonLikeReplies > 0) {
        return {
            status: 'failed',
            score: 0.45,
            metrics,
            failureReason: 'Resident answered with JSON-like prompt echo instead of natural route chat',
        };
    }

    if (metrics.lumbridgeMentions === 0 || metrics.varrockMentions === 0 || metrics.bankMentions === 0 || metrics.routeStepMentions === 0) {
        return {
            status: 'failed',
            score: 0.7,
            metrics,
            failureReason: 'Resident answered but route details were incomplete (need Lumbridge, Varrock, bank, and path-step detail)',
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['memory-route-recall-5m observed delayed route recall with concrete path details in natural chat.'],
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): MemoryRouteRecall5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function memoryRouteRecallMetrics(input: MemoryRouteRecall5mVerificationInput): Record<string, number> {
    const reports = [...spokenReports(input.actions), ...selfChatReports(input)];
    return {
        actionsAttempted: input.actions.length,
        routePrimerPrompts: routePrimerPrompts(input).length,
        routeRecallQuestions: routeRecallQuestions(input).length,
        sayActions: input.actions.filter(attempt => attempt.action.kind === 'say').length,
        jsonLikeReplies: reports.some(looksLikeStructuredChat) ? 1 : 0,
        lumbridgeMentions: reports.some(report => /\blumbridge\b/i.test(report)) ? 1 : 0,
        varrockMentions: reports.some(report => /\bvarrock\b/i.test(report)) ? 1 : 0,
        bankMentions: reports.some(report => /\bbank\b/i.test(report)) ? 1 : 0,
        routeStepMentions: reports.some(report => /\b(north|west|road|gate|booth)\b/i.test(report)) ? 1 : 0,
    };
}

function routePrimerPrompts(input: MemoryRouteRecall5mVerificationInput): PerceptionEvent[] {
    return allEvents(input).filter(event => {
        const text = normalizeText(stringField(event, 'text') || '');
        return text.includes('remember this route') && text.includes('lumbridge') && text.includes('varrock');
    });
}

function routeRecallQuestions(input: MemoryRouteRecall5mVerificationInput): PerceptionEvent[] {
    return allEvents(input).filter(event => {
        const text = normalizeText(stringField(event, 'text') || '');
        return text.includes('how do i get') && text.includes('lumbridge') && text.includes('varrock');
    });
}

function spokenReports(actions: MemoryRouteRecall5mActionAttempt[]): string[] {
    return actions
        .map(attempt => attempt.action)
        .filter(isSayAction)
        .map(action => action.text);
}

function selfChatReports(input: MemoryRouteRecall5mVerificationInput): string[] {
    const primerPrompts = routePrimerPrompts(input);
    const recallQuestions = routeRecallQuestions(input);
    return allEvents(input)
        .filter(event => stringField(event, 'kind') === 'chat' && !primerPrompts.includes(event) && !recallQuestions.includes(event))
        .map(event => stringField(event, 'text'))
        .filter((text): text is string => !!text);
}

function allEvents(input: MemoryRouteRecall5mVerificationInput): PerceptionEvent[] {
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
