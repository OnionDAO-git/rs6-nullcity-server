import type { RuntimeState } from '../memory/runtime-state';

export interface InferenceBudget {
    maxRequestsPerTick: number;
    maxRequestsPerMinute: number;
    maxRequestsPerDay: number;
    noInferenceMs?: number;
}

/**
 * Default rate/backoff limits. Named constants so the maintainer can tighten
 * them back later if a resident over-spends inference. S-INFER-4 loosened these
 * because the slow (~40s) qwopus brain was being rate-capped / suppressed while
 * trying to think; a single resident attempting to deliberate must not be
 * throttled out of finishing.
 */
const DEFAULT_MAX_REQUESTS_PER_TICK = 1;
/** 20 → 60: a resident that is trying to think should not be rate-capped. */
const DEFAULT_MAX_REQUESTS_PER_MINUTE = 60;
const DEFAULT_MAX_REQUESTS_PER_DAY = 10000;
/** 60_000 → 20_000: a transient hiccup must not suppress thinking for a full minute. */
const DEFAULT_NO_INFERENCE_MS = 20_000;

export function defaultInferenceBudget(): InferenceBudget {
    return {
        maxRequestsPerTick: DEFAULT_MAX_REQUESTS_PER_TICK,
        maxRequestsPerMinute: DEFAULT_MAX_REQUESTS_PER_MINUTE,
        maxRequestsPerDay: DEFAULT_MAX_REQUESTS_PER_DAY,
        noInferenceMs: DEFAULT_NO_INFERENCE_MS,
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

/**
 * S-PLAN-BUDGET-1: Daily planner-call budget — guards the rare but paid
 * PlannerPass (planner_haiku ~$0.016/call) against runaway replanning loops.
 *
 * Stored in RuntimeState.budgets so it persists across ticks within the same
 * controller session (resets to 0 on a new calendar day). Unlike the body
 * inference budget, planner calls are counted per-call, not per-tick/minute.
 *
 * Default: 10 planner calls per resident per calendar day. A blocked stage
 * → replan loop with a 90s planner timeout cannot exceed 10 paid calls/day
 * even if the resident re-plans every time it wakes. Maintainers can raise
 * this via the `max` parameter at the call site if a resident legitimately
 * needs more replanning (e.g. a very multi-stage goal with many blocked stages).
 */
export const MAX_PLANNER_CALLS_PER_DAY = 10;

export interface PlannerBudgetDecision {
    ok: boolean;
    callsToday: number;
    max: number;
}

/**
 * Admit (or deny) one planner call for this resident today.
 *
 * On admit: increments `state.budgets.plannerCallsToday` in-place (caller must
 * save `RuntimeState` to disk if persistence is desired — maybeTriggerPlannerPass
 * does NOT save state itself; the host's tick loop persists RuntimeState).
 *
 * On deny: leaves the counter unchanged; caller should log and skip the planner.
 */
export function admitPlannerCall(
    state: RuntimeState,
    max = MAX_PLANNER_CALLS_PER_DAY,
    now = new Date(),
): PlannerBudgetDecision {
    // Roll the day window when the calendar day changes.
    const plannerDayStartedAt = state.budgets.plannerDayStartedAt
        ? new Date(state.budgets.plannerDayStartedAt)
        : undefined;
    if (!plannerDayStartedAt || now.toDateString() !== plannerDayStartedAt.toDateString()) {
        state.budgets.plannerDayStartedAt = now.toISOString();
        state.budgets.plannerCallsToday = 0;
    }

    const callsToday = state.budgets.plannerCallsToday ?? 0;
    if (callsToday >= max) {
        return { ok: false, callsToday, max };
    }

    state.budgets.plannerCallsToday = callsToday + 1;
    return { ok: true, callsToday: callsToday + 1, max };
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
