import type { RuntimeState } from '../memory/runtime-state';
import { type InferenceBudget, admitInference, defaultInferenceBudget } from './budgets';

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
