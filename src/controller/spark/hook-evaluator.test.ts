import type { RuntimeState } from '../memory/runtime-state';
import { HookEvaluator } from './hook-evaluator';
import type { HookDefinition } from './hooks';

describe('HookEvaluator', () => {
    it('uses priority then id as deterministic tie-break and records shadowed hooks', () => {
        const state = stateAt(10);
        const hooks: HookDefinition[] = [
            { id: 'b', priority: 50, condition: { kind: 'always' } },
            { id: 'a', priority: 50, condition: { kind: 'always' } },
        ];

        const fired = new HookEvaluator().evaluate(hooks, state, {}, {});

        expect(fired.map(hook => hook.id)).toEqual(['a', 'b']);
        expect(state.shadowedHooks?.[0]).toMatchObject({ id: 'b', shadowedBy: 'a' });
    });

    it('honors cooldowns', () => {
        const state = stateAt(10);
        const hooks: HookDefinition[] = [{ id: 'cooling', priority: 10, condition: { kind: 'always' }, cooldownTicks: 5 }];
        const evaluator = new HookEvaluator();

        expect(evaluator.evaluate(hooks, state, {}, {})[0]?.id).toBe('cooling');
        expect(evaluator.evaluate(hooks, state, {}, {})).toEqual([]);
    });
});

function stateAt(tick: number): RuntimeState {
    const now = new Date().toISOString();
    return {
        resident: 'res:test',
        attention: 100,
        tick,
        legacy: { kind: 'mentor', progress: {}, complete: false },
        budgets: { minuteStartedAt: now, dayStartedAt: now, requestsThisMinute: 0, requestsToday: 0 },
        hookCooldowns: {},
        shadowedHooks: [],
    };
}
