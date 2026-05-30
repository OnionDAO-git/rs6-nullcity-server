/**
 * Resident needs-hierarchy ranker (packet S-SMART-NEEDS).
 *
 * Encodes the CIC-meetup "Goal And Intelligence Direction" hierarchy
 * (`docs/2026-05-29-cic-meetup-decisions.md`):
 *
 *   1. SURVIVE — keep AP above the floor.
 *   2. EARN    — earn/preserve GP so the resident can trade for AP.
 *   3. PURSUE  — work the Soul goal.
 *   4. REFLECT — write useful discoveries to the Library.
 *
 * This module is intentionally pure: same input -> same output, no I/O, no
 * randomness, no clocks. The Brain planner (or a future autonomous selector)
 * passes a `ResidentNeedsContext` snapshot and a candidate-goal list, gets
 * back a re-ordered list tagged with the active need tier. No LLM call is
 * involved; this is the rules-based "what should I be thinking about right
 * now?" lever that the Brain prompts and the goal-selection seam can both
 * use.
 *
 * Vocabulary aligns with the `nullcity-needs-hierarchy` /
 * `nullcity-ap-lifeforce` knowledge entries (see
 * `src/controller/knowledge/knowledge-retriever.ts`) so prompts and ranker
 * tell the same story.
 */

export type NeedsTier = 'survive' | 'earn' | 'pursue' | 'reflect';

/**
 * Read-only snapshot of the resident's economic state used to pick a tier.
 *
 * - `ap` / `apFloor` mirror `ApLedger.balance()` and the resident's
 *   life-force floor (the level at which fade is imminent). When `ap` sits
 *   within `AP_SURVIVE_BUFFER` of the floor the resident is treated as
 *   needing to survive, not pursue.
 * - `gpEstimate` is the best-known GP balance (real RuneScape coins, item
 *   `995`). It is an estimate because GP comes from live game state which
 *   the brain doesn't always have a fresh snapshot of.
 * - `hasActiveGoal` distinguishes "I have a Soul goal in flight" from
 *   "I'm idling" — the latter pushes the resident back into EARN even when
 *   everything is healthy, to avoid the dead-money idle case.
 */
export interface ResidentNeedsContext {
    ap: number;
    apFloor: number;
    gpEstimate: number;
    hasActiveGoal: boolean;
}

/**
 * AP buffer above the floor that still counts as "survive". Justification:
 * AP decays each tick (see `ApLedger`'s `decay` events) and a single decay
 * step can move the balance by several points. A buffer of 5 gives the
 * planner enough room to choose a survive-aligned action *before* the next
 * decay tick pushes the resident across the floor, rather than reacting
 * after fade. Tuned conservatively — better to misfire 'survive' once and
 * generate a low-AP appeal than to fade silently. If we ever expose
 * per-soul decay rates we should derive this from the decay curve instead
 * of hard-coding.
 */
export const AP_SURVIVE_BUFFER = 5;

/**
 * GP balance considered "healthy" for tier purposes. Justification: the
 * weekend sprint's flagship aspirational goal is "find a reliable way to
 * make 100 GP/hour and write the strategy into the Library" (see
 * `docs/2026-05-29-cic-meetup-decisions.md` and the
 * `ap-gp-library-strategy` benchmark task). 100 is the smallest round
 * number that signals "this resident is not broke and can credibly trade
 * GP for AP through the AP-for-GP exchange (S3a)". Below this the planner
 * should keep the resident in EARN. Above this the planner is free to
 * pursue the Soul goal. Deliberately chosen low so first-generation
 * residents can leave EARN without grinding for hours.
 */
export const GP_HEALTHY_THRESHOLD = 100;

/**
 * Determine the active needs tier from a snapshot of the resident's state.
 * Pure: same input -> same output.
 *
 *   SURVIVE  ap <= apFloor + AP_SURVIVE_BUFFER
 *   EARN     ap healthy AND (gpEstimate < GP_HEALTHY_THRESHOLD OR
 *                            (gpEstimate < threshold AND no active goal) OR
 *                            no GP AND no active goal)
 *   PURSUE   ap + gp healthy AND hasActiveGoal
 *   REFLECT  otherwise (healthy + idle with money)
 */
export function currentTier(ctx: ResidentNeedsContext): NeedsTier {
    if (ctx.ap <= ctx.apFloor + AP_SURVIVE_BUFFER) {
        return 'survive';
    }
    if (ctx.gpEstimate < GP_HEALTHY_THRESHOLD) {
        return 'earn';
    }
    // Healthy AP + healthy GP. Idle residents should still hunt for GP rather
    // than reflect — but the spec calls this REFLECT only when the resident
    // *has nothing else to do AND has money*. We keep that distinction.
    if (ctx.hasActiveGoal) {
        return 'pursue';
    }
    return 'reflect';
}

/**
 * A candidate goal seen by the ranker. `tags` is the only signal — the
 * ranker does not interpret `id`. Tags align with the four tiers; common
 * tag vocabulary:
 *   survive : 'survive', 'ap', 'attention', 'rest', 'eat', 'food', 'heal'
 *   earn    : 'gp', 'earn', 'trade', 'sell', 'farm', 'coin'
 *   pursue  : 'pursue', 'goal', 'soul', 'quest'
 *   reflect : 'reflect', 'library', 'write', 'memo', 'note'
 *
 * Untagged goals receive a neutral score so they sort below tier-aligned
 * goals but above misaligned goals.
 */
export interface GoalCandidate {
    id: string;
    tags?: ReadonlyArray<string>;
}

export interface RankedGoal {
    id: string;
    tier: NeedsTier;
    score: number;
}

const TIER_TAGS: Record<NeedsTier, ReadonlyArray<string>> = {
    survive: ['survive', 'ap', 'attention', 'rest', 'eat', 'food', 'heal'],
    earn: ['gp', 'earn', 'trade', 'sell', 'farm', 'coin'],
    pursue: ['pursue', 'goal', 'soul', 'quest'],
    reflect: ['reflect', 'library', 'write', 'memo', 'note'],
};

const ALIGNED_SCORE = 10;
const NEUTRAL_SCORE = 0;
const MISALIGNED_PENALTY = -1;

/**
 * Score a single candidate against the active tier. Aligned tags get the
 * full alignment score, untagged goals get the neutral score, and tags
 * matching a *different* tier get a small penalty so survive-tagged goals
 * still beat pursue-tagged goals when in 'survive'.
 */
function scoreGoal(goal: GoalCandidate, tier: NeedsTier): number {
    const tags = goal.tags ?? [];
    if (tags.length === 0) {
        return NEUTRAL_SCORE;
    }
    const aligned = TIER_TAGS[tier];
    let score = 0;
    let matched = false;
    let misaligned = false;
    for (const tag of tags) {
        const lower = tag.toLowerCase();
        if (aligned.includes(lower)) {
            score += ALIGNED_SCORE;
            matched = true;
            continue;
        }
        // Tag belongs to some other tier?
        for (const otherTier of Object.keys(TIER_TAGS) as NeedsTier[]) {
            if (otherTier === tier) continue;
            if (TIER_TAGS[otherTier].includes(lower)) {
                misaligned = true;
                break;
            }
        }
    }
    if (matched) {
        return score;
    }
    if (misaligned) {
        return MISALIGNED_PENALTY;
    }
    return NEUTRAL_SCORE;
}

/**
 * Rank candidate goals against the active needs tier. Stable sort by score
 * descending (ties keep original input order). Pure: same input -> same
 * output. Does not mutate `goals`.
 */
export function rankCandidateGoals(goals: ReadonlyArray<GoalCandidate>, ctx: ResidentNeedsContext): Array<RankedGoal> {
    if (goals.length === 0) {
        return [];
    }
    const tier = currentTier(ctx);
    // Decorate with original index so we can implement a stable sort
    // independently of the JS engine's sort stability guarantees.
    const decorated = goals.map((goal, idx) => ({
        goal,
        idx,
        score: scoreGoal(goal, tier),
    }));
    decorated.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return a.idx - b.idx;
    });
    return decorated.map(entry => ({
        id: entry.goal.id,
        tier,
        score: entry.score,
    }));
}
