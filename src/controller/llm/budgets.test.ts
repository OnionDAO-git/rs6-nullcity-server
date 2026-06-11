import type { RuntimeState } from '../memory/runtime-state';
import {
    type InferenceBudget,
    MAX_PLANNER_CALLS_PER_DAY,
    MAX_CONCURRENT_PLANNER_CALLS,
    admitInference,
    admitPlannerCall,
    acquireGlobalPlannerSlot,
    releaseGlobalPlannerSlot,
    globalPlannerSlotsInUse,
    resetGlobalPlannerSlots,
    defaultInferenceBudget,
} from './budgets';

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
        // admitPlannerCall compares LOCAL calendar days (toDateString), so the
        // two instants must be >24h apart — that guarantees a calendar-day
        // change in every fixed-offset timezone. The previous pair crossed
        // only UTC midnight and stayed on the same local day west of UTC,
        // making this test fail on any US-timezone machine.
        const day1 = new Date('2026-06-04T23:50:00.000Z');
        const day2 = new Date('2026-06-06T00:05:00.000Z');
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

describe('global planner concurrency cap (RIQ-5-3)', () => {
    beforeEach(() => resetGlobalPlannerSlots());
    afterEach(() => resetGlobalPlannerSlots());

    it('has a sane default cap small enough to prevent burst-N paid calls on restart', () => {
        expect(MAX_CONCURRENT_PLANNER_CALLS).toBeLessThanOrEqual(5);
        expect(MAX_CONCURRENT_PLANNER_CALLS).toBeGreaterThanOrEqual(1);
    });

    it('admits slots up to the cap and reports in-use count', () => {
        expect(globalPlannerSlotsInUse()).toBe(0);
        expect(acquireGlobalPlannerSlot(2)).toBe(true);
        expect(globalPlannerSlotsInUse()).toBe(1);
        expect(acquireGlobalPlannerSlot(2)).toBe(true);
        expect(globalPlannerSlotsInUse()).toBe(2);
    });

    it('denies a slot when the cap is reached', () => {
        acquireGlobalPlannerSlot(2);
        acquireGlobalPlannerSlot(2);
        expect(acquireGlobalPlannerSlot(2)).toBe(false);
        expect(globalPlannerSlotsInUse()).toBe(2);
    });

    it('re-admits after a slot is released', () => {
        acquireGlobalPlannerSlot(2);
        acquireGlobalPlannerSlot(2);
        expect(acquireGlobalPlannerSlot(2)).toBe(false);
        releaseGlobalPlannerSlot();
        expect(globalPlannerSlotsInUse()).toBe(1);
        expect(acquireGlobalPlannerSlot(2)).toBe(true);
        expect(globalPlannerSlotsInUse()).toBe(2);
    });

    it('does not go below zero on extra releases (defensive)', () => {
        releaseGlobalPlannerSlot();
        expect(globalPlannerSlotsInUse()).toBe(0);
    });

    it('uses MAX_CONCURRENT_PLANNER_CALLS as the default cap', () => {
        for (let i = 0; i < MAX_CONCURRENT_PLANNER_CALLS; i++) {
            expect(acquireGlobalPlannerSlot()).toBe(true);
        }
        expect(acquireGlobalPlannerSlot()).toBe(false);
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
