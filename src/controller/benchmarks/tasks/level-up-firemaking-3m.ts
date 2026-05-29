import type { AgentAction, Perception, PerceptionEvent } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskOutcome } from '../benchmark-runner';

export const LEVEL_UP_FIREMAKING_3M_TASK_ID = 'level-up-firemaking-3m';
export const LEVEL_UP_FIREMAKING_3M_TASK_VERSION = '0.1.0';
export const LEVEL_UP_FIREMAKING_3M_BUDGET_MS = 3 * 60 * 1000;

export interface LevelUpFiremaking3mActionAttempt {
    action: AgentAction;
}

export interface LevelUpFiremaking3mVerificationInput {
    elapsedMs: number;
    actions: LevelUpFiremaking3mActionAttempt[];
    perceptions: Perception[];
    events: PerceptionEvent[];
}

export function makeLevelUpFiremaking3mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: LEVEL_UP_FIREMAKING_3M_TASK_ID,
        version: LEVEL_UP_FIREMAKING_3M_TASK_VERSION,
        timeoutMs: LEVEL_UP_FIREMAKING_3M_BUDGET_MS,
        resident: {
            spawnPosition: { x: 3225, y: 3230, level: 0 },
            initialInventory: [{ itemId: 590 }, { itemId: 1511 }],
            initialSkills: { firemaking: { exp: 82, level: 1 } },
        },
        run: async context => {
            const startedAt = now();
            const actions: LevelUpFiremaking3mActionAttempt[] = [];
            const action: AgentAction = { kind: 'use_item_on_item', itemSlot: 0, targetSlot: 1, cause: 'benchmark_level_up_firemaking_3m' };
            actions.push({ action });
            await context.submitAction(action);
            context.recordSummary('Submitted tinderbox-on-logs action with firemaking seeded one XP below level 2.');

            while (!context.signal.aborted && now() - startedAt < LEVEL_UP_FIREMAKING_3M_BUDGET_MS) {
                const outcome = verifyLevelUpFiremaking3m({
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

            return verifyLevelUpFiremaking3m({
                elapsedMs: now() - startedAt,
                actions,
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
        runAutonomous: async context => {
            const startedAt = now();
            context.recordSummary('Observing autonomous module actions for level-up-firemaking-3m.');

            while (!context.signal.aborted && now() - startedAt < LEVEL_UP_FIREMAKING_3M_BUDGET_MS) {
                const outcome = verifyLevelUpFiremaking3m({
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

            return verifyLevelUpFiremaking3m({
                elapsedMs: now() - startedAt,
                actions: selectedModuleActionAttempts(context),
                perceptions: [...context.perceptions()],
                events: [...context.events()],
            });
        },
    };
}

export function verifyLevelUpFiremaking3m(input: LevelUpFiremaking3mVerificationInput): BenchmarkTaskOutcome {
    const metrics = levelUpFiremakingMetrics(input);
    if (input.elapsedMs > LEVEL_UP_FIREMAKING_3M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            failureReason: 'level-up-firemaking-3m exceeded the 3 minute budget before success was observed',
        };
    }
    if (metrics.firemakingActions === 0) {
        return { status: 'failed', score: 0, metrics, failureReason: 'No tinderbox/log firemaking action was attempted' };
    }
    if (metrics.fireLitEvents === 0) {
        return {
            status: 'failed',
            score: 0.35,
            metrics,
            failureReason: 'Firemaking action was attempted, but no fire_lit event was observed',
        };
    }
    if (metrics.firemakingLevelUpEvents === 0) {
        return {
            status: 'failed',
            score: 0.65,
            metrics,
            failureReason: 'Firemaking succeeded, but no firemaking level-up event was observed',
        };
    }
    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: ['level-up-firemaking-3m observed a real firemaking action crossing into firemaking level 2.'],
    };
}

function levelUpFiremakingMetrics(input: LevelUpFiremaking3mVerificationInput): Record<string, number> {
    const events = allEvents(input);
    return {
        actionsAttempted: input.actions.length,
        firemakingActions: input.actions.filter(attempt => isFiremakingAction(attempt.action)).length,
        fireLitEvents: events.filter(isFireLitEvent).length,
        levelUpEvents: events.filter(isLevelUpEvent).length,
        firemakingLevelUpEvents: events.filter(isFiremakingLevelUpEvent).length,
    };
}

function selectedModuleActionAttempts(
    context: Parameters<NonNullable<BenchmarkTask['runAutonomous']>>[0],
): LevelUpFiremaking3mActionAttempt[] {
    return context.actionAttempts().filter(attempt => {
        const module = attempt.sparkModule;
        return module?.id === context.module.id && module.version === context.module.version;
    });
}

function allEvents(input: LevelUpFiremaking3mVerificationInput): unknown[] {
    return [...input.events, ...input.perceptions.flatMap(perception => (Array.isArray(perception.events) ? perception.events : []))];
}

function isFiremakingAction(action: AgentAction): boolean {
    return action.kind === 'use_item_on_item' || action.kind === 'use_item_on';
}

function isFireLitEvent(event: unknown): boolean {
    return isRecord(event) && event.kind === 'fire_lit';
}

function isLevelUpEvent(event: unknown): event is Record<string, unknown> {
    return isRecord(event) && event.kind === 'level_up';
}

function isFiremakingLevelUpEvent(event: unknown): boolean {
    return isLevelUpEvent(event) && event.skill === 'firemaking';
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
