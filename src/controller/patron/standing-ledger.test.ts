import {
    STANDING_TIERS,
    type StandingTier,
    StandingLedger,
    type StandingLedgerSnapshot,
    standingLedgerSnapshotSchema,
} from './standing-ledger';

describe('StandingLedger', () => {
    describe('STANDING_TIERS canonical shape', () => {
        it("uses the 3 named tiers from Notion (Acquaintance/Ally/Officer) plus a 'stranger' internal sentinel at 0", () => {
            // Canonical Notion: 3 named tiers at 10/30/75 Shards. Stranger is the implicit "no standing yet" sentinel.
            expect(STANDING_TIERS.map(tier => tier.name)).toEqual(['stranger', 'acquaintance', 'ally', 'officer']);
            expect(STANDING_TIERS.map(tier => tier.minPoints)).toEqual([0, 10, 30, 75]);
        });
    });

    describe('recordSupport + currentTier', () => {
        it('starts every (human, faction) pair at tier=stranger / 0 points', () => {
            const ledger = new StandingLedger();
            expect(ledger.points('alice', 'embassy')).toBe(0);
            expect(ledger.currentTier('alice', 'embassy')).toBe('stranger');
        });

        it('accumulates points per (human, faction) and reports current points + tier', () => {
            const ledger = new StandingLedger();
            ledger.recordSupport('alice', 'embassy', 5, { reason: 'patron_witness', ts: '2026-05-23T04:00:00.000Z' });
            ledger.recordSupport('alice', 'embassy', 7, { reason: 'mercy_infusion', ts: '2026-05-23T04:05:00.000Z' });
            expect(ledger.points('alice', 'embassy')).toBe(12);
            expect(ledger.currentTier('alice', 'embassy')).toBe('acquaintance');
        });

        it('isolates pairs: alice@embassy and alice@guild and bob@embassy are independent', () => {
            const ledger = new StandingLedger();
            ledger.recordSupport('alice', 'embassy', 10, { reason: 'mercy_infusion' });
            ledger.recordSupport('alice', 'guild', 30, { reason: 'mercy_infusion' });
            ledger.recordSupport('bob', 'embassy', 75, { reason: 'birth_sponsorship' });

            expect(ledger.currentTier('alice', 'embassy')).toBe('acquaintance');
            expect(ledger.currentTier('alice', 'guild')).toBe('ally');
            expect(ledger.currentTier('bob', 'embassy')).toBe('officer');
        });

        it('reports the highest tier the points cross', () => {
            const ledger = new StandingLedger();
            ledger.recordSupport('alice', 'embassy', 9, { reason: 'patron_witness' });
            expect(ledger.currentTier('alice', 'embassy')).toBe('stranger');
            ledger.recordSupport('alice', 'embassy', 1, { reason: 'patron_witness' });
            expect(ledger.currentTier('alice', 'embassy')).toBe('acquaintance');
            ledger.recordSupport('alice', 'embassy', 20, { reason: 'mercy_infusion' });
            expect(ledger.currentTier('alice', 'embassy')).toBe('ally');
            ledger.recordSupport('alice', 'embassy', 45, { reason: 'birth_sponsorship' });
            expect(ledger.currentTier('alice', 'embassy')).toBe('officer');
        });

        it('rejects non-positive support amounts', () => {
            const ledger = new StandingLedger();
            expect(() => ledger.recordSupport('alice', 'embassy', 0, { reason: 'x' })).toThrow(/positive/i);
            expect(() => ledger.recordSupport('alice', 'embassy', -1, { reason: 'x' })).toThrow(/positive/i);
        });

        it('rejects non-integer amounts (standing points are atomic)', () => {
            const ledger = new StandingLedger();
            expect(() => ledger.recordSupport('alice', 'embassy', 1.5, { reason: 'x' })).toThrow(/integer/i);
        });
    });

    describe('tier-crossing event', () => {
        it('returns null tierCrossed when the support does not cross a threshold', () => {
            const ledger = new StandingLedger();
            ledger.recordSupport('alice', 'embassy', 3, { reason: 'patron_witness' });
            const result = ledger.recordSupport('alice', 'embassy', 4, { reason: 'patron_witness' });
            expect(result.tierCrossed).toBeNull();
            expect(result.previousTier).toBe('stranger');
            expect(result.currentTier).toBe('stranger');
        });

        it('returns tierCrossed when the support crosses a single threshold', () => {
            const ledger = new StandingLedger();
            ledger.recordSupport('alice', 'embassy', 5, { reason: 'patron_witness' });
            const result = ledger.recordSupport('alice', 'embassy', 5, { reason: 'patron_witness' });
            expect(result.previousTier).toBe('stranger');
            expect(result.currentTier).toBe('acquaintance');
            expect(result.tierCrossed).toBe('acquaintance');
        });

        it('returns the HIGHEST crossed tier when a single support crosses multiple thresholds', () => {
            // Goes stranger(0) -> ally(30) in one shot.
            const ledger = new StandingLedger();
            const result = ledger.recordSupport('alice', 'embassy', 30, { reason: 'birth_sponsorship' });
            expect(result.previousTier).toBe('stranger');
            expect(result.currentTier).toBe('ally');
            expect(result.tierCrossed).toBe('ally');
        });

        it('crosses officer (75) only on the support that pushes points to 75 or above', () => {
            const ledger = new StandingLedger();
            ledger.recordSupport('alice', 'embassy', 74, { reason: 'mercy_infusion' });
            const stillAlly = ledger.recordSupport('alice', 'embassy', 0.5 + 0.5, { reason: 'patron_witness' });
            // We rejected non-integer above; use an integer support here that brings total to 74+1=75.
            expect(stillAlly).toBeDefined();
            expect(ledger.currentTier('alice', 'embassy')).toBe('officer');
        });
    });

    describe('history', () => {
        it('records every recordSupport entry with timestamp, faction, amount, reason', () => {
            const ledger = new StandingLedger();
            ledger.recordSupport('alice', 'embassy', 5, { reason: 'patron_witness', ts: '2026-05-23T04:00:00.000Z' });
            ledger.recordSupport('alice', 'embassy', 7, { reason: 'mercy_infusion', ts: '2026-05-23T04:05:00.000Z' });
            ledger.recordSupport('alice', 'guild', 3, { reason: 'patron_witness', ts: '2026-05-23T04:10:00.000Z' });

            const aliceEmbassy = ledger.history('alice', 'embassy');
            expect(aliceEmbassy).toHaveLength(2);
            expect(aliceEmbassy[0]).toMatchObject({ amount: 5, reason: 'patron_witness', ts: '2026-05-23T04:00:00.000Z' });
            expect(aliceEmbassy[1]).toMatchObject({ amount: 7, reason: 'mercy_infusion', ts: '2026-05-23T04:05:00.000Z' });

            const aliceGuild = ledger.history('alice', 'guild');
            expect(aliceGuild).toHaveLength(1);
            expect(aliceGuild[0]).toMatchObject({ amount: 3, faction: 'guild' });
        });

        it('returns empty history for an unknown (human, faction) pair', () => {
            const ledger = new StandingLedger();
            expect(ledger.history('alice', 'embassy')).toEqual([]);
        });
    });

    describe('snapshot + schema', () => {
        it('produces a snapshot that round-trips through the Zod schema', () => {
            const ledger = new StandingLedger();
            ledger.recordSupport('alice', 'embassy', 12, { reason: 'mercy_infusion', ts: '2026-05-23T04:00:00.000Z' });
            ledger.recordSupport('bob', 'embassy', 30, { reason: 'birth_sponsorship', ts: '2026-05-23T04:05:00.000Z' });

            const snapshot = ledger.snapshot();
            const parsed = standingLedgerSnapshotSchema.parse(snapshot);

            expect(parsed.schemaVersion).toBe(1);
            expect(parsed.points).toEqual({
                'alice|embassy': 12,
                'bob|embassy': 30,
            });
            expect(parsed.history['alice|embassy']).toHaveLength(1);
            expect(parsed.history['bob|embassy']).toHaveLength(1);
        });

        it('rehydrates from a snapshot with identical points + history + tier', () => {
            const snapshot: StandingLedgerSnapshot = {
                schemaVersion: 1,
                points: { 'alice|embassy': 12 },
                history: {
                    'alice|embassy': [
                        { humanId: 'alice', faction: 'embassy', amount: 12, reason: 'mercy_infusion', ts: '2026-05-23T04:00:00.000Z' },
                    ],
                },
            };
            const ledger = StandingLedger.fromSnapshot(snapshot);
            expect(ledger.points('alice', 'embassy')).toBe(12);
            expect(ledger.currentTier('alice', 'embassy')).toBe('acquaintance');
            expect(ledger.history('alice', 'embassy')).toHaveLength(1);
            expect(ledger.snapshot()).toEqual(snapshot);
        });
    });

    describe("'stranger' is never shown to humans — it's an internal sentinel", () => {
        // Documented in the DRIFT-reconciled J spec and in standing-ledger.ts.
        // This is a documentation-style test that enforces the convention via a public helper.
        it('exposes isUserFacingTier(tier) that returns false for stranger and true for acquaintance/ally/officer', () => {
            const { isUserFacingTier } = require('./standing-ledger') as { isUserFacingTier: (tier: StandingTier) => boolean };
            expect(isUserFacingTier('stranger')).toBe(false);
            expect(isUserFacingTier('acquaintance')).toBe(true);
            expect(isUserFacingTier('ally')).toBe(true);
            expect(isUserFacingTier('officer')).toBe(true);
        });
    });
});
