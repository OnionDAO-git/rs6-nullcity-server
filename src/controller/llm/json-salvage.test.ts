import { z } from 'zod';
import { stripThinkBlocks, salvageJsonCandidates, parseJsonWithSalvage, type SalvageClassification } from './json-salvage';

describe('stripThinkBlocks', () => {
    it('removes a closed think block', () => {
        expect(stripThinkBlocks('<think>reasoning</think>{"a":1}').trim()).toBe('{"a":1}');
    });

    it('removes a think block even when it contains braces', () => {
        expect(stripThinkBlocks('<think>maybe {"goal":"x"} or not</think>\n{"say":"hi"}').trim()).toBe('{"say":"hi"}');
    });

    it('is case-insensitive and multi-block', () => {
        expect(stripThinkBlocks('<THINK>a</THINK>x<think>b</think>y').trim()).toBe('xy');
    });

    it('drops everything from an unclosed trailing <think> onward', () => {
        expect(stripThinkBlocks('{"say":"hi"}\n<think>I should also consider').trim()).toBe('{"say":"hi"}');
    });

    it('returns empty when the whole completion is an unclosed think', () => {
        expect(stripThinkBlocks('<think>still reasoning with no answer yet').trim()).toBe('');
    });

    it('leaves plain text untouched', () => {
        expect(stripThinkBlocks('{"say":"hi"}')).toBe('{"say":"hi"}');
    });
});

describe('salvageJsonCandidates', () => {
    it('returns the whole object for clean JSON', () => {
        expect(salvageJsonCandidates('{"a":1}')).toEqual(['{"a":1}']);
    });

    it('extracts a single balanced object embedded in prose', () => {
        expect(salvageJsonCandidates('Sure! {"goal":{"description":"fish"}} done')).toEqual(['{"goal":{"description":"fish"}}']);
    });

    it('does not over-consume when prose after the object also has a brace', () => {
        // greedy first-{-to-last-} would grab the trailing "{ note }"; balanced stops at the first object
        const got = salvageJsonCandidates('{"say":"hi"} and then a stray { note }');
        expect(got[0]).toBe('{"say":"hi"}');
    });

    it('respects braces inside quoted strings', () => {
        expect(salvageJsonCandidates('{"say":"use {curly} braces"}')).toEqual(['{"say":"use {curly} braces"}']);
    });

    it('respects escaped quotes inside strings', () => {
        expect(salvageJsonCandidates('{"say":"he said \\"hi\\" }"}')).toEqual(['{"say":"he said \\"hi\\" }"}']);
    });

    it('returns multiple candidates when several objects are present', () => {
        const got = salvageJsonCandidates('{"a":1} text {"b":2}');
        expect(got).toEqual(['{"a":1}', '{"b":2}']);
    });

    it('extracts from a ```json fenced block first', () => {
        const got = salvageJsonCandidates('```json\n{"say":"hi"}\n```');
        expect(got).toEqual(['{"say":"hi"}']);
    });

    it('extracts from a bare ``` fenced block', () => {
        const got = salvageJsonCandidates('```\n{"say":"hi"}\n```');
        expect(got).toEqual(['{"say":"hi"}']);
    });

    it('strips think blocks before extracting', () => {
        const got = salvageJsonCandidates('<think>maybe {"wrong":1}</think>{"say":"right"}');
        expect(got).toEqual(['{"say":"right"}']);
    });

    it('returns no candidates for empty or think-only input', () => {
        expect(salvageJsonCandidates('')).toEqual([]);
        expect(salvageJsonCandidates('<think>no answer yet')).toEqual([]);
    });
});

const schema = z.object({ say: z.string().optional(), goal: z.object({ description: z.string().min(1) }).optional() });

function classOf(text: string): SalvageClassification {
    return parseJsonWithSalvage(text, schema).classification;
}

describe('parseJsonWithSalvage', () => {
    it('classifies clean JSON as clean', () => {
        const r = parseJsonWithSalvage('{"say":"hi"}', schema);
        expect(r.value).toEqual({ say: 'hi' });
        expect(r.classification).toBe('clean');
    });

    it('classifies whitespace/empty as truly_empty', () => {
        expect(classOf('')).toBe('truly_empty');
        expect(classOf('   \n  ')).toBe('truly_empty');
    });

    it('recovers JSON after stripping a think block', () => {
        const r = parseJsonWithSalvage('<think>reasoning with { braces }</think>\n{"say":"hi"}', schema);
        expect(r.value).toEqual({ say: 'hi' });
        expect(r.classification).toBe('recovered_after_think_strip');
    });

    it('classifies an unclosed think with no answer as think_only_no_answer', () => {
        const r = parseJsonWithSalvage('<think>I am still reasoning and never closed', schema);
        expect(r.value).toBeUndefined();
        expect(r.classification).toBe('think_only_no_answer');
    });

    it('classifies a closed think with no JSON after it as think_only_no_answer', () => {
        const r = parseJsonWithSalvage('<think>done thinking, no json</think>   ', schema);
        expect(r.value).toBeUndefined();
        expect(r.classification).toBe('think_only_no_answer');
    });

    it('recovers JSON from a fenced block', () => {
        const r = parseJsonWithSalvage('```json\n{"say":"hi"}\n```', schema);
        expect(r.value).toEqual({ say: 'hi' });
        expect(r.classification).toBe('recovered_from_fence');
    });

    it('recovers JSON embedded in prose (balanced brace)', () => {
        const r = parseJsonWithSalvage('Sure! {"goal":{"description":"fish"}}', schema);
        expect(r.value).toEqual({ goal: { description: 'fish' } });
        expect(r.classification).toBe('recovered_after_think_strip');
    });

    it('recovers JSON with a trailing comma via lenient reparse', () => {
        const r = parseJsonWithSalvage('{"say":"hi",}', schema);
        expect(r.value).toEqual({ say: 'hi' });
        expect(r.classification).toBe('recovered_trailing_comma');
    });

    it('classifies valid JSON of the wrong shape as schema_mismatch', () => {
        const strict = z.object({ say: z.string() });
        const r = parseJsonWithSalvage('{"foo":1}', strict);
        expect(r.value).toBeUndefined();
        expect(r.classification).toBe('schema_mismatch');
    });

    it('tries each candidate until one validates', () => {
        const strict = z.object({ say: z.string() });
        // first object is wrong shape, second validates
        const r = parseJsonWithSalvage('{"foo":1} then {"say":"ok"}', strict);
        expect(r.value).toEqual({ say: 'ok' });
    });
});
