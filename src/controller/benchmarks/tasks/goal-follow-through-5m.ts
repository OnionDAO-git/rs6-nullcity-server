import type { AgentAction } from '../../transport/message-codecs';
import type { BenchmarkTask, BenchmarkTaskContext, BenchmarkTaskOutcome } from '../benchmark-runner';

/**
 * Goal follow-through benchmark (5-minute window) — S-GOAL-FOLLOW-1 D3.
 *
 * Proves a resident actually *follows the goal it selected* rather than
 * thrashing between goals tick-to-tick. Seeds a benchmark goal (via
 * `benchmarkGoalForTask('goal-follow-through-5m')`, which returns
 * `follow-through-goal`) and healthy AP (the default benchmark attention
 * profile = 5000, keeping the resident out of the survive band so goal
 * selection is driven by pursue/earn, not survival reflexes).
 *
 * Each persisted trajectory action is tagged with the resident's active
 * goal id (`goalId`, S-GOAL-FOLLOW-1 D1). The autonomous runtime forwards
 * that tag onto the recorded action attempt so this verifier can attribute
 * each action to the goal that motivated it.
 *
 * PASS criteria:
 *   - goalAttributedActions / totalActions >= 0.6  (most actions serve a goal)
 *   - goalChangeCount <= 3                          (no thrash)
 *   - the final attributed goal id IS the seeded goal OR a sensible
 *     successor (shares the seed id prefix family, e.g. `<seed>-followup`).
 *
 * Artifact carries `goalAttributedActions`, `totalActions`,
 * `goalChangeCount` (numeric metrics) and `goalTrace` (a JSON
 * `{tick, goalId}[]` array, emitted as a `goalTrace=...` summary line so it
 * survives in the artifact alongside the numeric metrics).
 */

export const GOAL_FOLLOW_THROUGH_5M_TASK_ID = 'goal-follow-through-5m';
export const GOAL_FOLLOW_THROUGH_5M_TASK_VERSION = '0.1.0';
export const GOAL_FOLLOW_THROUGH_5M_BUDGET_MS = 5 * 60 * 1000;

/**
 * The goal id seeded by `benchmarkGoalForTask('goal-follow-through-5m')`.
 * Kept in sync with the `goalFollowThroughGoal` factory in
 * `runescape-brain-planner.ts`.
 */
export const SEED_GOAL_ID = 'follow-through-goal';

const START_POSITION = { x: 3222, y: 3218, level: 0 };
/** Minimum fraction of actions that must be goal-attributed to pass. */
const MIN_ATTRIBUTION_RATIO = 0.6;
/** Maximum number of goal changes tolerated before it counts as thrash. */
const MAX_GOAL_CHANGES = 3;

export interface GoalFollowThrough5mActionAttempt {
    action: AgentAction;
    /** Active goal id at the moment the action was emitted (D1 causation). */
    goalId?: string;
    /** Tick the action was emitted on (for the goalTrace timeline). */
    tick?: number;
    finalStatus?: string;
}

export interface GoalFollowThrough5mVerificationInput {
    elapsedMs: number;
    actions: GoalFollowThrough5mActionAttempt[];
}

interface GoalTraceEntry {
    tick: number;
    goalId: string;
}

/**
 * True when `finalGoalId` is the seed goal or a sensible successor of it.
 * A successor shares the seed id as a prefix (e.g. `follow-through-goal`
 * advancing to `follow-through-goal-followup`). This lets a resident that
 * legitimately *completes* the seeded goal and rolls forward into a
 * descendant still pass, while an unrelated goal (a thrash target) fails.
 */
function isSeedOrSuccessor(finalGoalId: string | undefined): boolean {
    if (!finalGoalId) {
        return false;
    }
    return finalGoalId === SEED_GOAL_ID || finalGoalId.startsWith(`${SEED_GOAL_ID}`);
}

function buildGoalTrace(actions: GoalFollowThrough5mActionAttempt[]): GoalTraceEntry[] {
    const trace: GoalTraceEntry[] = [];
    actions.forEach((attempt, index) => {
        if (typeof attempt.goalId !== 'string' || attempt.goalId.length === 0) {
            return;
        }
        trace.push({ tick: typeof attempt.tick === 'number' ? attempt.tick : index, goalId: attempt.goalId });
    });
    return trace;
}

function goalChangeCount(trace: GoalTraceEntry[]): number {
    let changes = 0;
    for (let i = 1; i < trace.length; i += 1) {
        if (trace[i].goalId !== trace[i - 1].goalId) {
            changes += 1;
        }
    }
    return changes;
}

export function verifyGoalFollowThrough5m(input: GoalFollowThrough5mVerificationInput): BenchmarkTaskOutcome {
    const trace = buildGoalTrace(input.actions);
    const totalActions = input.actions.length;
    const goalAttributedActions = trace.length;
    const changes = goalChangeCount(trace);
    const finalGoalId = trace.at(-1)?.goalId;
    const attributionRatio = totalActions > 0 ? goalAttributedActions / totalActions : 0;

    const metrics: Record<string, number> = {
        totalActions,
        goalAttributedActions,
        goalChangeCount: changes,
        finalGoalIsSeedOrSuccessor: isSeedOrSuccessor(finalGoalId) ? 1 : 0,
    };
    const traceSummary = `goalTrace=${JSON.stringify(trace)}`;

    if (input.elapsedMs > GOAL_FOLLOW_THROUGH_5M_BUDGET_MS) {
        return {
            status: 'timeout',
            score: 0,
            metrics,
            summaries: [traceSummary],
            failureReason: 'goal-follow-through-5m exceeded the 5 minute budget before goal-follow-through evidence was observed',
        };
    }

    if (totalActions === 0) {
        return {
            status: 'failed',
            score: 0,
            metrics,
            summaries: [traceSummary],
            failureReason: 'No actions were observed during the benchmark window',
        };
    }

    if (attributionRatio < MIN_ATTRIBUTION_RATIO) {
        return {
            status: 'failed',
            score: Number(attributionRatio.toFixed(2)),
            metrics,
            summaries: [traceSummary],
            failureReason: `Only ${(attributionRatio * 100).toFixed(0)}% of actions were goal-attributed (need >= ${MIN_ATTRIBUTION_RATIO * 100}%)`,
        };
    }

    if (changes > MAX_GOAL_CHANGES) {
        return {
            status: 'failed',
            score: 0.5,
            metrics,
            summaries: [traceSummary],
            failureReason: `Resident thrashed between goals (${changes} changes > ${MAX_GOAL_CHANGES})`,
        };
    }

    if (!isSeedOrSuccessor(finalGoalId)) {
        return {
            status: 'failed',
            score: 0.75,
            metrics,
            summaries: [traceSummary],
            failureReason: `Final goal '${finalGoalId ?? 'none'}' is neither the seeded goal nor a sensible successor`,
        };
    }

    return {
        status: 'passed',
        score: 1,
        metrics,
        summaries: [
            traceSummary,
            `goal-follow-through-5m: ${goalAttributedActions}/${totalActions} actions on-goal, ${changes} goal change(s), final goal '${finalGoalId}'.`,
        ],
    };
}

export function makeGoalFollowThrough5mBenchmarkTask(now: () => number = () => Date.now()): BenchmarkTask {
    return {
        id: GOAL_FOLLOW_THROUGH_5M_TASK_ID,
        version: GOAL_FOLLOW_THROUGH_5M_TASK_VERSION,
        timeoutMs: GOAL_FOLLOW_THROUGH_5M_BUDGET_MS,
        resident: {
            spawnPosition: START_POSITION,
            initialInventory: [],
        },
        run: async _context => ({
            status: 'failed' as const,
            score: 0,
            failureReason:
                'goal-follow-through-5m requires autonomous mode with a live controller; run with --mode autonomous',
            metrics: { totalActions: 0, goalAttributedActions: 0, goalChangeCount: 0, finalGoalIsSeedOrSuccessor: 0 },
        }),
        runAutonomous: async context => observeFollowThrough(context, now),
    };
}

async function observeFollowThrough(context: BenchmarkTaskContext, now: () => number): Promise<BenchmarkTaskOutcome> {
    const startedAt = now();
    context.recordSummary('Observing goal follow-through: most actions stay attributed to the seeded goal with minimal thrash.');
    while (!context.signal.aborted && now() - startedAt < GOAL_FOLLOW_THROUGH_5M_BUDGET_MS) {
        const outcome = verifyGoalFollowThrough5m({
            elapsedMs: now() - startedAt,
            actions: recordedAttempts(context),
        });
        if (outcome.status === 'passed') {
            return outcome;
        }
        await sleep(1000, context.signal);
    }
    return verifyGoalFollowThrough5m({
        elapsedMs: now() - startedAt,
        actions: recordedAttempts(context),
    });
}

function recordedAttempts(context: BenchmarkTaskContext): GoalFollowThrough5mActionAttempt[] {
    return context.actionAttempts().map(attempt => {
        const withGoal = attempt as typeof attempt & { goalId?: string; tick?: number };
        return {
            action: attempt.action,
            goalId: typeof withGoal.goalId === 'string' ? withGoal.goalId : undefined,
            tick: typeof withGoal.tick === 'number' ? withGoal.tick : undefined,
            finalStatus: attempt.finalStatus,
        };
    });
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
