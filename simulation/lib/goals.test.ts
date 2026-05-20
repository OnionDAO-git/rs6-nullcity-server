import { GoalPlanner } from './goals';
import type { ResidentAssignment } from './types';

describe('GoalPlanner', () => {
    const assignment: ResidentAssignment = {
        name: 'res:sim0001',
        goal: 'collect_items',
        assignedAt: '2026-01-01T00:00:00.000Z',
        home: { x: 3200, y: 3200, level: 0 },
    };

    it('prioritizes visible world items for collect_items', () => {
        const planner = new GoalPlanner();
        const action = planner.nextAction({
            assignment,
            actionIntervalTicks: 1,
            perception: {
                tick: 10,
                resident: { position: { x: 3200, y: 3200, level: 0 } },
                nearby: {
                    worldItems: [{ itemId: 995, amount: 1, position: { x: 3201, y: 3200, level: 0 } }],
                },
            },
        });

        expect(action).toEqual({
            kind: 'interact',
            target: { itemId: 995, amount: 1, position: { x: 3201, y: 3200, level: 0 } },
            option: 'pick-up',
        });
    });

    it('throttles decisions by tick interval', () => {
        const planner = new GoalPlanner();
        const first = planner.nextAction({
            assignment: { ...assignment, goal: 'wander' },
            actionIntervalTicks: 5,
            perception: { tick: 10, resident: { position: { x: 3200, y: 3200, level: 0 } } },
        });
        const second = planner.nextAction({
            assignment: { ...assignment, goal: 'wander' },
            actionIntervalTicks: 5,
            perception: { tick: 12, resident: { position: { x: 3200, y: 3200, level: 0 } } },
        });

        expect(first).toBeTruthy();
        expect(second).toBeNull();
    });
});
