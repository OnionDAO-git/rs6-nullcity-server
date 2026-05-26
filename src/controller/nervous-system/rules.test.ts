import type { RuntimeState } from '../memory/runtime-state';
import { evaluateNervousRules, type NervousRule } from './rules';

describe('evaluateNervousRules', () => {
    it('returns the highest priority matching action and applies cooldowns', () => {
        const state = stateAt(4);
        const rules: NervousRule[] = [
            { id: 'low', priority: 10, condition: { kind: 'always' }, action: { kind: 'noop' } },
            {
                id: 'eat-on-hit',
                priority: 80,
                condition: { kind: 'event_kind', value: 'hit' },
                action: { kind: 'eat', slot: 3 },
                cooldownTicks: 5,
            },
        ];

        const first = evaluateNervousRules(rules, state, { tick: 10, events: [{ kind: 'hit' }] }, {});
        const second = evaluateNervousRules(rules, state, { tick: 11, events: [{ kind: 'hit' }] }, {});

        expect(first?.action).toEqual({ kind: 'eat', slot: 3, cause: 'nervous:eat-on-hit' });
        expect(first?.suppressThinking).toBe(true);
        expect(second?.rule.id).toBe('low');
    });

    it('supports direct low-health perception comparisons', () => {
        const state = stateAt(4);
        const rules: NervousRule[] = [
            {
                id: 'eat-when-low',
                priority: 80,
                condition: { kind: 'perception_path_lte', value: { path: 'self.hpFraction', value: 0.35 } },
                action: { kind: 'eat', slot: 0 },
            },
        ];

        const reaction = evaluateNervousRules(rules, state, { tick: 10, self: { hpFraction: 0.25 } }, {});

        expect(reaction?.action).toEqual({ kind: 'eat', slot: 0, cause: 'nervous:eat-when-low' });
    });

    it('aliases hit_taken to hit', () => {
        const state = stateAt(4);
        const rules: NervousRule[] = [
            {
                id: 'eat-on-hit',
                priority: 80,
                condition: { kind: 'event_kind', value: 'hit' },
                action: { kind: 'eat', slot: 3 },
            },
        ];

        const reaction = evaluateNervousRules(rules, state, { tick: 10, events: [{ kind: 'hit_taken' }] }, {});
        expect(reaction?.action).toEqual({ kind: 'eat', slot: 3, cause: 'nervous:eat-on-hit' });
    });

    it('aliases died to death', () => {
        const state = stateAt(4);
        const rules: NervousRule[] = [
            {
                id: 'mourn-on-death',
                priority: 80,
                condition: { kind: 'event_kind', value: 'death' },
                action: { kind: 'say', text: 'mourning' },
            },
        ];

        const reaction = evaluateNervousRules(rules, state, { tick: 10, events: [{ kind: 'died' }] }, {});
        expect(reaction?.action).toEqual({ kind: 'say', text: 'mourning', cause: 'nervous:mourn-on-death' });
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
        variables: {},
        hookCooldowns: {},
        shadowedHooks: [],
    };
}
