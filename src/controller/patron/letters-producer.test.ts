import { type Letter, type StandingTierLetterInput, letterSchema, produceStandingTierLetter } from './letters-producer';

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

    describe('non-standing-tier kinds are not produced by this slice (TODO J-δ-β / J-δ-γ)', () => {
        it('does not export produceEpitaphLetter yet', () => {
            const mod = require('./letters-producer') as Record<string, unknown>;
            expect(mod.produceEpitaphLetter).toBeUndefined();
        });

        it('does not export produceCivicAchievementLetter yet', () => {
            const mod = require('./letters-producer') as Record<string, unknown>;
            expect(mod.produceCivicAchievementLetter).toBeUndefined();
        });
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
