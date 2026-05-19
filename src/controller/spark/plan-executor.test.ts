import type { Plan } from './plan';
import { PlanExecutor } from './plan-executor';

describe('PlanExecutor', () => {
    it('submits a step once and advances on the next tick', () => {
        const plan: Plan = {
            id: 'one-step',
            currentStep: 0,
            steps: [{ id: 'wait', action: { kind: 'noop' }, advanceWhen: { kind: 'next_tick' } }],
        };
        const executor = new PlanExecutor();

        expect(executor.tick(plan, { tick: 1, perception: {} }).action).toEqual({ kind: 'noop' });
        expect(executor.tick(plan, { tick: 1, perception: {} }).action).toBeUndefined();
        expect(executor.tick(plan, { tick: 2, perception: {} }).complete).toBe(true);
    });
});
