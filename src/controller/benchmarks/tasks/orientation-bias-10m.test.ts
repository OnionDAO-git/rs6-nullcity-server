import type { AgentAction } from '../../transport/message-codecs';
import {
    ORIENTATION_BIAS_10M_TASK_ID,
    ORIENTATION_BIAS_10M_TIMEOUT_MS,
    ORIENTATION_BIAS_GOAL_ID,
    makeOrientationBias10mBenchmarkTask,
    verifyOrientationBias10m,
    type OrientationBias10mActionAttempt,
} from './orientation-bias-10m';

function attempt(goalId: string | undefined, action: AgentAction): OrientationBias10mActionAttempt {
    return {
        action,
        goalId,
        tick: 1,
        finalStatus: 'success',
    };
}

describe('verifyOrientationBias10m', () => {
    it('passes when the resident picks the orientation goal and combat routine actions beat exploration', () => {
        const outcome = verifyOrientationBias10m({
            elapsedMs: 60_000,
            actions: [
                attempt(ORIENTATION_BIAS_GOAL_ID, {
                    kind: 'move_to',
                    target: { x: 3254, y: 3230, level: 0 },
                    cause: 'combat_seek_safe_target',
                }),
                attempt(ORIENTATION_BIAS_GOAL_ID, {
                    kind: 'attack',
                    target: { id: 'npc:goblin', kind: 'npc', name: 'Goblin', position: { x: 3254, y: 3231, level: 0 } },
                    cause: 'combat_attack_safe_target',
                }),
                attempt(ORIENTATION_BIAS_GOAL_ID, { kind: 'say', text: 'training safely', cause: 'combat_training_report' }),
                attempt('scout-nearby-area', { kind: 'move_to', target: { x: 3222, y: 3218, level: 0 }, cause: 'exploration_fallback' }),
            ],
        });

        expect(outcome.status).toBe('passed');
        expect(outcome.score).toBe(1);
        expect(outcome.metrics).toMatchObject({
            orientationGoalActions: 3,
            combatBiasedActions: 3,
            explorationBiasedActions: 1,
            finalGoalIsOrientation: 0,
        });
    });

    it('fails when exploration actions dominate despite healthy AP', () => {
        const outcome = verifyOrientationBias10m({
            elapsedMs: 60_000,
            actions: [
                attempt(ORIENTATION_BIAS_GOAL_ID, {
                    kind: 'move_to',
                    target: { x: 3222, y: 3218, level: 0 },
                    cause: 'exploration_fallback',
                }),
                attempt(ORIENTATION_BIAS_GOAL_ID, { kind: 'say', text: 'scouting', cause: 'explore_report' }),
                attempt(ORIENTATION_BIAS_GOAL_ID, {
                    kind: 'move_to',
                    target: { x: 3254, y: 3230, level: 0 },
                    cause: 'combat_seek_safe_target',
                }),
            ],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('Combat-biased');
    });

    it('fails when survival overrides the orientation goal', () => {
        const outcome = verifyOrientationBias10m({
            elapsedMs: 60_000,
            actions: [
                attempt('collect-visible-gp', { kind: 'move_to', target: { x: 3222, y: 3218, level: 0 }, cause: 'gp_pickup_goal' }),
                attempt('collect-visible-gp', {
                    kind: 'interact',
                    target: { itemId: 995, key: 'rs:coins' },
                    option: 'pick-up',
                    cause: 'gp_pickup_goal',
                }),
            ],
        });

        expect(outcome.status).toBe('failed');
        expect(outcome.failureReason).toContain('orientation goal');
    });

    it('times out when no orientation proof appears inside the budget', () => {
        const outcome = verifyOrientationBias10m({
            elapsedMs: ORIENTATION_BIAS_10M_TIMEOUT_MS + 1,
            actions: [
                attempt(ORIENTATION_BIAS_GOAL_ID, {
                    kind: 'move_to',
                    target: { x: 3254, y: 3230, level: 0 },
                    cause: 'combat_seek_safe_target',
                }),
            ],
        });

        expect(outcome.status).toBe('timeout');
    });
});

describe('makeOrientationBias10mBenchmarkTask', () => {
    it('declares a healthy combat orientation while seeding a generic exploration benchmark goal', () => {
        const task = makeOrientationBias10mBenchmarkTask();

        expect(task.id).toBe(ORIENTATION_BIAS_10M_TASK_ID);
        expect(task.timeoutMs).toBe(ORIENTATION_BIAS_10M_TIMEOUT_MS);
        expect(task.orientationGoal).toEqual({
            id: ORIENTATION_BIAS_GOAL_ID,
            description: 'Train combat safely against starter enemies and gather combat evidence for Null City.',
            tier: 'pursue',
        });
        expect(task.resident?.spawnPosition).toEqual({ x: 3254, y: 3230, level: 0 });
        expect(typeof task.runAutonomous).toBe('function');
    });
});
