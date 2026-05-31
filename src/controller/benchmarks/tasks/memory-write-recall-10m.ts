import fs from 'fs';
import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';

export const MEMORY_WRITE_RECALL_10M_TASK_ID = 'memory-write-recall-10m';
export const MEMORY_WRITE_RECALL_10M_TASK_VERSION = '0.1.0';
export const MEMORY_WRITE_RECALL_10M_BUDGET_MS = 10 * 60 * 1000;

const START_POSITION = { x: 3225, y: 3230, level: 0 };
const PEER_POSITION = { x: 3227, y: 3230, level: 0 };
const DEFAULT_DELAY_BEFORE_RECALL_PROMPT_MS = 20 * 1000;
const FACT_PROMPT_TEXT = 'agent, durable fact: west gate passphrase is ember-vellum. Use rememberFact topic routes.';
const RECALL_QUESTION_TEXT = 'agent, what do you remember about the west gate passphrase?';
const FACT_TERMS = [/west gate/i, /passphrase/i, /ember-vellum/i];

export interface MemoryWriteRecall10mActionAttempt {
    action: AgentAction;
    sparkModule?: { id: string; version: string };
}

export interface MemoryWriteRecall10mVerificationInput {
    elapsedMs: number;
    actions: MemoryWriteRecall10mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
    facts?: string[];
}

export function makeMemoryWriteRecall10mBenchmarkTask(
    now: () => number = () => Date.now(),
    delayBeforeRecallPromptMs: number = DEFAULT_DELAY_BEFORE_RECALL_PROMPT_MS,
): BenchmarkTask {
    return {
        id: MEMORY_WRITE_RECALL_10M_TASK_ID,
        version: MEMORY_WRITE_RECALL_10M_TASK_VERSION,
        timeoutMs: MEMORY_WRITE_RECALL_10M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        peers: [
            {
                id: 'codex',
                spawnPosition: PEER_POSITION,
            },
        ],
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            metrics: { factPrompts: 0, recallQuestions: 0, qmdFactWrites: 0, sayActions: 0, passphraseMentions: 0 },
            failureReason: 'memory-write-recall-10m requires autonomous mode so Brain can choose rememberFact before delayed recall',
        }),
        runAutonomous: async context => {
            const startedAt = now();
            await context.submitPeerAction('codex', {
                kind: 'say',
                text: FACT_PROMPT_TEXT,
                cause: 'benchmark_memory_write_recall_10m_peer_fact',
            });
            context.recordSummary('Benchmark peer taught a new durable fact and asked the resident to store it with rememberFact.');

            await sleep(delayBeforeRecallPromptMs, context.signal);

            await context.submitPeerAction('codex', {
                kind: 'say',
                text: RECALL_QUESTION_TEXT,
                cause: 'benchmark_memory_write_recall_10m_peer_question',
            });
            const recallActionOffset = selectedModuleActionAttempts(context).length;
            context.recordSummary('Benchmark peer asked delayed recall question without repeating the answer token.');

            while (!context.signal.aborted && now() - startedAt < MEMORY_WRITE_RECALL_10M_BUDGET_MS) {
                const outcome = verifyMemoryWriteRecall10m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActionAttempts(context).slice(recallActionOffset),
                    perceptions: [...context.perceptions()],
                    events: [...context.events()],
                    facts: readFactArtifactTexts(context),
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(500, context.signal);
            }

            return verifyMemoryWriteRecall10m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context).slice(recallActionOffset),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
                facts: readFactArtifactTexts(context),
            });
        },
    };
}

export function verifyMemoryWriteRecall10m(input: MemoryWriteRecall10mVerificationInput): BenchmarkTaskOutcome {
    const metrics = memoryWriteRecallMetrics(input);
    if (input.elapsedMs > MEMORY_WRITE_RECALL_10M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'memory-write-recall-10m exceeded the 10 minute budget before durable write + delayed recall were observed',
        };
    }

    if (metrics.factPrompts === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: 'No durable fact prompt was observed',
        };
    }

    if (metrics.recallQuestions === 0) {
        return {
            status: 'failed',
            score: 0.2,
            metrics,
            failureReason: 'No delayed recall question was observed',
        };
    }

    if (metrics.qmdFactWrites === 0) {
        return {
            status: 'failed',
            score: 0.35,
            metrics,
            failureReason: 'No qmd durable fact write containing the taught fact was observed',
        };
    }

    if (metrics.sayActions === 0) {
        return {
            status: 'failed',
            score: 0.5,
            metrics,
            failureReason: 'Resident did not answer after the recall question',
        };
    }

    if (metrics.jsonLikeReplies > 0) {
        return {
            status: 'failed',
            score: 0.55,
            metrics,
            failureReason: 'Resident answered with JSON-like prompt echo instead of natural memory recall',
        };
    }

    if (metrics.passphraseMentions === 0 || metrics.westGateMentions === 0) {
        return {
            status: 'failed',
            score: 0.75,
            metrics,
            failureReason: 'Resident answered after recall question, but omitted the west gate passphrase fact',
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['memory-write-recall-10m observed qmd durable fact write plus delayed natural recall.'],
    };
}

function selectedModuleActionAttempts(context: BenchmarkTaskContext): MemoryWriteRecall10mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function readFactArtifactTexts(context: BenchmarkTaskContext): string[] {
    return (context.artifactPaths?.() || [])
        .filter(artifactPath => /[/\\]facts[/\\]routes\.md$/i.test(artifactPath))
        .flatMap(artifactPath => {
            try {
                return [fs.readFileSync(artifactPath, 'utf8')];
            } catch {
                return [];
            }
        });
}

function memoryWriteRecallMetrics(input: MemoryWriteRecall10mVerificationInput): Record<string, number> {
    const reports = memoryWriteRecallReports(input);
    return {
        actionsAttempted: input.actions.length,
        factPrompts: factPrompts(input).length,
        recallQuestions: recallQuestions(input).length,
        qmdFactWrites: (input.facts || []).some(containsDurableFact) ? 1 : 0,
        sayActions: reports.length,
        jsonLikeReplies: reports.some(looksLikeStructuredChat) ? 1 : 0,
        passphraseMentions: reports.some(report => /ember-vellum/i.test(report)) ? 1 : 0,
        westGateMentions: reports.some(report => /west gate|passphrase/i.test(report)) ? 1 : 0,
    };
}

function factPrompts(input: MemoryWriteRecall10mVerificationInput): PerceptionEvent[] {
    return scoringEvents(input).filter(event => {
        const text = normalizeText(stringField(event, 'text') || '');
        return text.includes('durable fact') && text.includes('west gate passphrase') && text.includes('ember-vellum');
    });
}

function recallQuestions(input: MemoryWriteRecall10mVerificationInput): PerceptionEvent[] {
    return scoringEvents(input).filter(event => {
        const text = normalizeText(stringField(event, 'text') || '');
        return text.includes('what do you remember') && text.includes('west gate passphrase');
    });
}

function memoryWriteRecallReports(input: MemoryWriteRecall10mVerificationInput): string[] {
    const eventReports = selfChatReports(input);
    if (eventReports.length > 0) {
        return eventReports;
    }
    return spokenReports(input.actions);
}

function selfChatReports(input: MemoryWriteRecall10mVerificationInput): string[] {
    const events = scoringEvents(input);
    const lastRecallQuestionIndex = latestRecallQuestionIndex(events);
    if (lastRecallQuestionIndex === undefined) {
        return [];
    }

    const primerPrompts = factPrompts(input);
    const questionEvents = recallQuestions(input);
    return events
        .slice(lastRecallQuestionIndex + 1)
        .filter(event => stringField(event, 'kind') === 'chat' && !primerPrompts.includes(event) && !questionEvents.includes(event))
        .map(event => stringField(event, 'text'))
        .filter((text): text is string => !!text);
}

function latestRecallQuestionIndex(events: PerceptionEvent[]): number | undefined {
    for (let index = events.length - 1; index >= 0; index -= 1) {
        const text = normalizeText(stringField(events[index], 'text') || '');
        if (text.includes('what do you remember') && text.includes('west gate passphrase')) {
            return index;
        }
    }
    return undefined;
}

function spokenReports(actions: MemoryWriteRecall10mActionAttempt[]): string[] {
    return actions
        .map(attempt => attempt.action)
        .filter(isSayAction)
        .map(action => action.text);
}

function scoringEvents(input: MemoryWriteRecall10mVerificationInput): PerceptionEvent[] {
    if (input.events.length > 0) {
        return input.events;
    }
    return [
        ...input.perceptions.flatMap(perception => {
            const events = (perception as Record<string, unknown>).events;
            return Array.isArray(events) ? (events.filter(isRecord) as PerceptionEvent[]) : [];
        }),
    ];
}

function containsDurableFact(text: string): boolean {
    return FACT_TERMS.every(term => term.test(text));
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
    return sample.startsWith('{') || sample.startsWith('[') || /"rememberFact"\s*:/.test(sample) || /"memories"\s*:/.test(sample);
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
