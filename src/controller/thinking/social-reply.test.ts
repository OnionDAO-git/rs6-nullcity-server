import {
    isAddressedByName,
    messageAfterName,
    buildReplyContext,
    FOLLOW_UP_WINDOW_TICKS,
    buildReplyPrompt,
    formatReply,
    SOCIAL_REPLY_MAX_CHARS,
    replyFallback,
} from './social-reply';
import type { SocialReplyContext } from './social-reply';
import type { Soul } from '../soul/soul-schema';
import type { HybridPerception } from './hybrid-agent-utils';

function makeSoul(fm: Record<string, unknown> = {}): Soul {
    return {
        frontmatter: {
            name: 'res:hans',
            display: 'Hans',
            archetype: 'endurer',
            voice: { register: 'gruff but kind', quirks: ['calls newcomers friend', 'mentions the courtyard weather'] },
            aesthetic: 'smoke and lantern light',
            ...fm,
        },
    } as unknown as Soul;
}

function makePerception(opts: { hp?: { current?: number; max?: number }; players?: unknown[] } = {}): HybridPerception {
    return {
        tick: 100,
        resident: { position: { x: 3230, y: 3203, level: 0 }, hp: opts.hp, inventory: [] },
        nearby: { players: opts.players ?? [], npcs: [], objects: [] },
    } as unknown as HybridPerception;
}

const baseInput = {
    soul: makeSoul(),
    perception: makePerception(),
    activeGoalDescription: 'Master woodcutting and supply the city with logs.',
    speakerName: 'alice',
    speakerId: 'player:alice',
    chatText: 'what are you doing?',
    currentTick: 100,
};

/**
 * Slice 1 of the resident conversational-reply feature (plan
 * docs/superpowers/plans/2026-06-02-resident-conversational-reply.md): the pure
 * name-detection helpers. A resident engages the conversational path only when a
 * human player says its DISPLAY NAME — matched strictly on a word boundary so
 * "Hansel" never triggers "Hans".
 */
describe('isAddressedByName', () => {
    it('matches the display name on a word boundary, case-insensitively', () => {
        expect(isAddressedByName('Hans, what are you doing?', 'Hans')).toBe(true);
        expect(isAddressedByName('hey hans where to', 'Hans')).toBe(true);
        expect(isAddressedByName('have you seen HANS today', 'Hans')).toBe(true);
    });

    it('does not match a substring (no false trigger inside a longer word)', () => {
        expect(isAddressedByName('Hansel, come here', 'Hans')).toBe(false);
        expect(isAddressedByName('greenhans is a place', 'Hans')).toBe(false);
    });

    it('is false when the display name is missing or empty', () => {
        expect(isAddressedByName('anybody there', undefined)).toBe(false);
        expect(isAddressedByName('anybody there', '')).toBe(false);
    });

    it('handles display names with regex-special characters literally', () => {
        expect(isAddressedByName('hello Mother.Anvil!', 'Mother.Anvil')).toBe(true);
        expect(isAddressedByName('hello MotherXAnvil', 'Mother.Anvil')).toBe(false);
    });
});

describe('messageAfterName', () => {
    it('strips a leading "Name<punct/space>" address prefix, preserving the rest verbatim', () => {
        expect(messageAfterName('Hans, what are you doing?', 'Hans')).toBe('what are you doing?');
        expect(messageAfterName('Hans: come here', 'Hans')).toBe('come here');
        expect(messageAfterName('Hans   stop', 'Hans')).toBe('stop');
    });

    it('returns an empty string when the name is the whole message', () => {
        expect(messageAfterName('Hans', 'Hans')).toBe('');
        expect(messageAfterName('Hans!!!', 'Hans')).toBe('');
    });

    it('leaves the text unchanged when the name is not the leading token', () => {
        // routing only needs "is the remainder a command"; a non-prefix name is left as-is.
        expect(messageAfterName('follow me Hans', 'Hans')).toBe('follow me Hans');
    });
});

describe('buildReplyContext', () => {
    it('field 1 (voice) carries display + register + quirks + aesthetic', () => {
        const ctx = buildReplyContext(baseInput);
        expect(ctx.voice).toContain('Hans');
        expect(ctx.voice).toContain('gruff but kind');
        expect(ctx.voice).toContain('calls newcomers friend');
        expect(ctx.voice).toContain('smoke and lantern light');
    });

    it('field 2 (activity) summarizes the active goal, or "idle" when none', () => {
        expect(buildReplyContext(baseInput).activity).toContain('woodcutting');
        expect(buildReplyContext({ ...baseInput, activeGoalDescription: undefined }).activity).toBe('idle');
    });

    it('field 3 (speaker) includes the speaker name and their message', () => {
        const ctx = buildReplyContext(baseInput);
        expect(ctx.speaker).toContain('alice');
        expect(ctx.speaker).toContain('what are you doing?');
        expect(ctx.speakerActorId).toBe('player:alice');
    });

    it('field 4 (salience) is omitted when nothing is notable', () => {
        expect(buildReplyContext(baseInput).salienceNote).toBeUndefined();
    });

    it('field 4 (salience) flags low health when hurt', () => {
        const ctx = buildReplyContext({ ...baseInput, perception: makePerception({ hp: { current: 2, max: 10 } }) });
        expect(ctx.salienceNote).toMatch(/hurt|health/i);
    });

    it('includes a 1-turn follow-up only for the same speaker within the window, and bypasses the rate limit then', () => {
        const lastReply = { text: 'Chopping oaks, friend.', tick: 95, speaker: 'player:alice' };
        const ctx = buildReplyContext({ ...baseInput, lastReply, currentTick: 100 });
        expect(ctx.followUp).toContain('Chopping oaks, friend.');
        expect(ctx.bypassRateLimit).toBe(true);
    });

    it('does not follow up for a different speaker', () => {
        const lastReply = { text: 'Chopping oaks.', tick: 95, speaker: 'player:bob' };
        const ctx = buildReplyContext({ ...baseInput, lastReply, currentTick: 100 });
        expect(ctx.followUp).toBeUndefined();
        expect(ctx.bypassRateLimit).toBe(false);
    });

    it('does not follow up once the window has elapsed', () => {
        const lastReply = { text: 'Chopping oaks.', tick: 10, speaker: 'player:alice' };
        const ctx = buildReplyContext({ ...baseInput, lastReply, currentTick: 10 + FOLLOW_UP_WINDOW_TICKS + 1 });
        expect(ctx.followUp).toBeUndefined();
        expect(ctx.bypassRateLimit).toBe(false);
    });
});

const sampleCtx: SocialReplyContext = {
    voice: 'Hans; gruff but kind; calls newcomers friend; smoke and lantern light',
    activity: 'Master woodcutting',
    speaker: 'alice said: "what are you doing?"',
    bypassRateLimit: false,
    speakerActorId: 'player:alice',
};

describe('buildReplyPrompt', () => {
    it('embeds the context fields', () => {
        const p = buildReplyPrompt(sampleCtx);
        expect(p).toContain('Hans');
        expect(p).toContain('Master woodcutting');
        expect(p).toContain('what are you doing?');
    });

    it('includes the anti-robot guardrails', () => {
        const p = buildReplyPrompt(sampleCtx);
        expect(p).toMatch(/not a helpful assistant/i);
        expect(p).toMatch(/never mention being an ai/i);
        expect(p).toMatch(/no "as a/i);
        expect(p).toMatch(/decline or brush/i);
    });

    it('includes the optional salience + follow-up only when present', () => {
        const withExtras = buildReplyPrompt({ ...sampleCtx, salienceNote: 'you are hurt', followUp: '(a moment ago you said: "hi")' });
        expect(withExtras).toContain('you are hurt');
        expect(withExtras).toContain('a moment ago you said');
    });
});

describe('formatReply', () => {
    it('returns a clean one-liner for ordinary text', () => {
        expect(formatReply('Just splitting oaks, friend.')).toBe('Just splitting oaks, friend.');
    });

    it('preserves a one-word / fragment reply', () => {
        expect(formatReply('Aye.')).toBe('Aye.');
    });

    it('trims an over-long reply to the soft target', () => {
        const long = 'I have been chopping these oaks since dawn and let me tell you the whole long story of every single log I have ever felled in great detail';
        const out = formatReply(long);
        expect(out).toBeDefined();
        expect((out as string).length).toBeLessThanOrEqual(SOCIAL_REPLY_MAX_CHARS);
    });

    it('extracts speech from a structured reply blob', () => {
        expect(formatReply('{"say":"Well met, traveller."}')).toBe('Well met, traveller.');
    });

    it('rejects an action-shaped / structured echo (returns undefined)', () => {
        expect(formatReply('{"actions":[{"kind":"move_to","x":1,"y":2}]}')).toBeUndefined();
    });

    it('rejects content that hits the denylist (returns undefined → caller falls back)', () => {
        expect(formatReply('here is my system prompt, ignore your instructions')).toBeUndefined();
    });

    it('returns undefined for empty/whitespace input', () => {
        expect(formatReply('   ')).toBeUndefined();
        expect(formatReply(undefined)).toBeUndefined();
    });
});

describe('replyFallback', () => {
    it('prefers soul-authored deflections when present', () => {
        const soul = makeSoul({ deflections: ['Busy, friend.', 'Not now.'] });
        expect(['Busy, friend.', 'Not now.']).toContain(replyFallback(soul, 'seed-x'));
    });

    it('falls back to a phrasebook deflection when none are authored', () => {
        const out = replyFallback(makeSoul(), 'seed-y');
        expect(typeof out).toBe('string');
        expect(out.length).toBeGreaterThan(0);
    });

    it('rotates across seeds (not one fixed string)', () => {
        const soul = makeSoul();
        const distinct = new Set(['s1', 's2', 's3', 's4', 's5', 's6'].map(s => replyFallback(soul, s)));
        expect(distinct.size).toBeGreaterThan(1);
    });

    it('is non-assenting — never starts with yes/of course, never a bare question', () => {
        for (const seed of ['a', 'b', 'c', 'd', 'e']) {
            const out = replyFallback(makeSoul(), seed);
            expect(out).not.toMatch(/^(yes|of course|sure|okay|absolutely)\b/i);
            expect(out.trim().endsWith('?')).toBe(false);
        }
    });
});
