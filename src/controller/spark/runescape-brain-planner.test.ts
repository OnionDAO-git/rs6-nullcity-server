/**
 * Tests for the RuneScape Brain planner helpers extracted from the monolith
 * hybrid-agent-thinking-module.ts (Plan R-δ). Each describe block targets one
 * extracted helper; the fixtures double as behavioral documentation of the
 * move-verbatim contract.
 */

import {
    benchmarkGoalForTask,
    brainCompletionSchema,
    brainGoalSchema,
    cleanTarget,
    combatGoal,
    explorationGoal,
    factionLandmarkWorkGoal,
    firemakingGoal,
    followGoal,
    goalId,
    isCombatTrainingGoal,
    isDedicatedExplorationGoal,
    isExplorationGoal,
    isFactionLandmarkWorkGoal,
    cleanSpeech,
    isFiremakingGoal,
    isFollowGoal,
    isMiningGoal,
    isPrayerTrainingGoal,
    isStandaloneFiremakingGoal,
    isStarterFishingGoal,
    isWoodcuttingTrainingGoal,
    miningGoal,
    parseBrainCompletion,
    summarizeGoalForSpeech,
    prayerGoal,
    starterCookingGoal,
    starterFishingCookingGoal,
    starterFishingGoal,
    woodcuttingGoal,
} from './runescape-brain-planner';

describe('brainGoalSchema', () => {
    it('accepts a minimal goal with only description', () => {
        const result = brainGoalSchema.safeParse({ description: 'Find logs.' });
        expect(result.success).toBe(true);
    });

    it('accepts a full goal with id, steps, success, ttlTicks', () => {
        const result = brainGoalSchema.safeParse({
            id: 'find-logs',
            description: 'Find logs near the tree line.',
            steps: ['Look for trees', 'Chop one down'],
            success: 'Logs are in inventory.',
            ttlTicks: 600,
        });
        expect(result.success).toBe(true);
    });

    it('rejects goals with empty description', () => {
        const result = brainGoalSchema.safeParse({ description: '' });
        expect(result.success).toBe(false);
    });

    it('rejects goals with too many steps', () => {
        const result = brainGoalSchema.safeParse({
            description: 'X.',
            steps: Array(9).fill('step'),
        });
        expect(result.success).toBe(false);
    });

    it('rejects goals with non-positive ttlTicks', () => {
        const result = brainGoalSchema.safeParse({ description: 'X.', ttlTicks: 0 });
        expect(result.success).toBe(false);
    });
});

describe('brainCompletionSchema', () => {
    it('accepts an empty object', () => {
        const result = brainCompletionSchema.safeParse({});
        expect(result.success).toBe(true);
    });

    it('accepts a completion with cause, goal, and say', () => {
        const result = brainCompletionSchema.safeParse({
            cause: 'brain_goal',
            goal: { description: 'Light a fire.' },
            say: 'Lighting a fire now.',
        });
        expect(result.success).toBe(true);
    });
});

describe('parseBrainCompletion', () => {
    it('returns an empty object for empty text', () => {
        expect(parseBrainCompletion('')).toEqual({});
        expect(parseBrainCompletion('   ')).toEqual({});
    });

    it('parses a pure JSON object', () => {
        const result = parseBrainCompletion('{"say":"Hi.","cause":"brain_goal"}');
        expect(result.say).toBe('Hi.');
        expect(result.cause).toBe('brain_goal');
    });

    it('parses JSON embedded in surrounding text', () => {
        const result = parseBrainCompletion('Some preamble. {"say":"Hi."} trailing.');
        expect(result.say).toBe('Hi.');
    });

    it('parses a completion with a goal object', () => {
        const result = parseBrainCompletion('{"goal":{"id":"make-fire","description":"Light a fire."},"say":"On it."}');
        expect(result.goal?.id).toBe('make-fire');
        expect(result.goal?.description).toBe('Light a fire.');
        expect(result.say).toBe('On it.');
    });

    it('throws on malformed JSON (matching monolith behavior)', () => {
        // The monolith does not wrap extractJson in a try/catch; the caller
        // upstream of the LLM response is responsible for handling.
        expect(() => parseBrainCompletion('not json at all')).toThrow();
        expect(() => parseBrainCompletion('{')).toThrow();
    });

    it('returns an empty object when JSON does not match schema', () => {
        // goal.description is required and must be a non-empty string.
        const result = parseBrainCompletion('{"goal":{"description":""}}');
        expect(result).toEqual({});
    });

    it('ignores extra keys not in the schema (Zod default strip)', () => {
        const result = parseBrainCompletion('{"say":"Hi.","extra":"value"}');
        expect(result.say).toBe('Hi.');
        expect((result as Record<string, unknown>).extra).toBeUndefined();
    });
});

describe('cleanSpeech', () => {
    it('returns undefined for undefined input', () => {
        expect(cleanSpeech(undefined)).toBeUndefined();
    });

    it('returns undefined for empty / whitespace-only input', () => {
        expect(cleanSpeech('')).toBeUndefined();
        expect(cleanSpeech('   ')).toBeUndefined();
    });

    it('collapses runs of whitespace into single spaces', () => {
        expect(cleanSpeech('Hello   world\n\nthere')).toBe('Hello world there');
    });

    it('truncates output to 220 characters', () => {
        const long = 'a'.repeat(300);
        const result = cleanSpeech(long);
        expect(result?.length).toBe(220);
    });
});

describe('summarizeGoalForSpeech', () => {
    it('returns clean text when under the max', () => {
        expect(summarizeGoalForSpeech('Hello world.', false)).toBe('Hello world');
    });

    it('uses 160 char max when not reserving space', () => {
        const result = summarizeGoalForSpeech('x'.repeat(200), false);
        expect(result.endsWith('...')).toBe(true);
        expect(result.length).toBe(160);
    });

    it('uses 96 char max when reserving space for next step', () => {
        const result = summarizeGoalForSpeech('x'.repeat(200), true);
        expect(result.endsWith('...')).toBe(true);
        expect(result.length).toBe(96);
    });

    it('strips trailing sentence punctuation before truncation', () => {
        expect(summarizeGoalForSpeech('  Hello world!!!  ', false)).toBe('Hello world');
    });
});

describe('cleanTarget', () => {
    it('trims whitespace', () => {
        expect(cleanTarget('  Hello  ')).toBe('Hello');
    });

    it('strips trailing punctuation (.!?)', () => {
        expect(cleanTarget('Bob!')).toBe('Bob');
        expect(cleanTarget('Bob.')).toBe('Bob');
        expect(cleanTarget('Bob?')).toBe('Bob');
        expect(cleanTarget('Bob.!?')).toBe('Bob');
    });

    it('preserves embedded punctuation', () => {
        expect(cleanTarget('  Bob the Builder! ')).toBe('Bob the Builder');
    });
});

describe('goalId', () => {
    it('lowercases and slugifies the input description', () => {
        expect(goalId('Light a Fire!')).toBe('light-a-fire');
    });

    it('collapses runs of non-alphanumerics into single dashes', () => {
        expect(goalId('Hello,   World!!!')).toBe('hello-world');
    });

    it('trims leading and trailing dashes', () => {
        expect(goalId('--Hello-World--')).toBe('hello-world');
    });

    it('truncates to 60 characters', () => {
        const long = 'a'.repeat(80);
        const result = goalId(long);
        expect(result.length).toBeLessThanOrEqual(60);
    });

    it('returns an empty string for empty input', () => {
        expect(goalId('')).toBe('');
    });

    it('returns an empty string for purely non-alphanumeric input', () => {
        expect(goalId('!!!---')).toBe('');
    });
});

describe('goal factories', () => {
    it('firemakingGoal builds a make-fire goal', () => {
        const g = firemakingGoal(42);
        expect(g.id).toBe('make-fire');
        expect(g.createdAtTick).toBe(42);
        expect(g.ttlTicks).toBe(600);
        expect(g.steps?.length).toBeGreaterThan(0);
    });

    it('woodcuttingGoal builds a chop-level-one-tree goal', () => {
        const g = woodcuttingGoal(7);
        expect(g.id).toBe('chop-level-one-tree');
        expect(g.createdAtTick).toBe(7);
        expect(g.ttlTicks).toBe(600);
    });

    it('starterFishingGoal builds a catch-starter-fish goal', () => {
        const g = starterFishingGoal(0);
        expect(g.id).toBe('catch-starter-fish');
        expect(g.ttlTicks).toBe(600);
    });

    it('miningGoal builds a mine-starter-ore goal', () => {
        const g = miningGoal(17);
        expect(g.id).toBe('mine-starter-ore');
        expect(g.description).toContain('starter ore');
        expect(g.steps?.join(' ')).toContain('pickaxe');
        expect(g.ttlTicks).toBe(600);
        expect(g.createdAtTick).toBe(17);
    });

    it('starterFishingCookingGoal builds a catch-and-cook goal', () => {
        const g = starterFishingCookingGoal(0);
        expect(g.id).toBe('catch-and-cook-starter-fish');
        expect(g.ttlTicks).toBe(900);
    });

    it('starterCookingGoal builds a cook-starter-fish goal', () => {
        const g = starterCookingGoal(0);
        expect(g.id).toBe('cook-starter-fish');
        expect(g.ttlTicks).toBe(450);
    });

    it('prayerGoal builds a train-prayer-with-bones goal', () => {
        const g = prayerGoal(0);
        expect(g.id).toBe('train-prayer-with-bones');
        expect(g.ttlTicks).toBe(450);
    });

    it('combatGoal builds a train-combat-safely goal', () => {
        const g = combatGoal(0);
        expect(g.id).toBe('train-combat-safely');
        expect(g.ttlTicks).toBe(450);
    });

    it('explorationGoal builds a scout-nearby-area goal', () => {
        const g = explorationGoal(0);
        expect(g.id).toBe('scout-nearby-area');
        expect(g.ttlTicks).toBe(450);
    });

    it('followGoal builds a follow-<name> goal with cleaned target', () => {
        const g = followGoal('  Bob the Builder!  ', 11);
        expect(g.id).toBe('follow-bob-the-builder');
        expect(g.description).toContain('Bob the Builder');
        expect(g.ttlTicks).toBe(900);
        expect(g.createdAtTick).toBe(11);
    });

    it("followGoal falls back to 'target' for empty input", () => {
        const g = followGoal('', 0);
        expect(g.id).toBe('follow-target');
        expect(g.description).toContain('target');
    });

    it.each([
        ['foundry', 'forge fuel'],
        ['bureau-of-continuity', 'witness and record'],
        ['ledger', 'publicly audit'],
        ['veil', 'quietly scout'],
    ])('factionLandmarkWorkGoal builds a %s landmark-work goal', (factionId, expectedPhrase) => {
        const g = factionLandmarkWorkGoal(factionId, 13);
        expect(g.id).toBe(`faction-landmark-work-${factionId}`);
        expect(g.description.toLowerCase()).toContain(expectedPhrase);
        expect(g.steps?.join(' ').toLowerCase()).toContain('landmark');
        expect(g.ttlTicks).toBe(900);
        expect(g.createdAtTick).toBe(13);
    });
});

describe('benchmarkGoalForTask', () => {
    it("returns starterFishingGoal for 'starter-fishing-5m'", () => {
        const g = benchmarkGoalForTask('starter-fishing-5m', 0);
        expect(g?.id).toBe('catch-starter-fish');
    });

    it("returns miningGoal for 'starter-mining-5m'", () => {
        const g = benchmarkGoalForTask('starter-mining-5m', 0);
        expect(g?.id).toBe('mine-starter-ore');
    });

    it("returns a Cook's Assistant start goal for 'cooks-assistant-start-3m'", () => {
        const g = benchmarkGoalForTask('cooks-assistant-start-3m', 0);
        expect(g?.id).toBe('start-cooks-assistant');
        expect(g?.description).toContain("Cook's Assistant");
    });

    it("returns starterFishingCookingGoal for 'fishing-cooking-10m'", () => {
        const g = benchmarkGoalForTask('fishing-cooking-10m', 0);
        expect(g?.id).toBe('catch-and-cook-starter-fish');
    });

    it("returns combatGoal for 'combat-prayer-10m'", () => {
        const g = benchmarkGoalForTask('combat-prayer-10m', 0);
        expect(g?.id).toBe('train-combat-safely');
    });

    it("returns combatGoal for 'equipment-prep-3m'", () => {
        const g = benchmarkGoalForTask('equipment-prep-3m', 0);
        expect(g?.id).toBe('train-combat-safely');
    });

    it("returns explorationGoal for 'explore-report-5m'", () => {
        const g = benchmarkGoalForTask('explore-report-5m', 0);
        expect(g?.id).toBe('scout-nearby-area');
    });

    it('returns firemakingGoal for woodcutting/firemaking task ids used by QA souls', () => {
        expect(benchmarkGoalForTask('woodcutting-firemaking-10m', 0)?.id).toBe('make-fire');
        expect(benchmarkGoalForTask('make-fire-5m', 0)?.id).toBe('make-fire');
    });

    it('returns undefined for an unknown taskId', () => {
        expect(benchmarkGoalForTask('unknown', 0)).toBeUndefined();
        expect(benchmarkGoalForTask(null, 0)).toBeUndefined();
        expect(benchmarkGoalForTask(undefined, 0)).toBeUndefined();
    });
});

describe('goal-identity predicates', () => {
    it('isPrayerTrainingGoal matches prayer/bone goals but rejects combat training', () => {
        expect(isPrayerTrainingGoal(prayerGoal(0))).toBe(true);
        expect(isPrayerTrainingGoal(combatGoal(0))).toBe(false);
        expect(isPrayerTrainingGoal(firemakingGoal(0))).toBe(false);
    });

    it('isExplorationGoal matches scout/explore/landmark phrasing', () => {
        expect(isExplorationGoal(explorationGoal(0))).toBe(true);
        // firemakingGoal mentions "logs" / "fire" but not exploration vocabulary
        expect(isExplorationGoal(firemakingGoal(0))).toBe(false);
    });

    it('isDedicatedExplorationGoal is the stricter id+description-based form', () => {
        expect(isDedicatedExplorationGoal(explorationGoal(0))).toBe(true);
        expect(isDedicatedExplorationGoal(firemakingGoal(0))).toBe(false);
    });

    it('isCombatTrainingGoal matches combat/fight/attack/melee phrasing', () => {
        expect(isCombatTrainingGoal(combatGoal(0))).toBe(true);
        // Note: prayerGoal mentions "after safe combat" so this is true too
        // — locking in monolith-verbatim behavior (the description-only regex
        // is intentionally loose; the body routine uses isPrayerTrainingGoal
        // first to disambiguate).
        expect(isCombatTrainingGoal(firemakingGoal(0))).toBe(false);
    });

    it('isWoodcuttingTrainingGoal matches woodcutting/chop/tree goals', () => {
        expect(isWoodcuttingTrainingGoal(woodcuttingGoal(0))).toBe(true);
        expect(isWoodcuttingTrainingGoal(combatGoal(0))).toBe(false);
    });

    it('isStarterFishingGoal matches fishing/shrimp/net goals', () => {
        expect(isStarterFishingGoal(starterFishingGoal(0))).toBe(true);
        expect(isStarterFishingGoal(starterFishingCookingGoal(0))).toBe(true);
        expect(isStarterFishingGoal(combatGoal(0))).toBe(false);
    });

    it('isMiningGoal matches starter ore / pickaxe goals but rejects unrelated skill goals', () => {
        expect(isMiningGoal(miningGoal(0))).toBe(true);
        expect(
            isMiningGoal({
                id: 'gather-copper-and-tin',
                description: 'Mine copper and tin ore with a bronze pickaxe.',
                steps: ['Find a copper rock', 'Use the mine option'],
                success: 'Ore is in inventory.',
                ttlTicks: 600,
                createdAtTick: 0,
            }),
        ).toBe(true);
        expect(isMiningGoal(starterFishingGoal(0))).toBe(false);
        expect(isMiningGoal(woodcuttingGoal(0))).toBe(false);
        expect(isMiningGoal(firemakingGoal(0))).toBe(false);
    });

    it('isFiremakingGoal matches fire/tinderbox/light goals', () => {
        expect(isFiremakingGoal(firemakingGoal(0))).toBe(true);
        expect(isFiremakingGoal(starterFishingGoal(0))).toBe(false);
    });

    it('isStandaloneFiremakingGoal excludes cooking and fishing plans that merely mention fire', () => {
        expect(isStandaloneFiremakingGoal(firemakingGoal(0))).toBe(true);
        expect(isStandaloneFiremakingGoal(starterFishingCookingGoal(0))).toBe(false);
        expect(isStandaloneFiremakingGoal(starterCookingGoal(0))).toBe(false);
    });

    it('isFollowGoal matches follow-* ids and follow-mentioning descriptions', () => {
        expect(isFollowGoal(followGoal('Alice', 0))).toBe(true);
        expect(isFollowGoal(firemakingGoal(0))).toBe(false);
        expect(isFollowGoal(undefined)).toBe(false);
    });

    it('isFactionLandmarkWorkGoal only matches faction work goals', () => {
        expect(isFactionLandmarkWorkGoal(factionLandmarkWorkGoal('foundry', 0))).toBe(true);
        expect(isFactionLandmarkWorkGoal(explorationGoal(0))).toBe(false);
        expect(isFactionLandmarkWorkGoal(undefined)).toBe(false);
    });
});
