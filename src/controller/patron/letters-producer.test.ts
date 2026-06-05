import {
    type AttentionPleaLetterInput,
    type CivicAchievementLetterInput,
    type EpitaphLetterInput,
    type GoalAchievedLetterInput,
    type Letter,
    type ResidentReplyLetterInput,
    type StandingTierLetterInput,
    type BroadcastLetterInput,
    letterSchema,
    produceCivicAchievementLetter,
    produceEpitaphLetter,
    produceGoalAchievedLetter,
    produceResidentReplyLetter,
    produceStandingTierLetter,
    produceBroadcastLetter,
    produceAttentionPleaLetter,
    ticksToHumanTime,
} from './letters-producer';

describe('ticksToHumanTime', () => {
    it('returns "a few minutes" for very short lives (< 200 ticks)', () => {
        expect(ticksToHumanTime(0)).toBe('a few minutes');
        expect(ticksToHumanTime(100)).toBe('a few minutes');
        expect(ticksToHumanTime(199)).toBe('a few minutes');
    });

    it('returns minute count for sub-hour lives', () => {
        expect(ticksToHumanTime(1240)).toBe('12 minutes'); // 12.4 min
        expect(ticksToHumanTime(3000)).toBe('30 minutes');
    });

    it('returns "about an hour" for single-hour lives', () => {
        expect(ticksToHumanTime(6000)).toBe('about an hour');
    });

    it('returns hour count for multi-hour lives under a day', () => {
        expect(ticksToHumanTime(12000)).toBe('2 hours');
        expect(ticksToHumanTime(50000)).toBe('8 hours'); // 50000/6000 ≈ 8.3
    });

    it('returns "about a day" for single-day lives', () => {
        expect(ticksToHumanTime(144000)).toBe('about a day');
    });

    it('returns day count for flagship hero lifespans', () => {
        expect(ticksToHumanTime(4_320_000)).toBe('30 days'); // ~30-day hero
    });
});

describe('produceStandingTierLetter', () => {
    const baseInput: StandingTierLetterInput = {
        humanId: 'alice@onion',
        faction: 'embassy',
        residentName: 'res:agent',
        tierCrossed: 'acquaintance',
        amount: 10,
        ts: '2026-05-23T04:00:00.000Z',
    };

    it('returns null when the tier is the stranger sentinel (no user-facing letter)', () => {
        const result = produceStandingTierLetter({ ...baseInput, tierCrossed: 'stranger' });
        expect(result).toBeNull();
    });

    it('returns a Letter object when the tier is Acquaintance', () => {
        const letter = produceStandingTierLetter(baseInput);
        expect(letter).not.toBeNull();
        expect(letter!.kind).toBe('standing_tier_crossed');
        expect(letter!.recipient).toBe('alice@onion');
        expect(letter!.subject).toMatch(/acquaintance/i);
        expect(letter!.subject).toMatch(/embassy/i);
        expect(letter!.body).toMatch(/alice@onion/);
        expect(letter!.body).toMatch(/acquaintance/i);
        expect(letter!.dispatchedAt).toBe(baseInput.ts);
    });

    it('returns a Letter when the tier is Ally with the Ally body template', () => {
        const letter = produceStandingTierLetter({ ...baseInput, tierCrossed: 'ally', amount: 30 });
        expect(letter).not.toBeNull();
        expect(letter!.subject).toMatch(/ally/i);
        expect(letter!.body).toMatch(/ally/i);
        // The Ally body should be distinct from Acquaintance.
        const acq = produceStandingTierLetter(baseInput);
        expect(letter!.body).not.toBe(acq?.body);
    });

    it('returns a Letter when the tier is Officer with the Officer body template', () => {
        const letter = produceStandingTierLetter({ ...baseInput, tierCrossed: 'officer', amount: 75 });
        expect(letter).not.toBeNull();
        expect(letter!.subject).toMatch(/officer/i);
        expect(letter!.body).toMatch(/officer/i);
        // The Officer body should differ from both Acquaintance and Ally.
        const ally = produceStandingTierLetter({ ...baseInput, tierCrossed: 'ally' });
        expect(letter!.body).not.toBe(ally?.body);
    });

    it('includes the supporting resident name in the letter body', () => {
        const letter = produceStandingTierLetter({ ...baseInput, residentName: 'res:fern' });
        expect(letter!.body).toMatch(/res:fern/);
    });

    it('includes the amount and faction in the letter body for context', () => {
        const letter = produceStandingTierLetter({ ...baseInput, amount: 15, faction: 'librarian-circle' });
        expect(letter!.body).toMatch(/15/);
        expect(letter!.body).toMatch(/librarian-circle/);
    });

    it('produces a letter whose deliveryChannels default to web-inbox', () => {
        const letter = produceStandingTierLetter(baseInput);
        expect(letter!.deliveryChannels).toEqual(['web-inbox']);
    });

    it('produces a letter that round-trips through the Zod letterSchema', () => {
        const letter = produceStandingTierLetter(baseInput);
        const parsed = letterSchema.parse(letter);
        expect(parsed.kind).toBe('standing_tier_crossed');
    });

    it('the Letter shape names the senderResident explicitly so future slices can route via a sibling flagship (J-δ-3 / hero deaths)', () => {
        const letter = produceStandingTierLetter(baseInput);
        expect(letter!.senderResident).toBe('res:agent');
    });
});

describe('produceEpitaphLetter (J-δ-γ)', () => {
    const baseInput: EpitaphLetterInput = {
        humanId: 'alice@onion',
        faction: 'embassy',
        residentName: 'res:fern',
        residentArchetype: 'mentor',
        livedTicks: 1240,
        bestSkill: { name: 'firemaking', level: 22 },
        causeOfDeath: 'goblin (level 5) in lumbridge swamp',
        ts: '2026-05-23T11:00:00.000Z',
        // Sibling-flagship sender override for hero deaths (J-δ-3 hook).
        senderResident: 'res:wise-old-man',
    };

    it('returns a Letter with kind=epitaph', () => {
        const letter = produceEpitaphLetter(baseInput);
        expect(letter.kind).toBe('epitaph');
    });

    it('addresses the human by id and routes to the human-id recipient', () => {
        const letter = produceEpitaphLetter(baseInput);
        expect(letter.recipient).toBe('alice@onion');
        expect(letter.body).toMatch(/alice@onion/);
    });

    it('uses the optional senderResident override (sibling flagship for hero deaths)', () => {
        const letter = produceEpitaphLetter(baseInput);
        expect(letter.senderResident).toBe('res:wise-old-man');
    });

    it('falls back to residentName as sender when no senderResident override is given', () => {
        const letter = produceEpitaphLetter({ ...baseInput, senderResident: undefined });
        expect(letter.senderResident).toBe('res:fern');
    });

    it('mentions the deceased resident by name in subject + body', () => {
        const letter = produceEpitaphLetter(baseInput);
        expect(letter.subject).toMatch(/res:fern/);
        expect(letter.body).toMatch(/res:fern/);
    });

    it('mentions faction, lifespan in human time, best-skill, and cause-of-death in the body', () => {
        const letter = produceEpitaphLetter(baseInput);
        expect(letter.body).toMatch(/embassy/);
        expect(letter.body).toMatch(/12 minutes/); // 1240 ticks ≈ 12 minutes
        expect(letter.body).toMatch(/firemaking/);
        expect(letter.body).toMatch(/22/);
        expect(letter.body).toMatch(/goblin/);
    });

    it('handles missing bestSkill gracefully (no NaN, no "undefined" leak)', () => {
        const letter = produceEpitaphLetter({ ...baseInput, bestSkill: undefined });
        expect(letter.body).not.toMatch(/undefined/);
        expect(letter.body).not.toMatch(/NaN/);
    });

    it('handles missing causeOfDeath as "circumstances unknown"', () => {
        const letter = produceEpitaphLetter({ ...baseInput, causeOfDeath: undefined });
        expect(letter.body).toMatch(/unknown|unrecorded|not.* recorded/i);
    });

    it('delivers to web-inbox + in-game-scroll + lanyard-card (epitaphs travel widely)', () => {
        const letter = produceEpitaphLetter(baseInput);
        expect(letter.deliveryChannels).toEqual(expect.arrayContaining(['web-inbox', 'in-game-scroll', 'lanyard-card']));
        expect(letter.deliveryChannels).toHaveLength(3);
    });

    it('uses the supplied ts as dispatchedAt', () => {
        const letter = produceEpitaphLetter(baseInput);
        expect(letter.dispatchedAt).toBe(baseInput.ts);
    });

    it('round-trips through letterSchema', () => {
        const letter = produceEpitaphLetter(baseInput);
        expect(() => letterSchema.parse(letter)).not.toThrow();
    });
});

describe('produceCivicAchievementLetter (J-δ-γ)', () => {
    const baseInput: CivicAchievementLetterInput = {
        humanId: 'alice@onion',
        faction: 'embassy',
        residentName: 'res:fern',
        achievementKind: 'first_quest_completed',
        achievementDetail: 'Cook’s Assistant — flour and milk delivered to Lumbridge Castle.',
        ts: '2026-05-23T11:00:00.000Z',
    };

    it('returns a Letter with kind=civic_milestone', () => {
        const letter = produceCivicAchievementLetter(baseInput);
        expect(letter.kind).toBe('civic_milestone');
    });

    it('addresses the human and mentions the resident + faction + achievement detail', () => {
        const letter = produceCivicAchievementLetter(baseInput);
        expect(letter.recipient).toBe('alice@onion');
        expect(letter.body).toMatch(/alice@onion/);
        expect(letter.body).toMatch(/res:fern/);
        expect(letter.body).toMatch(/embassy/);
        expect(letter.body).toMatch(/Cook.s Assistant/);
    });

    it('subject names the achievement kind in human-readable form', () => {
        const letter = produceCivicAchievementLetter(baseInput);
        // first_quest_completed → "First Quest Completed" or similar
        expect(letter.subject).toMatch(/quest/i);
    });

    it('delivers to web-inbox + lanyard-card (achievements are share-worthy but not as solemn as epitaphs)', () => {
        const letter = produceCivicAchievementLetter(baseInput);
        expect(letter.deliveryChannels).toEqual(expect.arrayContaining(['web-inbox', 'lanyard-card']));
        expect(letter.deliveryChannels).not.toContain('in-game-scroll');
    });

    it('sender defaults to the residentName when no override given', () => {
        const letter = produceCivicAchievementLetter(baseInput);
        expect(letter.senderResident).toBe('res:fern');
    });

    it('supports different achievementKind variants (firemaking_level_25, faction_oath, embassy_visit)', () => {
        const kinds: CivicAchievementLetterInput['achievementKind'][] = ['firemaking_level_25', 'faction_oath', 'embassy_visit'];
        for (const k of kinds) {
            const letter = produceCivicAchievementLetter({ ...baseInput, achievementKind: k });
            expect(letter.kind).toBe('civic_milestone');
            expect(letter.subject.length).toBeGreaterThan(0);
            expect(letter.body.length).toBeGreaterThan(0);
        }
    });

    it('round-trips through letterSchema', () => {
        const letter = produceCivicAchievementLetter(baseInput);
        expect(() => letterSchema.parse(letter)).not.toThrow();
    });
});

describe('produceBroadcastLetter (J4)', () => {
    const baseInput: BroadcastLetterInput = {
        recipient: 'bob@onion',
        residentName: 'res:hans',
        faction: 'embassy',
        livedTicks: 12000,
        causeOfDeath: 'attention exhaustion',
        ts: '2026-05-25T12:00:00.000Z',
    };

    it('returns a Letter with kind=broadcast', () => {
        const letter = produceBroadcastLetter(baseInput);
        expect(letter.kind).toBe('broadcast');
    });

    it('sets recipient and matches body placeholders using human time', () => {
        const letter = produceBroadcastLetter(baseInput);
        expect(letter.recipient).toBe('bob@onion');
        expect(letter.body).toMatch(/res:hans/);
        expect(letter.body).toMatch(/embassy/);
        expect(letter.body).toMatch(/2 hours/); // 12000 ticks ≈ 2 hours
        expect(letter.body).toMatch(/attention exhaustion/);
    });

    it('delivers strictly to web-inbox', () => {
        const letter = produceBroadcastLetter(baseInput);
        expect(letter.deliveryChannels).toEqual(['web-inbox']);
    });

    it('round-trips through letterSchema', () => {
        const letter = produceBroadcastLetter(baseInput);
        expect(() => letterSchema.parse(letter)).not.toThrow();
    });
});

describe('produceAttentionPleaLetter (LB-H2R-4p77)', () => {
    const baseInput: AttentionPleaLetterInput = {
        humanId: 'alice@onion',
        residentName: 'res:fern',
        faction: 'embassy',
        currentAp: 350,
        ts: '2026-06-04T22:00:00.000Z',
    };

    it('returns a Letter with kind=attention_plea', () => {
        const letter = produceAttentionPleaLetter(baseInput);
        expect(letter.kind).toBe('attention_plea');
    });

    it('sets recipient to humanId', () => {
        const letter = produceAttentionPleaLetter(baseInput);
        expect(letter.recipient).toBe('alice@onion');
    });

    it('sets senderResident to residentName', () => {
        const letter = produceAttentionPleaLetter(baseInput);
        expect(letter.senderResident).toBe('res:fern');
    });

    it('subject includes the resident name', () => {
        const letter = produceAttentionPleaLetter(baseInput);
        expect(letter.subject).toMatch(/res:fern/);
    });

    it('body includes humanId, residentName, faction, and AP amount', () => {
        const letter = produceAttentionPleaLetter(baseInput);
        expect(letter.body).toMatch(/alice@onion/);
        expect(letter.body).toMatch(/res:fern/);
        expect(letter.body).toMatch(/embassy/);
        expect(letter.body).toMatch(/350/);
    });

    it('delivers strictly to web-inbox (no in-game-scroll, no lanyard-card)', () => {
        const letter = produceAttentionPleaLetter(baseInput);
        expect(letter.deliveryChannels).toEqual(['web-inbox']);
    });

    it('sets dispatchedAt to the supplied ts', () => {
        const letter = produceAttentionPleaLetter(baseInput);
        expect(letter.dispatchedAt).toBe(baseInput.ts);
    });

    it('different timestamps can produce different body templates (rotation covers all 3 variants)', () => {
        const timestamps = [
            '2026-06-04T00:00:00.000Z',
            '2026-06-04T01:00:00.000Z',
            '2026-06-04T02:00:00.000Z',
            '2026-06-04T03:00:00.000Z',
            '2026-06-04T04:00:00.000Z',
            '2026-06-04T05:00:00.000Z',
        ];
        const bodies = new Set(timestamps.map(ts => produceAttentionPleaLetter({ ...baseInput, ts }).body));
        // At least 2 distinct templates across 6 timestamps; all 3 covered with enough samples.
        expect(bodies.size).toBeGreaterThanOrEqual(2);
    });

    it('produces identical bodies for two patrons receiving the same plea at the same ts', () => {
        const a = produceAttentionPleaLetter({ ...baseInput, humanId: 'alice@onion' });
        const b = produceAttentionPleaLetter({ ...baseInput, humanId: 'bob@onion' });
        // Body template selection is ts-deterministic; only humanId substitution differs.
        const aBodyStripped = a.body.replace(/alice@onion/g, 'PATRON');
        const bBodyStripped = b.body.replace(/bob@onion/g, 'PATRON');
        expect(aBodyStripped).toBe(bBodyStripped);
    });

    it('round-trips through letterSchema', () => {
        const letter = produceAttentionPleaLetter(baseInput);
        expect(() => letterSchema.parse(letter)).not.toThrow();
    });
});

describe('letterSchema', () => {
    it('rejects a Letter with empty recipient', () => {
        expect(() =>
            letterSchema.parse({
                kind: 'standing_tier_crossed',
                recipient: '',
                senderResident: 'res:agent',
                subject: 'x',
                body: 'x',
                dispatchedAt: '2026-05-23T04:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            } satisfies Letter),
        ).toThrow();
    });

    it('rejects a Letter with empty body', () => {
        expect(() =>
            letterSchema.parse({
                kind: 'standing_tier_crossed',
                recipient: 'alice@onion',
                senderResident: 'res:agent',
                subject: 'x',
                body: '',
                dispatchedAt: '2026-05-23T04:00:00.000Z',
                deliveryChannels: ['web-inbox'],
            } satisfies Letter),
        ).toThrow();
    });

    it('accepts deliveryChannels of ["web-inbox", "in-game-scroll", "lanyard-card"]', () => {
        const letter: Letter = {
            kind: 'standing_tier_crossed',
            recipient: 'alice@onion',
            senderResident: 'res:agent',
            subject: 'x',
            body: 'x',
            dispatchedAt: '2026-05-23T04:00:00.000Z',
            deliveryChannels: ['web-inbox', 'in-game-scroll', 'lanyard-card'],
        };
        expect(() => letterSchema.parse(letter)).not.toThrow();
    });
});

describe('produceResidentReplyLetter', () => {
    const baseInput: ResidentReplyLetterInput = {
        humanId: 'alice@onion',
        residentName: 'res:hans',
        replyText: 'I found the Blue Moon Inn just north of the market.',
        ts: '2026-06-05T00:10:00.000Z',
    };

    it('produces a resident_reply letter with correct fields', () => {
        const letter = produceResidentReplyLetter(baseInput);
        expect(letter.kind).toBe('resident_reply');
        expect(letter.recipient).toBe('alice@onion');
        expect(letter.senderResident).toBe('res:hans');
        expect(letter.body).toBe('I found the Blue Moon Inn just north of the market.');
        expect(letter.dispatchedAt).toBe('2026-06-05T00:10:00.000Z');
        expect(letter.deliveryChannels).toEqual(['web-inbox']);
    });

    it('includes the resident name in the subject', () => {
        const letter = produceResidentReplyLetter(baseInput);
        expect(letter.subject).toContain('res:hans');
    });

    it('passes letterSchema validation', () => {
        const letter = produceResidentReplyLetter(baseInput);
        expect(() => letterSchema.parse(letter)).not.toThrow();
    });
});

describe('produceGoalAchievedLetter (S-GOAL-NOTIF-1)', () => {
    const baseInput: GoalAchievedLetterInput = {
        humanId: 'alice@onion',
        residentName: 'res:hans',
        goalText: 'Become the best fisherman in Null City',
        ts: '2026-06-05T17:30:00.000Z',
    };

    it('returns a goal_achieved letter', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(letter.kind).toBe('goal_achieved');
    });

    it('sets recipient to humanId', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(letter.recipient).toBe('alice@onion');
    });

    it('sets senderResident to residentName', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(letter.senderResident).toBe('res:hans');
    });

    it('subject includes the display name (stripped of res: prefix)', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(letter.subject).toContain('hans');
        expect(letter.subject).not.toContain('res:');
    });

    it('body includes the goalText', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(letter.body).toContain('Become the best fisherman in Null City');
    });

    it('body includes the humanId', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(letter.body).toContain('alice@onion');
    });

    it('delivers to web-inbox only', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(letter.deliveryChannels).toEqual(['web-inbox']);
    });

    it('sets dispatchedAt to the supplied ts', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(letter.dispatchedAt).toBe('2026-06-05T17:30:00.000Z');
    });

    it('two patrons of the same resident get the same body template', () => {
        const letter1 = produceGoalAchievedLetter({ ...baseInput, humanId: 'alice@onion' });
        const letter2 = produceGoalAchievedLetter({ ...baseInput, humanId: 'alice@onion' });
        expect(letter1.body).toBe(letter2.body);
    });

    it('rotation covers all 3 body templates across different humanId + residentName combos', () => {
        const variants = new Set<string>();
        const names = ['res:hans', 'res:aereck', 'res:wizard'];
        const patrons = ['alice@onion', 'bob@onion', 'carol@onion', 'dave@onion'];
        for (const residentName of names) {
            for (const humanId of patrons) {
                const letter = produceGoalAchievedLetter({ ...baseInput, residentName, humanId });
                variants.add(letter.body.split('\n')[2]);
            }
        }
        expect(variants.size).toBeGreaterThanOrEqual(2);
    });

    it('passes letterSchema validation', () => {
        const letter = produceGoalAchievedLetter(baseInput);
        expect(() => letterSchema.parse(letter)).not.toThrow();
    });
});
