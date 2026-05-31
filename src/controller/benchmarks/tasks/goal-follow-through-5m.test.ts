import {
    GOAL_FOLLOW_THROUGH_5M_TASK_ID,
    GOAL_FOLLOW_THROUGH_5M_BUDGET_MS,
    SEED_GOAL_ID,
    makeGoalFollowThrough5mBenchmarkTask,
    verifyGoalFollowThrough5m,
    type GoalFollowThrough5mActionAttempt,
} from './goal-follow-through-5m';

function attempt(goalId: string | undefined, tick: number, kind = 'move'): GoalFollowThrough5mActionAttempt {
    return {
        action: { kind, cause: 'test' } as never,
        goalId,
        tick,
        finalStatus: 'success',
    };
}

describe('verifyGoalFollowThrough5m', () => {
    it('fails (timeout) when the budget is exceeded', () => {
        const outcome = verifyGoalFollowThrough5m({
            elapsedMs: GOAL_FOLLOW_THROUGH_5M_BUDGET_MS + 1,
            actions: [attempt(SEED_GOAL_ID, 1)],
        });
        expect(outcome.status).toBe('timeout');
        expect(outcome.score).toBe(0);
    });

    it('passes when ≥60% of actions are goal-attributed, ≤3 goal changes, and final goal is the seed', () => {
        const actions = [
            attempt(SEED_GOAL_ID, 1),
            attempt(SEED_GOAL_ID, 2),
            attempt(SEED_GOAL_ID, 3),
            attempt(undefined, 4), // unattributed
            attempt(SEED_GOAL_ID, 5),
        ];
        const outcome = verifyGoalFollowThrough5m({ elapsedMs: 1000, actions });
        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        // 4 of 5 attributed = 0.8 >= 0.6
        expect(outcome.metrics?.goalAttributedActions).toBe(4);
        expect(outcome.metrics?.totalActions).toBe(5);
        expect(outcome.metrics?.goalChangeCount).toBe(0);
    });

    it('fails when fewer than 60% of actions are goal-attributed', () => {
        const actions = [attempt(SEED_GOAL_ID, 1), attempt(undefined, 2), attempt(undefined, 3), attempt(undefined, 4)];
        const outcome = verifyGoalFollowThrough5m({ elapsedMs: 1000, actions });
        expect(outcome.status).toBe('failed');
        expect(outcome.metrics?.goalAttributedActions).toBe(1);
        expect(outcome.metrics?.totalActions).toBe(4);
    });

    it('counts a goal change each time the attributed goal id differs from the previous attributed goal', () => {
        const actions = [
            attempt(SEED_GOAL_ID, 1),
            attempt('goal-b', 2), // change 1
            attempt('goal-c', 3), // change 2
            attempt(SEED_GOAL_ID, 4), // change 3
        ];
        const outcome = verifyGoalFollowThrough5m({ elapsedMs: 1000, actions });
        expect(outcome.metrics?.goalChangeCount).toBe(3);
        // final goal is the seed, 100% attributed, exactly 3 changes -> pass
        expect(outcome.status).toBe('passed');
    });

    it('fails when goalChangeCount exceeds 3 (thrash)', () => {
        const actions = [
            attempt(SEED_GOAL_ID, 1),
            attempt('goal-b', 2), // 1
            attempt(SEED_GOAL_ID, 3), // 2
            attempt('goal-b', 4), // 3
            attempt(SEED_GOAL_ID, 5), // 4 -> too many
        ];
        const outcome = verifyGoalFollowThrough5m({ elapsedMs: 1000, actions });
        expect(outcome.metrics?.goalChangeCount).toBe(4);
        expect(outcome.status).toBe('failed');
    });

    it('passes when the final goal is a sensible successor rather than the literal seed', () => {
        // A successor goal id is one that shares the seed prefix family.
        const successor = `${SEED_GOAL_ID}-followup`;
        const actions = [attempt(SEED_GOAL_ID, 1), attempt(SEED_GOAL_ID, 2), attempt(successor, 3)];
        const outcome = verifyGoalFollowThrough5m({ elapsedMs: 1000, actions });
        expect(outcome.status).toBe('passed');
    });

    it('fails when the final goal is unrelated to the seed', () => {
        const actions = [attempt(SEED_GOAL_ID, 1), attempt(SEED_GOAL_ID, 2), attempt('completely-different', 3)];
        const outcome = verifyGoalFollowThrough5m({ elapsedMs: 1000, actions });
        expect(outcome.status).toBe('failed');
    });

    it('emits a goalTrace summary with {tick, goalId} entries for attributed actions', () => {
        const actions = [attempt(SEED_GOAL_ID, 1), attempt('goal-b', 2), attempt(SEED_GOAL_ID, 3)];
        const outcome = verifyGoalFollowThrough5m({ elapsedMs: 1000, actions });
        const traceSummary = (outcome.summaries || []).find(s => s.startsWith('goalTrace='));
        expect(traceSummary).toBeDefined();
        const trace = JSON.parse(traceSummary!.slice('goalTrace='.length));
        expect(trace).toEqual([
            { tick: 1, goalId: SEED_GOAL_ID },
            { tick: 2, goalId: 'goal-b' },
            { tick: 3, goalId: SEED_GOAL_ID },
        ]);
    });
});

describe('makeGoalFollowThrough5mBenchmarkTask', () => {
    it('exposes the task id, version, timeout, and a resident spawn seed', () => {
        const task = makeGoalFollowThrough5mBenchmarkTask();
        expect(task.id).toBe(GOAL_FOLLOW_THROUGH_5M_TASK_ID);
        expect(task.timeoutMs).toBe(GOAL_FOLLOW_THROUGH_5M_BUDGET_MS);
        // Resident seed exists (healthy AP comes from the default benchmark
        // attention profile = 5000, keeping the resident out of survive band).
        expect(task.resident?.spawnPosition).toBeDefined();
        expect(typeof task.run).toBe('function');
        expect(typeof task.runAutonomous).toBe('function');
    });
});
