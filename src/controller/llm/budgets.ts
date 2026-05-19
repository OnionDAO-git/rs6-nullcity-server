import type { RuntimeState } from '../memory/runtime-state';

export interface InferenceBudget {
    maxRequestsPerTick: number;
    maxRequestsPerMinute: number;
    maxRequestsPerDay: number;
    noInferenceMs?: number;
}

export function defaultInferenceBudget(): InferenceBudget {
    return {
        maxRequestsPerTick: 1,
        maxRequestsPerMinute: 20,
        maxRequestsPerDay: 2000,
        noInferenceMs: 60_000,
    };
}

export type BudgetWindow = 'tick' | 'minute' | 'day';

export interface BudgetDecision {
    ok: boolean;
    window?: BudgetWindow | 'pause';
    retryAt?: Date;
}

export function admitInference(state: RuntimeState, budget: InferenceBudget = defaultInferenceBudget(), now = new Date()): BudgetDecision {
    rollWindows(state, now);

    if (state.budgets.noInferenceUntil) {
        const retryAt = new Date(state.budgets.noInferenceUntil);
        if (retryAt > now) {
            return { ok: false, window: 'pause', retryAt };
        }
        state.budgets.noInferenceUntil = undefined;
    }

    if (budget.maxRequestsPerTick > 0 && (state.budgets.requestsThisTick || 0) >= budget.maxRequestsPerTick) {
        return { ok: false, window: 'tick' };
    }

    if (budget.maxRequestsPerMinute > 0 && state.budgets.requestsThisMinute >= budget.maxRequestsPerMinute) {
        return rejectFor(state, 'minute', budget, now);
    }

    if (budget.maxRequestsPerDay > 0 && state.budgets.requestsToday >= budget.maxRequestsPerDay) {
        return rejectFor(state, 'day', budget, now);
    }

    state.budgets.lastTick = state.tick;
    state.budgets.requestsThisTick = (state.budgets.requestsThisTick || 0) + 1;
    state.budgets.requestsThisMinute += 1;
    state.budgets.requestsToday += 1;
    return { ok: true };
}

function rejectFor(state: RuntimeState, window: BudgetWindow, budget: InferenceBudget, now: Date): BudgetDecision {
    const retryAt = new Date(now.getTime() + (budget.noInferenceMs || 60_000));
    state.budgets.noInferenceUntil = retryAt.toISOString();
    return { ok: false, window, retryAt };
}

function rollWindows(state: RuntimeState, now: Date): void {
    if (state.budgets.lastTick !== state.tick) {
        state.budgets.lastTick = state.tick;
        state.budgets.requestsThisTick = 0;
    }

    const minuteStartedAt = new Date(state.budgets.minuteStartedAt);
    if (!Number.isFinite(minuteStartedAt.getTime()) || now.getTime() - minuteStartedAt.getTime() >= 60_000) {
        state.budgets.minuteStartedAt = now.toISOString();
        state.budgets.requestsThisMinute = 0;
    }

    const dayStartedAt = new Date(state.budgets.dayStartedAt);
    if (!Number.isFinite(dayStartedAt.getTime()) || now.toDateString() !== dayStartedAt.toDateString()) {
        state.budgets.dayStartedAt = now.toISOString();
        state.budgets.requestsToday = 0;
    }
}
