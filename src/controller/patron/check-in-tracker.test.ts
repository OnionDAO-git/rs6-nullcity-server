import { CurrencyLedger } from './currency-ledger';
import { CheckInTracker, DAILY_CHECK_IN_SHARDS, REFERRAL_BONUS_SHARDS, type CheckInResult } from './check-in-tracker';

describe('CheckInTracker', () => {
    describe('canonical reward sizes (Notion Narrative V2)', () => {
        it('grants +1 Shard for a daily check-in', () => {
            expect(DAILY_CHECK_IN_SHARDS).toBe(1);
        });

        it('grants +2 Shards to the referrer on a referred human’s first workshop attendance', () => {
            expect(REFERRAL_BONUS_SHARDS).toBe(2);
        });
    });

    describe('checkIn', () => {
        it('credits +1 Shard on first check-in of the UTC day', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            const result = tracker.checkIn('alice', { ts: '2026-05-23T06:00:00.000Z' });

            expect(result.credited).toBe(true);
            expect(result.shards).toBe(1);
            expect(ledger.balance('alice')).toBe(1);
        });

        it('is idempotent within the same UTC day (no double credit)', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            tracker.checkIn('alice', { ts: '2026-05-23T06:00:00.000Z' });
            const second = tracker.checkIn('alice', { ts: '2026-05-23T18:30:00.000Z' });

            expect(second.credited).toBe(false);
            expect(second.shards).toBe(0);
            expect(ledger.balance('alice')).toBe(1);
        });

        it('credits again on the next UTC day', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            tracker.checkIn('alice', { ts: '2026-05-23T23:59:59.000Z' });
            const next = tracker.checkIn('alice', { ts: '2026-05-24T00:00:00.000Z' });

            expect(next.credited).toBe(true);
            expect(ledger.balance('alice')).toBe(2);
        });

        it('keeps separate per-human accounting', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            tracker.checkIn('alice', { ts: '2026-05-23T06:00:00.000Z' });
            tracker.checkIn('bob', { ts: '2026-05-23T06:30:00.000Z' });

            expect(ledger.balance('alice')).toBe(1);
            expect(ledger.balance('bob')).toBe(1);
        });

        it('records the credit on the CurrencyLedger with reason=daily_check_in', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            tracker.checkIn('alice', { ts: '2026-05-23T06:00:00.000Z' });
            const history = ledger.history('alice');
            expect(history).toHaveLength(1);
            expect(history[0]).toMatchObject({
                kind: 'credit',
                amount: 1,
                reason: 'daily-check-in',
            });
        });

        it('uses an injected now() when ts is omitted', () => {
            const ledger = new CurrencyLedger({ now: () => new Date('2026-05-23T06:00:00.000Z') });
            const tracker = new CheckInTracker(ledger, { now: () => new Date('2026-05-23T06:00:00.000Z') });

            const result = tracker.checkIn('alice');
            expect(result.credited).toBe(true);
            expect(ledger.balance('alice')).toBe(1);
        });
    });

    describe('recordWorkshopAttendance (referral bonus path)', () => {
        it('returns referralCredited=false when no referrer is configured', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            const result = tracker.recordWorkshopAttendance('alice', { ts: '2026-05-23T06:00:00.000Z' });

            expect(result.referralCredited).toBe(false);
            expect(ledger.balance('alice')).toBe(0);
            expect(ledger.balance('bob')).toBe(0);
        });

        it('credits +2 Shards to the referrer on the first workshop_attendance', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            const result = tracker.recordWorkshopAttendance('alice', {
                ts: '2026-05-23T06:00:00.000Z',
                referredBy: 'bob',
            });

            expect(result.referralCredited).toBe(true);
            expect(result.referrer).toBe('bob');
            expect(ledger.balance('bob')).toBe(2);
        });

        it('only credits the referrer ONCE per referred human (subsequent attendances are no-op for referral)', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            tracker.recordWorkshopAttendance('alice', { ts: '2026-05-23T06:00:00.000Z', referredBy: 'bob' });
            const second = tracker.recordWorkshopAttendance('alice', { ts: '2026-05-24T06:00:00.000Z', referredBy: 'bob' });

            expect(second.referralCredited).toBe(false);
            expect(ledger.balance('bob')).toBe(2);
        });

        it('referral history entry on the ledger names the referred human', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            tracker.recordWorkshopAttendance('alice', { ts: '2026-05-23T06:00:00.000Z', referredBy: 'bob' });
            const history = ledger.history('bob');
            expect(history).toHaveLength(1);
            expect(history[0].reason).toMatch(/referral/i);
            expect(history[0].reason).toContain('alice');
        });

        it('does NOT self-refer (alice referring alice produces no bonus)', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);

            const result = tracker.recordWorkshopAttendance('alice', { ts: '2026-05-23T06:00:00.000Z', referredBy: 'alice' });

            expect(result.referralCredited).toBe(false);
            expect(ledger.balance('alice')).toBe(0);
        });
    });

    describe('snapshot + restore (for J-α-3-style persistence later)', () => {
        it('exposes the check-in dates per human so a future J-α-3 follow-on can persist them', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);
            tracker.checkIn('alice', { ts: '2026-05-23T06:00:00.000Z' });
            tracker.checkIn('alice', { ts: '2026-05-24T06:00:00.000Z' });
            tracker.checkIn('bob', { ts: '2026-05-23T06:00:00.000Z' });

            const snapshot = tracker.snapshot();
            expect(snapshot.schemaVersion).toBe(1);
            expect(snapshot.checkInDates).toEqual({
                alice: ['2026-05-23', '2026-05-24'],
                bob: ['2026-05-23'],
            });
            expect(snapshot.referralCredited).toEqual({});
        });

        it('exposes the referral set so the same persistence layer can restore it', () => {
            const ledger = new CurrencyLedger();
            const tracker = new CheckInTracker(ledger);
            tracker.recordWorkshopAttendance('alice', { ts: '2026-05-23T06:00:00.000Z', referredBy: 'bob' });

            const snapshot = tracker.snapshot();
            expect(snapshot.referralCredited).toEqual({ alice: 'bob' });
        });

        it('rehydrates from snapshot and preserves idempotency', () => {
            const ledger = new CurrencyLedger();
            const earlier = new CheckInTracker(ledger);
            earlier.checkIn('alice', { ts: '2026-05-23T06:00:00.000Z' });
            const snapshot = earlier.snapshot();

            const restored = CheckInTracker.fromSnapshot(ledger, snapshot);
            const second: CheckInResult = restored.checkIn('alice', { ts: '2026-05-23T18:30:00.000Z' });
            expect(second.credited).toBe(false);
            expect(ledger.balance('alice')).toBe(1);
        });
    });
});
