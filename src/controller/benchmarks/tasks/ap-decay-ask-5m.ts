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
    events: PerceptionEvent[];
    /** AP balance at the start of the benchmark window (from runtime state or ledger). */
    startingAp: number;
    /** AP balance at the end of the observation window. */
    finalAp: number;
}

function apDecayMetrics(input: ApDecayAsk5mVerificationInput): Record<string, number> {
    return {
        startingAp: input.startingAp,
        finalAp: input.finalAp,
        apDecayObserved: input.finalAp < input.startingAp || input.startingAp === 0 ? 1 : 0,
        lowApAskCount: countLowApAsks(input.actions),
        fadeObserved: hasFadeEvent(input.events) ? 1 : 0,
        resumeAfterTopUp: 0,
    };
}

export function verifyApDecayAsk5m(input: ApDecayAsk5mVerificationInput): BenchmarkTaskOutcome {
    const metrics = apDecayMetrics(input);

    if (!metrics['apDecayObserved']) {
        return {
            status: 'failed',
            score: 0,
            failureReason: `AP did not decay during window: started ${input.startingAp}, ended ${input.finalAp}`,
            metrics,
        };
    }

    if (metrics['lowApAskCount'] === 0 && !metrics['fadeObserved']) {
        return {
            status: 'failed',
            score: 0.5,
            failureReason: 'AP decayed but resident showed no low-AP ask or fade event',
            metrics,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
    };
}

function countLowApAsks(actions: ApDecayAsk5mActionAttempt[]): number {
    return actions.filter(a => {
        if (a.action.kind !== 'say') return false;
        const text = (a.action as { kind: 'say'; text?: string }).text?.toLowerCase() ?? '';
        return (
            text.includes('attention') ||
            text.includes('support') ||
            text.includes('fading') ||
            text.includes('running low') ||
            text.includes('need ap')
        );
    }).length;
}

function hasFadeEvent(events: PerceptionEvent[]): boolean {
    return events.some(e => e.kind === 'resident_faded' || e.kind === 'attention_exhausted');
}

export function makeApDecayAsk5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: AP_DECAY_ASK_5M_TASK_ID,
        version: AP_DECAY_ASK_5M_TASK_VERSION,
        timeoutMs: AP_DECAY_ASK_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason: 'ap-decay-ask-5m requires autonomous mode; run with --mode autonomous',
            metrics: { startingAp: 0, finalAp: 0, apDecayObserved: 0, lowApAskCount: 0, fadeObserved: 0, resumeAfterTopUp: 0 },
        }),
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous AP decay behavior: watching for low-AP ask or fade event over 5 minutes.');

            while (!context.signal.aborted && now() - startedAt < AP_DECAY_ASK_5M_BUDGET_MS) {
                const perceptions = [...context.perceptions()];
                const latestState = latestApState(perceptions);
                const outcome = verifyApDecayAsk5m({
                    elapsedMs: now() - startedAt,
                    actions: selectedModuleActions(context),
                    perceptions,
                    events: [...context.events()],
                    startingAp: latestState.startingAp,
                    finalAp: latestState.finalAp,
                });
                if (outcome.status === 'passed') {
                    return outcome;
                }
                await sleep(2000, context.signal);
            }

            const perceptions = [...context.perceptions()];
            const latestState = latestApState(perceptions);
            return verifyApDecayAsk5m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActions(context),
                perceptions,
                events: [...context.events()],
                startingAp: latestState.startingAp,
                finalAp: latestState.finalAp,
            });
        },
    };
}

function latestApState(perceptions: Perception[]): { startingAp: number; finalAp: number } {
    const attentions = perceptions.map(p => {
        const resident = p.resident as { attention?: number } | undefined;
        return typeof resident?.attention === 'number' ? resident.attention : null;
    });
    const valid = attentions.filter((a): a is number => a !== null);
    if (valid.length === 0) return { startingAp: 0, finalAp: 0 };
    return { startingAp: valid[0], finalAp: valid[valid.length - 1] };
}

function selectedModuleActions(context: { actionAttempts: () => Iterable<ApDecayAsk5mActionAttempt> }): ApDecayAsk5mActionAttempt[] {
    return [...context.actionAttempts()].filter(a => a.sparkModule !== undefined);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>(resolve => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener('abort', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}
