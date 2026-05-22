/**
 * Tests for the RuneScape Brain planner helpers extracted from the monolith
 * hybrid-agent-thinking-module.ts (Plan R-δ). Each describe block targets one
 * extracted helper; the fixtures double as behavioral documentation of the
 * move-verbatim contract.
 */

import {
    brainCompletionSchema,
    brainGoalSchema,
    goalId,
    parseBrainCompletion,
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
        const result = parseBrainCompletion(
            '{"goal":{"id":"make-fire","description":"Light a fire."},"say":"On it."}',
        );
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
