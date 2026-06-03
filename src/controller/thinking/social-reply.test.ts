import { isAddressedByName, messageAfterName, buildReplyContext, FOLLOW_UP_WINDOW_TICKS } from './social-reply';
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
