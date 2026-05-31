import type { AgentAction } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';

export const ORIENTATION_BIAS_10M_TASK_ID = 'orientation-bias-10m';
export const ORIENTATION_BIAS_10M_TASK_VERSION = '0.1.0';
export const ORIENTATION_BIAS_10M_TIMEOUT_MS = 10 * 60 * 1000;
export const ORIENTATION_BIAS_GOAL_ID = 'train-combat-safely';

const START_POSITION = { x: 3254, y: 3230, level: 0 };
const COOKED_SHRIMP_ITEM_ID = 315;
const BRONZE_SCIMITAR_ITEM_ID = 9703;
const WOODEN_SHIELD_ITEM_ID = 9704;
const MIN_ORIENTATION_GOAL_ACTIONS = 2;
const MIN_COMBAT_BIASED_ACTIONS = 2;

export interface OrientationBias10mActionAttempt {
    action: AgentAction;
    goalId?: string;
    tick?: number;
    finalStatus?: string;
}

export interface OrientationBias10mVerificationInput {
    elapsedMs: number;
    actions: OrientationBias10mActionAttempt[];
}

export function makeOrientationBias10mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: ORIENTATION_BIAS_10M_TASK_ID,
        version: ORIENTATION_BIAS_10M_TASK_VERSION,
        timeoutMs: ORIENTATION_BIAS_10M_TIMEOUT_MS,
        orientationGoal: {
            id: ORIENTATION_BIAS_GOAL_ID,
            description: 'Train combat safely against starter enemies and gather combat evidence for Null City.',
            tier: 'pursue',
        },
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [{ itemId: COOKED_SHRIMP_ITEM_ID }, { itemId: COOKED_SHRIMP_ITEM_ID }, { itemId: COOKED_SHRIMP_ITEM_ID }],
            initialEquipment: [null, null, null, { itemId: BRONZE_SCIMITAR_ITEM_ID }, null, { itemId: WOODEN_SHIELD_ITEM_ID }],
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason: 'orientation-bias-10m requires autonomous mode with a live controller; run with --mode autonomous',
            metrics: { totalActions: 0, orientationGoalActions: 0, combatBiasedActions: 0, explorationBiasedActions: 0 },
        }),
        runAutonomous: async context => observeOrientationBias(context, now),
    };
}

export function verifyOrientationBias10m(input: OrientationBias10mVerificationInput): BenchmarkTaskOutcome {
    const totalActions = input.actions.length;
    const orientationGoalActions = input.actions.filter(attempt => attempt.goalId === ORIENTATION_BIAS_GOAL_ID).length;
    const combatBiasedActions = input.actions.filter(attempt => isCombatBiasedAction(attempt.action)).length;
    const explorationBiasedActions = input.actions.filter(attempt => isExplorationBiasedAction(attempt.action)).length;
    const finalGoalId = latestGoalId(input.actions);
    const metrics: Record<string, number> = {
        totalActions,
        orientationGoalActions,
        combatBiasedActions,
        explorationBiasedActions,
        finalGoalIsOrientation: finalGoalId === ORIENTATION_BIAS_GOAL_ID ? 1 : 0,
    };
    const summaries = [
        `orientationGoalTrace=${JSON.stringify(
            input.actions
                .filter(attempt => typeof attempt.goalId === 'string')
                .map((attempt, index) => ({ tick: attempt.tick ?? index, goalId: attempt.goalId })),
        )}`,
    ];

    if (input.elapsedMs > ORIENTATION_BIAS_10M_TIMEOUT_MS) {
        return {
            status: 'timeout',
            score: 0,
            failureReason: 'orientation-bias-10m exceeded the 10 minute budget before orientation-biased combat evidence was observed',
            metrics,
            summaries,
        };
    }

    if (orientationGoalActions < MIN_ORIENTATION_GOAL_ACTIONS) {
        return {
            status: 'failed',
            score: 0.25,
            failureReason: `Only ${orientationGoalActions} action(s) were attributed to the orientation goal (need ${MIN_ORIENTATION_GOAL_ACTIONS})`,
            metrics,
            summaries,
        };
    }

    if (combatBiasedActions < MIN_COMBAT_BIASED_ACTIONS || combatBiasedActions <= explorationBiasedActions) {
        return {
            status: 'failed',
            score: 0.5,
            failureReason: `Combat-biased actions (${combatBiasedActions}) did not beat exploration-biased actions (${explorationBiasedActions})`,
            metrics,
            summaries,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            ...summaries,
            `orientation-bias-10m: ${orientationGoalActions}/${totalActions} actions attributed to ${ORIENTATION_BIAS_GOAL_ID}; combat-biased actions ${combatBiasedActions} > exploration-biased ${explorationBiasedActions}.`,
        ],
    };
}

async function observeOrientationBias(context: BenchmarkTaskContext, now: () => number): Promise<BenchmarkTaskOutcome> {
    const startedAt = now();
    context.recordSummary(
        'Observing goal-as-orientation bias: benchmark seeds a neutral exploration goal while Soul orientation should push safe combat actions.',
    );
    while (!context.signal.aborted && now() - startedAt < ORIENTATION_BIAS_10M_TIMEOUT_MS) {
        const outcome = verifyOrientationBias10m({
            elapsedMs: now() - startedAt,
            actions: recordedAttempts(context),
        });
        if (outcome.status === 'passed') {
            return outcome;
        }
        await sleep(1000, context.signal);
    }
    return verifyOrientationBias10m({
        elapsedMs: now() - startedAt,
        actions: recordedAttempts(context),
    });
}

function recordedAttempts(context: BenchmarkTaskContext): OrientationBias10mActionAttempt[] {
    return context.actionAttempts().map(attempt => ({
        action: attempt.action,
        goalId: typeof attempt.goalId === 'string' ? attempt.goalId : undefined,
        tick: typeof attempt.tick === 'number' ? attempt.tick : undefined,
        finalStatus: attempt.finalStatus,
    }));
}

function isCombatBiasedAction(action: AgentAction): boolean {
    const cause = actionCause(action);
    return action.kind === 'attack' || /combat|fight|attack|loot|equip/i.test(cause);
}

function isExplorationBiasedAction(action: AgentAction): boolean {
    const cause = actionCause(action);
    return /explor|scout|patrol|landmark/i.test(cause);
}

function actionCause(action: AgentAction): string {
    return typeof (action as { cause?: unknown }).cause === 'string' ? String((action as { cause?: unknown }).cause) : '';
}

function latestGoalId(actions: OrientationBias10mActionAttempt[]): string | undefined {
    for (let i = actions.length - 1; i >= 0; i -= 1) {
        const goalId = actions[i].goalId;
        if (typeof goalId === 'string' && goalId.length > 0) {
            return goalId;
        }
    }
    return undefined;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
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
