import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const AP_DECAY_ASK_5M_TASK_ID = 'ap-decay-ask-5m';
export const AP_DECAY_ASK_5M_TASK_VERSION = '0.1.0';
export const AP_DECAY_ASK_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3222, y: 3218, level: 0 };

export interface ApDecayAsk5mActionAttempt {
    action: AgentAction;
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
}

export interface ApDecayAsk5mVerificationInput {
    elapsedMs: number;
    actions: ApDecayAsk5mActionAttempt[];
    perceptions: Perception[];
    events?: PerceptionEvent[];
    /** Optional AP balance at the start of the benchmark window. If omitted, perception history is used. */
    startingAp?: number;
    /** Optional AP balance at the end of the observation window. If omitted, perception history is used. */
    finalAp?: number;
}

export function makeApDecayAsk5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: AP_DECAY_ASK_5M_TASK_ID,
        version: AP_DECAY_ASK_5M_TASK_VERSION,
        timeoutMs: AP_DECAY_ASK_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        run: async context => {
            const startedAt = now();
            context.recordSummary('Observing scripted low-AP ask/fade evidence. Use --mode autonomous for live AP decay.');
            while (!context.signal.aborted && now() - startedAt < AP_DECAY_ASK_5M_BUDGET_MS) {
                const outcome = verifyApDecayAsk5m({
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
            return verifyApDecayAsk5m({
                elapsedMs: now() - startedAt,
                actions: [...context.actionAttempts()],
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous AP life-force behavior: low-AP ask plus attention-exhausted fade evidence.');

            while (!context.signal.aborted && now() - startedAt < AP_DECAY_ASK_5M_BUDGET_MS) {
                const outcome = verifyApDecayAsk5m({
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

            return verifyApDecayAsk5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyApDecayAsk5m(input: ApDecayAsk5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = apDecayAskMetrics(input);
    if (input.elapsedMs > AP_DECAY_ASK_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'ap-decay-ask-5m exceeded the 5 minute budget before low-AP fade evidence was observed',
        };
    }
    if (metrics.apDecayObserved === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            failureReason: `AP did not decay during window: started ${metrics.startingAp}, ended ${metrics.finalAp}`,
        };
    }
    if (metrics.lowApAskActions === 0) {
        return {
            status: 'failed',
            score: 0.35,
            metrics,
            failureReason: 'No low-AP ask action was observed before benchmark end',
        };
    }
    if (metrics.attentionExhaustedLogouts === 0 && metrics.fadeEvents === 0) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'Low-AP ask was observed, but no attention_exhausted fade/logout proof was captured',
        };
    }
    if (metrics.sawAttentionDropToZero === 0) {
        return {
            status: 'failed',
            score: 0.75,
            metrics,
            failureReason: 'Low-AP ask and fade were observed, but no AP balance reached zero',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['ap-decay-ask-5m observed low-AP ask plus attention-exhausted fade evidence.'],
    };
}

function apDecayAskMetrics(input: ApDecayAsk5mVerificationInput): Record<string, number> {
    const attentions = observedAttentionValues(input);
    const startingAp = input.startingAp ?? (attentions.length > 0 ? attentions[0] : 0);
    const finalAp = input.finalAp ?? (attentions.length > 0 ? attentions[attentions.length - 1] : 0);
    const events = allEvents(input);
    return {
        actionsAttempted: input.actions.length,
        startingAp,
        finalAp,
        minObservedAttention: attentions.length > 0 ? Math.min(...attentions) : -1,
        apDecayObserved: finalAp < startingAp || startingAp === 0 || attentions.some(value => value <= 0) ? 1 : 0,
        lowApAskActions: input.actions.filter(attempt => isLowApAskAction(attempt.action)).length,
        attentionExhaustedLogouts: input.actions.filter(attempt => isAttentionExhaustedLogout(attempt.action)).length,
        fadeEvents: events.filter(isFadeEvent).length,
        sawAttentionDropToZero: finalAp <= 0 || attentions.some(value => value <= 0) ? 1 : 0,
        resumeAfterTopUp: 0,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): ApDecayAsk5mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function observedAttentionValues(input: ApDecayAsk5mVerificationInput): number[] {
    const values = input.perceptions.map(attentionFromPerception).filter((value): value is number => value !== undefined);
    if (values.length > 0) {
        return values;
    }
    if (input.startingAp !== undefined || input.finalAp !== undefined) {
        return [input.startingAp ?? 0, input.finalAp ?? input.startingAp ?? 0];
    }
    return [];
}

function attentionFromPerception(perception: Perception): number | undefined {
    const resident = isRecord(perception.resident) ? perception.resident : undefined;
    return resident && typeof resident.attention === 'number' ? resident.attention : undefined;
}

function allEvents(input: ApDecayAsk5mVerificationInput): PerceptionEvent[] {
    return [...(input.events || []), ...input.perceptions.flatMap(perceptionEvents)];
}

function perceptionEvents(perception: Perception): PerceptionEvent[] {
    return Array.isArray(perception.events) ? (perception.events as PerceptionEvent[]) : [];
}

function isLowApAskAction(action: AgentAction): boolean {
    if (action.kind === 'request_attention') {
        return true;
    }
    const cause = stringField(action, 'cause') || '';
    const text = stringField(action, 'text') || '';
    return action.kind === 'say' && /request-attention|attention|support|fading|running low|need ap|shards/i.test(`${cause} ${text}`);
}

function isAttentionExhaustedLogout(action: AgentAction): boolean {
    return action.kind === 'logout' && /attention_exhausted/i.test(stringField(action, 'cause') || '');
}

function isFadeEvent(event: PerceptionEvent): boolean {
    const kind = stringField(event, 'kind') || '';
    const cause = stringField(event, 'cause') || '';
    return /resident_faded|attention_exhausted/i.test(`${kind} ${cause}`);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object';
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
        return;
    }
    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timeout);
            signal.removeEventListener('abort', onAbort);
            reject(new Error('aborted'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
    }).catch(() => undefined);
}
