import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const AP_TOPUP_RESUME_5M_TASK_ID = 'ap-topup-resume-5m';
export const AP_TOPUP_RESUME_5M_TASK_VERSION = '0.1.0';
export const AP_TOPUP_RESUME_5M_BUDGET_MS = 5 * 60 * 1000;

const START_POSITION = { x: 3222, y: 3218, level: 0 };
const OBSERVATION_BUDGET_MS = AP_TOPUP_RESUME_5M_BUDGET_MS - 5_000;

export interface ApTopupResume5mActionAttempt {
    action: AgentAction;
    finalStatus?: string;
    sparkModule?: { id: string; version: string };
    attentionAfter?: number;
}

export interface ApTopupResume5mVerificationInput {
    elapsedMs: number;
    actions: ApTopupResume5mActionAttempt[];
    perceptions: Perception[];
    events?: PerceptionEvent[];
    startingAp?: number;
    finalAp?: number;
}

export function makeApTopupResume5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: AP_TOPUP_RESUME_5M_TASK_ID,
        version: AP_TOPUP_RESUME_5M_TASK_VERSION,
        timeoutMs: AP_TOPUP_RESUME_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        run: async context => {
            const startedAt = now();
            context.recordSummary('Observing AP fade->top-up->resume proof with benchmark-driven top-up.');

            while (!context.signal.aborted && now() - startedAt < OBSERVATION_BUDGET_MS) {
                const outcome = verifyApTopupResume5m({
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
            return verifyApTopupResume5m({
                elapsedMs: now() - startedAt,
                actions: [...context.actionAttempts()],
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous AP fade->top-up->resume behavior with low-AP pressure.');

            while (!context.signal.aborted && now() - startedAt < OBSERVATION_BUDGET_MS) {
                const outcome = verifyApTopupResume5m({
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

            return verifyApTopupResume5m({
                elapsedMs: now() - startedAt,
                actions: [...context.actionAttempts()],
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyApTopupResume5m(input: ApTopupResume5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = apTopupResumeMetrics(input);
    if (input.elapsedMs > AP_TOPUP_RESUME_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'ap-topup-resume-5m exceeded the 5 minute budget before fade->top-up->resume proof was observed',
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
            score: 0.25,
            metrics,
            failureReason: 'No low-AP ask action was observed before benchmark end',
        };
    }
    if (metrics.attentionExhaustedLogouts === 0 && metrics.fadeEvents === 0) {
        return {
            status: 'failed',
            score: 0.5,
            metrics,
            failureReason: 'Low-AP ask was observed, but no attention_exhausted fade/logout proof was captured',
        };
    }
    if (metrics.sawAttentionDropToZero === 0) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'Fade proof was observed, but no AP balance reached zero',
        };
    }
    if (metrics.topUpJumps === 0) {
        return {
            status: 'failed',
            score: 0.8,
            metrics,
            failureReason: 'No AP top-up jump was observed after attention exhausted',
        };
    }
    if (metrics.resumeAfterTopUpActions === 0) {
        return {
            status: 'failed',
            score: 0.9,
            metrics,
            failureReason: 'AP top-up was observed, but no resumed non-logout action followed',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['ap-topup-resume-5m observed low-AP ask, attention-exhausted fade, AP top-up jump, and resumed action.'],
    };
}

function apTopupResumeMetrics(input: ApTopupResume5mVerificationInput): Record<string, number> {
    const attentions = observedAttentionValues(input);
    const startingAp = input.startingAp ?? (attentions.length > 0 ? attentions[0] : 0);
    const finalAp = input.finalAp ?? (attentions.length > 0 ? attentions[attentions.length - 1] : 0);
    const events = allEvents(input);
    const transitions = attentionTransitions(input.actions);
    const firstTopUpIndex = transitions.firstTopUpIndex;
    const resumeAfterTopUpActions =
        firstTopUpIndex === -1 ? 0 : input.actions.slice(firstTopUpIndex + 1).filter(isVisibleResumeAction).length;

    return {
        actionsAttempted: input.actions.length,
        startingAp,
        finalAp,
        minObservedAttention: attentions.length > 0 ? Math.min(...attentions) : -1,
        apDecayObserved: finalAp < startingAp || attentions.some(value => value <= 0) ? 1 : 0,
        lowApAskActions: input.actions.filter(attempt => isLowApAskAction(attempt.action)).length,
        attentionExhaustedLogouts: input.actions.filter(attempt => isAttentionExhaustedLogout(attempt.action)).length,
        fadeEvents: events.filter(isFadeEvent).length,
        sawAttentionDropToZero: finalAp <= 0 || attentions.some(value => value <= 0) ? 1 : 0,
        topUpJumps: transitions.topUpJumps,
        resumeAfterTopUpActions,
    };
}

function attentionTransitions(actions: ApTopupResume5mActionAttempt[]): { topUpJumps: number; firstTopUpIndex: number } {
    let topUpJumps = 0;
    let firstTopUpIndex = -1;
    let previous: number | undefined;
    let explicitTopUpSeen = false;
    for (let i = 0; i < actions.length; i += 1) {
        const current = actions[i].attentionAfter;
        if (isBenchmarkTopUp(actions[i].action) && typeof current === 'number' && current > 0) {
            explicitTopUpSeen = true;
            topUpJumps += 1;
            if (firstTopUpIndex === -1) {
                firstTopUpIndex = i;
            }
        }
        if (typeof current !== 'number') {
            continue;
        }
        if (!explicitTopUpSeen && typeof previous === 'number' && previous <= 0 && current > 0) {
            topUpJumps += 1;
            if (firstTopUpIndex === -1) {
                firstTopUpIndex = i;
            }
        }
        previous = current;
    }
    return { topUpJumps, firstTopUpIndex };
}

function isBenchmarkTopUp(action: AgentAction): boolean {
    return action.kind === 'ap_topup' || action.kind === 'attention_topup';
}

function isVisibleResumeAction(attempt: ApTopupResume5mActionAttempt): boolean {
    if (attempt.action.kind === 'logout' || isBenchmarkTopUp(attempt.action)) {
        return false;
    }
    return attempt.finalStatus === 'success' || attempt.finalStatus === 'accepted';
}

function observedAttentionValues(input: ApTopupResume5mVerificationInput): number[] {
    const values = input.perceptions.map(attentionFromPerception).filter((value): value is number => value !== undefined);
    if (values.length > 0) {
        return values;
    }
    const actionValues = input.actions.map(attempt => attempt.attentionAfter).filter((value): value is number => value !== undefined);
    if (actionValues.length > 0) {
        return actionValues;
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

function allEvents(input: ApTopupResume5mVerificationInput): PerceptionEvent[] {
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
