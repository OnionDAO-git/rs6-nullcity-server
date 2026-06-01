import { DEFAULT_BRAIN_GOAL_TTL_TICKS, resolveBrainGoalTtl } from './hybrid-agent-helpers';

/**
 * Deep-check finding (2026-06-01): LLM-authored brain goals routinely omit
 * `ttlTicks`, and goalExpired() treats an undefined TTL as "never expires" —
 * so unsatisfiable goals ("Follow Codex" when Codex is absent, "Find an axe"
 * when none exists) became immortal and residents got stuck. Brain goals must
 * carry a bounded TTL so they self-retire and the resident re-plans.
 */
describe('resolveBrainGoalTtl', () => {
    it('keeps an explicit model-provided TTL', () => {
        expect(resolveBrainGoalTtl(300)).toBe(300);
        expect(resolveBrainGoalTtl(900)).toBe(900);
    });

    it('defaults to the bounded brain-goal TTL when the model omits one (no more immortal goals)', () => {
        expect(resolveBrainGoalTtl(undefined)).toBe(DEFAULT_BRAIN_GOAL_TTL_TICKS);
    });

    it('uses a finite default in the established factory range (300..900)', () => {
        expect(DEFAULT_BRAIN_GOAL_TTL_TICKS).toBeGreaterThanOrEqual(300);
        expect(DEFAULT_BRAIN_GOAL_TTL_TICKS).toBeLessThanOrEqual(900);
    });

    it('treats a non-positive or non-finite model TTL as omitted (fail-safe to the default)', () => {
        expect(resolveBrainGoalTtl(0)).toBe(DEFAULT_BRAIN_GOAL_TTL_TICKS);
        expect(resolveBrainGoalTtl(-5)).toBe(DEFAULT_BRAIN_GOAL_TTL_TICKS);
        expect(resolveBrainGoalTtl(Number.NaN)).toBe(DEFAULT_BRAIN_GOAL_TTL_TICKS);
    });
});
