import type { RuntimeState } from '../memory/runtime-state';
import { type InferenceBudget, MAX_PLANNER_CALLS_PER_DAY, admitInference, admitPlannerCall, defaultInferenceBudget } from './budgets';

describe('inference budgets', () => {
    it('keeps resident brain budgets bounded but high enough for all-day weekend operation', () => {
        expect(defaultInferenceBudget()).toEqual({
            maxRequestsPerTick: 1,
            maxRequestsPerMinute: 60,
            maxRequestsPerDay: 10000,
            noInferenceMs: 20_000,
        });
    });

    it('denies a second inference in the same tick without pausing later ticks', () => {
        const now = new Date('2026-05-19T12:00:00.000Z');
        const state = stateAt(7, now);
        const budget: InferenceBudget = {
            maxRequestsPerTick: 1,
            maxRequestsPerMinute: 10,
            maxRequestsPerDay: 100,
        };

        expect(admitInference(state, budget, now)).toEqual({ ok: true });
        expect(admitInference(state, budget, now)).toEqual({ ok: false, window: 'tick' });
        expect(state.budgets.noInferenceUntil).toBeUndefined();

        state.tick += 1;
        expect(admitInference(state, budget, now)).toEqual({ ok: true });
    });

    it('emits a pause decision for minute exhaustion', () => {
        const now = new Date('2026-05-19T12:00:00.000Z');
        const state = stateAt(7, now);
        const budget: InferenceBudget = {
            maxRequestsPerTick: 10,
            maxRequestsPerMinute: 1,
            maxRequestsPerDay: 100,
            noInferenceMs: 30_000,
        };

        expect(admitInference(state, budget, now)).toEqual({ ok: true });
        const denied = admitInference(state, budget, now);

        expect(denied.ok).toBe(false);
        expect(denied.window).toBe('minute');
        expect(denied.retryAt?.toISOString()).toBe('2026-05-19T12:00:30.000Z');
        expect(state.budgets.noInferenceUntil).toBe('2026-05-19T12:00:30.000Z');
    });
});

describe('planner budgets (S-PLAN-BUDGET-1)', () => {
    it('has a sane default max that prevents runaway paid planner loops', () => {
        expect(MAX_PLANNER_CALLS_PER_DAY).toBe(10);
    });

    it('admits the first planner call and increments the counter', () => {
        const now = new Date('2026-06-04T08:00:00.000Z');
        const state = stateAt(1, now);
        const result = admitPlannerCall(state, 3, now);
        expect(result).toEqual({ ok: true, callsToday: 1, max: 3 });
        expect(state.budgets.plannerCallsToday).toBe(1);
        expect(state.budgets.plannerDayStartedAt).toBe(now.toISOString());
    });

    it('blocks once the daily max is reached, without incrementing the counter', () => {
        const now = new Date('2026-06-04T10:00:00.000Z');
        const state = stateAt(1, now);
        admitPlannerCall(state, 2, now);
        admitPlannerCall(state, 2, now);
        const blocked = admitPlannerCall(state, 2, now);
        expect(blocked).toEqual({ ok: false, callsToday: 2, max: 2 });
        expect(state.budgets.plannerCallsToday).toBe(2);
    });

    it('resets the counter on a new calendar day', () => {
        const day1 = new Date('2026-06-04T23:50:00.000Z');
        const day2 = new Date('2026-06-05T00:05:00.000Z');
        const state = stateAt(1, day1);
        // Exhaust day 1 budget
        for (let i = 0; i < 3; i++) admitPlannerCall(state, 3, day1);
        expect(admitPlannerCall(state, 3, day1)).toMatchObject({ ok: false });
        // Day 2: budget resets
        const reset = admitPlannerCall(state, 3, day2);
        expect(reset).toEqual({ ok: true, callsToday: 1, max: 3 });
        expect(state.budgets.plannerCallsToday).toBe(1);
    });

    it('treats a missing plannerDayStartedAt as a new day (first call on a fresh state)', () => {
        const now = new Date('2026-06-04T12:00:00.000Z');
        const state = stateAt(1, now);
        expect(state.budgets.plannerDayStartedAt).toBeUndefined();
        const result = admitPlannerCall(state, 5, now);
        expect(result).toMatchObject({ ok: true, callsToday: 1 });
    });
});

function stateAt(tick: number, now: Date): RuntimeState {
    return {
        resident: 'res:test',
        attention: 100,
        tick,
        legacy: { kind: 'mentor', progress: {}, complete: false },
        budgets: {
            minuteStartedAt: now.toISOString(),
            dayStartedAt: now.toISOString(),
            requestsThisMinute: 0,
            requestsToday: 0,
        },
    };
}
