/**
 * Tests for the resident needs-hierarchy ranker (S-SMART-NEEDS).
 *
 * These tests pin the pure behavior of `currentTier` and `rankCandidateGoals`
 * so the integration seam in the Brain planner can rely on stable
 * tier-classification + tag-aware ranking. See `needs-hierarchy.ts` for the
 * rationale behind the buffer/threshold constants.
 *
 * Contract (from `docs/2026-05-29-cic-meetup-decisions.md`,
 * "Goal And Intelligence Direction"):
 *   1. Survive AP
 *   2. Earn / preserve GP
 *   3. Pursue Soul goal
 *   4. Reflect / write to Library
 */

import { AP_SURVIVE_BUFFER, GP_HEALTHY_THRESHOLD, currentTier, rankCandidateGoals } from './needs-hierarchy';
import type { GoalCandidate, NeedsTier, ResidentNeedsContext } from './needs-hierarchy';

// ---- helpers ------------------------------------------------------------

const ctxOf = (overrides: Partial<ResidentNeedsContext>): ResidentNeedsContext => ({
    ap: 100,
    apFloor: 10,
    gpEstimate: 1000,
    hasActiveGoal: false,
    ...overrides,
});

// ---- currentTier --------------------------------------------------------

describe('currentTier — survive (AP at/below floor + buffer)', () => {
    it('returns "survive" when ap equals apFloor (below floor+buffer)', () => {
        expect(currentTier(ctxOf({ ap: 10, apFloor: 10 }))).toBe('survive');
    });

    it('returns "survive" when ap is below floor', () => {
        expect(currentTier(ctxOf({ ap: 0, apFloor: 10 }))).toBe('survive');
    });

    it('returns "survive" when ap is within buffer of floor', () => {
        // floor=10, buffer=5: ap=12 sits inside the warning band
        expect(currentTier(ctxOf({ ap: 10 + AP_SURVIVE_BUFFER - 1, apFloor: 10 }))).toBe('survive');
    });

    it('leaves "survive" once ap rises above floor + buffer', () => {
        expect(currentTier(ctxOf({ ap: 10 + AP_SURVIVE_BUFFER + 1, apFloor: 10 }))).not.toBe('survive');
    });

    it('survive takes precedence over earn even when gp is also low', () => {
        expect(currentTier(ctxOf({ ap: 0, apFloor: 10, gpEstimate: 0 }))).toBe('survive');
    });
});

describe('currentTier — earn (healthy AP, low GP or idle)', () => {
    it('returns "earn" when ap healthy but gp below healthy threshold', () => {
        expect(currentTier(ctxOf({ ap: 100, apFloor: 10, gpEstimate: GP_HEALTHY_THRESHOLD - 1, hasActiveGoal: true }))).toBe('earn');
    });

    it('returns "earn" when ap healthy, gp=0, no active goal', () => {
        expect(currentTier(ctxOf({ ap: 100, apFloor: 10, gpEstimate: 0, hasActiveGoal: false }))).toBe('earn');
    });

    it('returns "earn" rather than "reflect" when no GP and no active goal', () => {
        // Idle resident with healthy AP but no money + nothing to do should hunt for GP.
        expect(currentTier(ctxOf({ ap: 500, apFloor: 10, gpEstimate: 0, hasActiveGoal: false }))).toBe('earn');
    });
});

describe('currentTier — pursue (everything healthy + active goal)', () => {
    it('returns "pursue" when ap + gp healthy AND hasActiveGoal=true', () => {
        expect(currentTier(ctxOf({ ap: 100, apFloor: 10, gpEstimate: GP_HEALTHY_THRESHOLD, hasActiveGoal: true }))).toBe('pursue');
    });

    it('does NOT return "pursue" when gp is below threshold even with active goal', () => {
        expect(currentTier(ctxOf({ ap: 100, apFloor: 10, gpEstimate: GP_HEALTHY_THRESHOLD - 1, hasActiveGoal: true }))).not.toBe('pursue');
    });
});

describe('currentTier — reflect (healthy + idle with money)', () => {
    it('returns "reflect" when ap + gp healthy but no active goal', () => {
        expect(
            currentTier(
                ctxOf({
                    ap: 200,
                    apFloor: 10,
                    gpEstimate: GP_HEALTHY_THRESHOLD,
                    hasActiveGoal: false,
                }),
            ),
        ).toBe('reflect');
    });

    it('all four NeedsTier values are reachable', () => {
        const seen = new Set<NeedsTier>();
        seen.add(currentTier(ctxOf({ ap: 0, apFloor: 10 }))); // survive
        seen.add(currentTier(ctxOf({ ap: 100, apFloor: 10, gpEstimate: 0, hasActiveGoal: false }))); // earn
        seen.add(
            currentTier(
                ctxOf({
                    ap: 100,
                    apFloor: 10,
                    gpEstimate: GP_HEALTHY_THRESHOLD,
                    hasActiveGoal: true,
                }),
            ),
        ); // pursue
        seen.add(
            currentTier(
                ctxOf({
                    ap: 200,
                    apFloor: 10,
                    gpEstimate: GP_HEALTHY_THRESHOLD,
                    hasActiveGoal: false,
                }),
            ),
        ); // reflect
        expect(seen).toEqual(new Set<NeedsTier>(['survive', 'earn', 'pursue', 'reflect']));
    });
});

// ---- rankCandidateGoals -------------------------------------------------

describe('rankCandidateGoals', () => {
    const goals: ReadonlyArray<GoalCandidate> = [
        { id: 'eat-shrimp', tags: ['survive', 'eat', 'ap'] },
        { id: 'sell-logs', tags: ['gp', 'earn', 'trade'] },
        { id: 'finish-quest', tags: ['pursue', 'goal'] },
        { id: 'wander', tags: [] },
    ];

    it('returns [] for empty input', () => {
        expect(rankCandidateGoals([], ctxOf({}))).toEqual([]);
    });

    it('ranks survive-tagged goals first when ap is at floor', () => {
        const ranked = rankCandidateGoals(goals, ctxOf({ ap: 5, apFloor: 10 }));
        expect(ranked[0]?.id).toBe('eat-shrimp');
        expect(ranked[0]?.tier).toBe('survive');
    });

    it('ranks gp/earn-tagged goals first when in "earn" tier', () => {
        const ranked = rankCandidateGoals(goals, ctxOf({ ap: 100, apFloor: 10, gpEstimate: 0, hasActiveGoal: true }));
        expect(ranked[0]?.id).toBe('sell-logs');
        expect(ranked[0]?.tier).toBe('earn');
    });

    it('ranks pursue/goal-tagged goals first when in "pursue" tier', () => {
        const ranked = rankCandidateGoals(
            goals,
            ctxOf({
                ap: 100,
                apFloor: 10,
                gpEstimate: GP_HEALTHY_THRESHOLD,
                hasActiveGoal: true,
            }),
        );
        expect(ranked[0]?.id).toBe('finish-quest');
        expect(ranked[0]?.tier).toBe('pursue');
    });

    it('untagged goals fall back to a neutral score (stable middle/back)', () => {
        const ranked = rankCandidateGoals(goals, ctxOf({ ap: 5, apFloor: 10 }));
        const wander = ranked.find(g => g.id === 'wander');
        const eat = ranked.find(g => g.id === 'eat-shrimp');
        expect(wander).toBeDefined();
        expect(eat).toBeDefined();
        // Tagged-aligned goal must outrank an untagged one in this tier.
        expect((eat as { score: number }).score).toBeGreaterThan((wander as { score: number }).score);
    });

    it('is pure / deterministic: identical input yields identical output', () => {
        const ctx = ctxOf({ ap: 5, apFloor: 10 });
        const a = rankCandidateGoals(goals, ctx);
        const b = rankCandidateGoals(goals, ctx);
        expect(a).toEqual(b);
    });

    it('uses stable sort so equal-score goals keep input order', () => {
        // Three same-tier-aligned goals all earn the aligned bonus. Stable
        // sort should preserve their original ordering.
        const surviveCtx = ctxOf({ ap: 0, apFloor: 10 });
        const tied: ReadonlyArray<GoalCandidate> = [
            { id: 'eat-a', tags: ['eat'] },
            { id: 'eat-b', tags: ['eat'] },
            { id: 'eat-c', tags: ['eat'] },
            { id: 'wander', tags: [] },
        ];
        const ranked = rankCandidateGoals(tied, surviveCtx);
        expect(ranked.map(g => g.id)).toEqual(['eat-a', 'eat-b', 'eat-c', 'wander']);
    });

    it('treats missing tags array the same as []', () => {
        const ranked = rankCandidateGoals([{ id: 'no-tags' }, { id: 'survive', tags: ['survive'] }], ctxOf({ ap: 0, apFloor: 10 }));
        expect(ranked[0]?.id).toBe('survive');
        expect(ranked[1]?.id).toBe('no-tags');
    });

    it('every returned entry carries the same tier as currentTier(ctx)', () => {
        const ctx = ctxOf({ ap: 5, apFloor: 10 });
        const tier = currentTier(ctx);
        const ranked = rankCandidateGoals(goals, ctx);
        for (const entry of ranked) {
            expect(entry.tier).toBe(tier);
        }
    });

    it('handles a single-goal list without crashing or reordering', () => {
        const ranked = rankCandidateGoals([{ id: 'lonely' }], ctxOf({ ap: 5, apFloor: 10 }));
        expect(ranked).toHaveLength(1);
        expect(ranked[0]?.id).toBe('lonely');
    });

    it('does not mutate the input goals array', () => {
        const input: ReadonlyArray<GoalCandidate> = [
            { id: 'a', tags: ['survive'] },
            { id: 'b', tags: ['pursue'] },
        ];
        const snapshot = JSON.parse(JSON.stringify(input));
        rankCandidateGoals(input, ctxOf({ ap: 5, apFloor: 10 }));
        expect(input).toEqual(snapshot);
    });

    it('recognizes "rest" as a survive-aligned tag', () => {
        const ranked = rankCandidateGoals(
            [
                { id: 'farm-gp', tags: ['gp'] },
                { id: 'take-rest', tags: ['rest'] },
            ],
            ctxOf({ ap: 5, apFloor: 10 }),
        );
        expect(ranked[0]?.id).toBe('take-rest');
    });

    it('recognizes "trade" as an earn-aligned tag', () => {
        const ranked = rankCandidateGoals(
            [
                { id: 'pursue-soul', tags: ['pursue'] },
                { id: 'broker-trade', tags: ['trade'] },
            ],
            ctxOf({ ap: 100, apFloor: 10, gpEstimate: 0, hasActiveGoal: true }),
        );
        expect(ranked[0]?.id).toBe('broker-trade');
    });

    it('treats unknown tags as neutral (same as untagged)', () => {
        const ranked = rankCandidateGoals(
            [{ id: 'has-aligned', tags: ['eat'] }, { id: 'unknown-tag', tags: ['flibbertigibbet', 'zorp'] }, { id: 'no-tags' }],
            ctxOf({ ap: 0, apFloor: 10 }),
        );
        expect(ranked[0]?.id).toBe('has-aligned');
        // unknown-tag and no-tags both score neutral 0 and keep input order.
        expect(ranked[1]?.id).toBe('unknown-tag');
        expect(ranked[2]?.id).toBe('no-tags');
    });

    it('recognizes "attention" as a survive-aligned tag (AP-life-force vocabulary)', () => {
        const ranked = rankCandidateGoals(
            [
                { id: 'quest', tags: ['pursue'] },
                { id: 'beg-attention', tags: ['attention'] },
            ],
            ctxOf({ ap: 5, apFloor: 10 }),
        );
        expect(ranked[0]?.id).toBe('beg-attention');
    });
});

// ---- orientation bias (S-GOAL-1) ---------------------------------------

describe('rankCandidateGoals — orientation bias (S-GOAL-1)', () => {
    // The orientation bias is the soul-level "north star" lever. When a
    // candidate either (a) matches the orientation's `id` or (b) shares its
    // `tier`, the ranker awards ORIENTATION_ALIGNED_SCORE on top of the
    // normal tier-alignment score. The bonus is intentionally smaller than
    // the survive-tier bonus so SURVIVE always wins when in survive band.

    it('orientation id-match wins a tie between two equally aligned candidates', () => {
        // Both candidates are pursue-tagged so both score ALIGNED at the
        // pursue tier. With an orientation pointing at 'master-woodcutting',
        // the matching id should win even though the other entry was
        // listed first (stable-sort tie-break would otherwise pick it).
        const ctx = ctxOf({ ap: 100, apFloor: 10, gpEstimate: 1000, hasActiveGoal: true });
        const ranked = rankCandidateGoals(
            [
                { id: 'finish-quest', tags: ['pursue'] },
                { id: 'master-woodcutting', tags: ['pursue'] },
            ],
            ctx,
            { orientation: { id: 'master-woodcutting', description: 'be a woodcutter', tier: 'pursue' } },
        );
        expect(ranked[0]?.id).toBe('master-woodcutting');
    });

    it('orientation tier-match bumps same-tier candidates above different-tier candidates that would otherwise tie', () => {
        // No tagged candidates win the pursue alignment, so all score
        // neutral. The orientation { tier: 'pursue' } should bias the
        // pursue-tagged candidate up.
        const ctx = ctxOf({ ap: 100, apFloor: 10, gpEstimate: 1000, hasActiveGoal: true });
        const ranked = rankCandidateGoals(
            [
                { id: 'wander', tags: ['reflect'] },
                { id: 'finish-quest', tags: ['pursue'] },
            ],
            ctx,
            { orientation: { id: 'something-else', description: 'unrelated id', tier: 'pursue' } },
        );
        expect(ranked[0]?.id).toBe('finish-quest');
    });

    it('survive overrides orientation: a survive-tagged goal still wins in survive band', () => {
        // Even with a pursue orientation, AP at the floor flips currentTier
        // to 'survive' and the survive-tagged goal must win. The orientation
        // bonus (smaller than tier alignment) cannot leapfrog survive.
        const ctx = ctxOf({ ap: 5, apFloor: 10, gpEstimate: 1000, hasActiveGoal: true });
        const ranked = rankCandidateGoals(
            [
                { id: 'master-woodcutting', tags: ['pursue'] },
                { id: 'eat-shrimp', tags: ['survive', 'eat'] },
            ],
            ctx,
            { orientation: { id: 'master-woodcutting', description: 'be a woodcutter', tier: 'pursue' } },
        );
        expect(ranked[0]?.id).toBe('eat-shrimp');
    });

    it('no orientation → behavior unchanged (back-compat with F3 wiring)', () => {
        // Without an orientation, the ranker output must be byte-equivalent
        // to the un-orientation call. This guards every existing call site.
        const ctx = ctxOf({ ap: 100, apFloor: 10, gpEstimate: 1000, hasActiveGoal: true });
        const goals = [
            { id: 'pursue-quest', tags: ['pursue'] },
            { id: 'sell-logs', tags: ['gp', 'earn'] },
        ];
        const without = rankCandidateGoals(goals, ctx);
        const withEmpty = rankCandidateGoals(goals, ctx, {});
        const withUndefined = rankCandidateGoals(goals, ctx, { orientation: undefined });
        expect(withEmpty).toEqual(without);
        expect(withUndefined).toEqual(without);
    });

    it('orientation with no tier still applies id-match bonus', () => {
        // tier is optional; if omitted only the id-match path can bias.
        const ctx = ctxOf({ ap: 100, apFloor: 10, gpEstimate: 1000, hasActiveGoal: true });
        const ranked = rankCandidateGoals(
            [
                { id: 'finish-quest', tags: ['pursue'] },
                { id: 'master-woodcutting', tags: ['pursue'] },
            ],
            ctx,
            { orientation: { id: 'master-woodcutting', description: 'be a woodcutter' } },
        );
        expect(ranked[0]?.id).toBe('master-woodcutting');
    });

    it('orientation bonus is smaller than tier-alignment bonus (does not flip alignment ranking)', () => {
        // Aligned-with-current-tier should still beat misaligned-but-oriented.
        // In pursue tier: pursue-tagged + no-orientation > earn-tagged + orientation.
        const ctx = ctxOf({ ap: 100, apFloor: 10, gpEstimate: 1000, hasActiveGoal: true });
        const ranked = rankCandidateGoals(
            [
                { id: 'sell-logs', tags: ['gp', 'earn'] },
                { id: 'finish-quest', tags: ['pursue'] },
            ],
            ctx,
            { orientation: { id: 'sell-logs', description: 'earn things', tier: 'earn' } },
        );
        // finish-quest scores ALIGNED (pursue). sell-logs scores MISALIGNED
        // + ORIENTATION_ALIGNED — but ALIGNED > MISALIGNED+ORIENTATION.
        expect(ranked[0]?.id).toBe('finish-quest');
    });
});
