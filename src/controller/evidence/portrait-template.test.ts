import { renderPortrait, type PortraitIndex } from './portrait-template';

describe('renderPortrait faction enrichment', () => {
    const index: PortraitIndex = {
        resident: 'res:mother-anvil',
        createdAt: '2026-05-25T14:00:00.000Z',
        updatedAt: '2026-05-25T15:00:00.000Z',
        lives: 1,
        currentState: 'living',
    };
    const timeline = [{ kind: 'say', tick: 1, ts: '2026-05-25T14:00:01.000Z', text: 'At the forge again.', lifeIndex: 1 }];

    it('populates portrait.faction display name when factionId is a known id', () => {
        const rendered = renderPortrait('res:mother-anvil', index, timeline, { factionId: 'foundry' });
        expect(rendered.portrait.faction).toBe('The Foundry');
    });

    it('includes faction in the markdown header line', () => {
        const rendered = renderPortrait('res:mother-anvil', index, timeline, { factionId: 'foundry' });
        expect(rendered.markdown).toContain('The Foundry');
    });

    it('leaves portrait.faction undefined when no factionId provided', () => {
        const rendered = renderPortrait('res:mother-anvil', index, timeline);
        expect(rendered.portrait.faction).toBeUndefined();
    });

    it('leaves portrait.faction undefined for an unknown factionId', () => {
        const rendered = renderPortrait('res:mother-anvil', index, timeline, { factionId: 'unknown-faction' });
        expect(rendered.portrait.faction).toBeUndefined();
    });

    it('renders The Veil faction correctly', () => {
        const rendered = renderPortrait('res:the-hush', index, timeline, { factionId: 'veil' });
        expect(rendered.portrait.faction).toBe('The Veil');
        expect(rendered.markdown).toContain('The Veil');
    });
});

describe('renderPortrait wants quality', () => {
    const index: PortraitIndex = {
        resident: 'res:qa-guardian',
        createdAt: '2026-05-25T03:09:13.635Z',
        updatedAt: '2026-05-25T04:09:13.635Z',
        lives: 1,
        currentState: 'living',
    };

    it('deduplicates identical wants in the current-life list', () => {
        const sayText = 'I am too hurt to start combat without food. I need to heal or get food first.';
        const timeline = Array.from({ length: 30 }, (_, i) => ({
            kind: 'say',
            tick: 22 + i,
            ts: `2026-05-25T03:0${i % 10}:13.635Z`,
            text: sayText,
            lifeIndex: 1,
        }));
        const rendered = renderPortrait('res:qa-guardian', index, timeline);
        expect(rendered.portrait.wants.current).toEqual([sayText]);
    });

    it('caps the current-life wants list at 5 distinct entries', () => {
        const distinct = Array.from({ length: 12 }, (_, i) => `I want item-${i} from the merchant.`);
        const timeline = distinct.map((text, i) => ({
            kind: 'say',
            tick: 100 + i,
            ts: `2026-05-25T04:00:0${i}.000Z`,
            text,
            lifeIndex: 1,
        }));
        const rendered = renderPortrait('res:qa-guardian', index, timeline);
        expect(rendered.portrait.wants.current).toHaveLength(5);
        // Should keep the most recent distinct wants (last 5)
        expect(rendered.portrait.wants.current).toEqual(distinct.slice(-5));
    });

    it('preserves non-want says (no false matches when wants are deduped)', () => {
        const timeline = [
            { kind: 'say', tick: 1, ts: '2026-05-25T04:00:01.000Z', text: 'I need to heal.', lifeIndex: 1 },
            { kind: 'say', tick: 2, ts: '2026-05-25T04:00:02.000Z', text: 'Just admiring the trees.', lifeIndex: 1 },
            { kind: 'say', tick: 3, ts: '2026-05-25T04:00:03.000Z', text: 'I need to heal.', lifeIndex: 1 },
        ];
        const rendered = renderPortrait('res:qa-guardian', index, timeline);
        // Current wants: only the deduped want text — not the non-want say.
        expect(rendered.portrait.wants.current).toEqual(['I need to heal.']);
        // Voice quotes still include the non-want.
        expect(rendered.portrait.voice.quotes.map(q => q.text)).toContain('Just admiring the trees.');
    });

    it('falls back to unfulfilledAtDeath when deceased and dedups there too', () => {
        const sayText = 'I need to find safer training grounds.';
        const timeline = [
            ...Array.from({ length: 5 }, (_, i) => ({
                kind: 'say',
                tick: 10 + i,
                ts: `2026-05-25T04:00:0${i}.000Z`,
                text: sayText,
                lifeIndex: 1,
            })),
            { kind: 'legacy_event', tick: 20, ts: '2026-05-25T04:10:00.000Z', event: { cause: 'goblin' }, lifeIndex: 1 },
        ];
        const deceasedIndex: PortraitIndex = { ...index, currentState: 'ended' };
        const rendered = renderPortrait('res:qa-guardian', deceasedIndex, timeline);
        expect(rendered.portrait.wants.current).toEqual([]);
        expect(rendered.portrait.wants.unfulfilledAtDeath).toEqual([{ lifeIndex: 1, want: sayText }]);
    });

    it('renders deduped wants in the markdown (no 42-line repeat)', () => {
        const sayText = 'I need to heal or get food first.';
        const timeline = Array.from({ length: 42 }, (_, i) => ({
            kind: 'say',
            tick: 22 + i,
            ts: `2026-05-25T03:0${i % 10}:13.635Z`,
            text: sayText,
            lifeIndex: 1,
        }));
        const rendered = renderPortrait('res:qa-guardian', index, timeline);
        const wantsSection = rendered.markdown.split('## Who they knew')[0];
        // Should contain the line once, not 42 times.
        const matches = wantsSection.match(new RegExp(escapeRegExp(`- ${sayText}`), 'g')) ?? [];
        expect(matches).toHaveLength(1);
    });
});

describe('renderPortrait story arc', () => {
    const index: PortraitIndex = {
        resident: 'res:arc-witness',
        createdAt: '2026-05-25T05:00:00.000Z',
        updatedAt: '2026-05-25T05:30:00.000Z',
        lives: 1,
        currentState: 'living',
    };

    it('surfaces the current arc phase in portrait JSON and markdown', () => {
        const rendered = renderPortrait('res:arc-witness', index, [
            { kind: 'say', tick: 1, ts: '2026-05-25T05:00:01.000Z', text: 'I need kindling for a patron fire.', lifeIndex: 1 },
            { kind: 'patron_gift', tick: 2, ts: '2026-05-25T05:00:02.000Z', patronHandle: 'patron:ash', amount: 7, lifeIndex: 1 },
            { kind: 'stuck_recovered', tick: 3, ts: '2026-05-25T05:00:03.000Z', lifeIndex: 1 },
        ]);

        expect(rendered.portrait.storyArc.phase).toBe('progress');
        expect(rendered.portrait.storyArc.evidence.fundingEvents).toBe(1);
        expect(rendered.markdown).toContain('## Current arc');
        expect(rendered.markdown).toContain('Phase: progress');
    });
});

describe('renderPortrait patron sentence quality', () => {
    const baseTs = '2026-05-26T09:00:00.000Z';
    const index: PortraitIndex = {
        resident: 'res:test-patron',
        createdAt: baseTs,
        updatedAt: baseTs,
        lives: 1,
        currentState: 'living',
    };

    it('describes a single gift event with artifact', () => {
        const rendered = renderPortrait('res:test-patron', index, [
            { kind: 'patron_gift', tick: 5, ts: baseTs, patronHandle: 'alice', artifact: 'a tinderbox', lifeIndex: 1 },
        ]);
        expect(rendered.portrait.patrons[0]!.sentence).toBe('alice gifted a tinderbox.');
    });

    it('describes a single gift event without artifact', () => {
        const rendered = renderPortrait('res:test-patron', index, [
            { kind: 'patron_gift', tick: 5, ts: baseTs, patronHandle: 'bob', lifeIndex: 1 },
        ]);
        expect(rendered.portrait.patrons[0]!.sentence).toBe('bob made a gift.');
    });

    it('describes a single witness event', () => {
        const rendered = renderPortrait('res:test-patron', index, [
            { kind: 'patron_witness', tick: 10, ts: baseTs, patronHandle: 'carol', lifeIndex: 1 },
        ]);
        expect(rendered.portrait.patrons[0]!.sentence).toBe('carol witnessed this journey.');
    });

    it('describes a single sponsor event', () => {
        const rendered = renderPortrait('res:test-patron', index, [
            { kind: 'patron_sponsor', tick: 2, ts: baseTs, patronHandle: 'dave', lifeIndex: 1 },
        ]);
        expect(rendered.portrait.patrons[0]!.sentence).toBe('dave sponsored this soul.');
    });

    it('combines two events for the same patron with "and"', () => {
        const rendered = renderPortrait('res:test-patron', index, [
            { kind: 'patron_gift', tick: 5, ts: baseTs, patronHandle: 'eve', artifact: 'a tinderbox', lifeIndex: 1 },
            { kind: 'patron_witness', tick: 10, ts: baseTs, patronHandle: 'eve', lifeIndex: 1 },
        ]);
        expect(rendered.portrait.patrons[0]!.sentence).toBe('eve gifted a tinderbox and witnessed this journey.');
    });

    it('combines three events for the same patron with Oxford comma', () => {
        const rendered = renderPortrait('res:test-patron', index, [
            { kind: 'patron_sponsor', tick: 2, ts: baseTs, patronHandle: 'frank', lifeIndex: 1 },
            { kind: 'patron_gift', tick: 5, ts: baseTs, patronHandle: 'frank', artifact: 'a tinderbox', lifeIndex: 1 },
            { kind: 'patron_witness', tick: 10, ts: baseTs, patronHandle: 'frank', lifeIndex: 1 },
        ]);
        expect(rendered.portrait.patrons[0]!.sentence).toBe('frank sponsored this soul, gifted a tinderbox, and witnessed this journey.');
    });
});

describe('renderPortrait narrative quality', () => {
    const baseTs = '2026-05-26T09:00:00.000Z';
    const index: PortraitIndex = {
        resident: 'res:test-narrative',
        createdAt: baseTs,
        updatedAt: baseTs,
        lives: 1,
        currentState: 'living',
    };

    it('story arc markdown does not show raw evidence count columns', () => {
        const rendered = renderPortrait('res:test-narrative', index, [
            { kind: 'say', tick: 1, ts: baseTs, text: 'I need help.', lifeIndex: 1 },
        ]);
        expect(rendered.markdown).not.toMatch(/\d+ pitch, \d+ funding/);
        expect(rendered.markdown).toContain('Phase:');
    });

    it('life notable events do not include say events (already in voice quotes)', () => {
        const rendered = renderPortrait('res:test-narrative', index, [
            { kind: 'say', tick: 1, ts: baseTs, text: 'Hello world.', lifeIndex: 1 },
            { kind: 'first_xp', tick: 5, ts: baseTs, skill: 'Fishing', lifeIndex: 1 },
        ]);
        const life = rendered.portrait.lives[0]!;
        expect(life.notableEvents.every(e => e.kind !== 'say')).toBe(true);
        expect(life.notableEvents.some(e => e.kind === 'first_xp')).toBe(true);
    });

    it('life notable events do not include patron events (already in patron section)', () => {
        const rendered = renderPortrait('res:test-narrative', index, [
            { kind: 'patron_gift', tick: 5, ts: baseTs, patronHandle: 'alice', artifact: 'a log', lifeIndex: 1 },
            { kind: 'first_xp', tick: 10, ts: baseTs, skill: 'Woodcutting', lifeIndex: 1 },
        ]);
        const life = rendered.portrait.lives[0]!;
        expect(life.notableEvents.every(e => !e.kind.startsWith('patron_'))).toBe(true);
        expect(life.notableEvents.some(e => e.kind === 'first_xp')).toBe(true);
    });

    it('revival event appears in notable events with cause in summary', () => {
        const rendered = renderPortrait('res:test-narrative', index, [
            { kind: 'revival', tick: 200, ts: baseTs, cause: 'patron offer', lifeIndex: 1 },
        ]);
        const life = rendered.portrait.lives[0]!;
        expect(life.notableEvents.some(e => e.kind === 'revival')).toBe(true);
        const revivalEvent = life.notableEvents.find(e => e.kind === 'revival')!;
        expect(revivalEvent.summary).toContain('Returned to life');
        expect(revivalEvent.summary).toContain('patron offer');
    });

    it('revival event without cause still produces a readable summary', () => {
        const rendered = renderPortrait('res:test-narrative', index, [{ kind: 'revival', tick: 300, ts: baseTs, lifeIndex: 1 }]);
        const life = rendered.portrait.lives[0]!;
        const revivalEvent = life.notableEvents.find(e => e.kind === 'revival')!;
        expect(revivalEvent.summary).toContain('Returned to life');
    });
});

function escapeRegExp(input: string): string {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
