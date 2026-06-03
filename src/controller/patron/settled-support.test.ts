import fs from 'fs';
import os from 'os';
import path from 'path';
import { LettersStore } from './letters-store';
import { StandingLedger } from './standing-ledger';
import { recordSettledSupport } from './settled-support';

describe('recordSettledSupport (Shards-free Leg D seam)', () => {
    let root: string;
    let lettersStore: LettersStore;
    let standingLedger: StandingLedger;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'settled-support-'));
        lettersStore = new LettersStore(root);
        standingLedger = new StandingLedger({ now: () => new Date('2026-06-03T00:00:00Z') });
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('records standing + one tier letter with no currency debit (default 1:1)', () => {
        const res = recordSettledSupport(
            { patronId: 'alice@onion', faction: 'embassy', residentName: 'res:pip', onionsSettled: 10, ts: '2026-06-03T00:00:00.000Z' },
            { standingLedger, lettersStore },
        );
        expect(standingLedger.points('alice@onion', 'embassy')).toBe(10);
        expect(standingLedger.history('alice@onion', 'embassy')).toHaveLength(1);
        const inbox = lettersStore.readInbox('alice@onion');
        expect(inbox).toHaveLength(1);
        expect(inbox[0].kind).toBe('standing_tier_crossed');
        expect(res.standingPointsApplied).toBe(10);
        expect(res.lettersAppended).toBe(1);
    });

    it('applies the onionsPerStandingPoint scale (not 1:1)', () => {
        const res = recordSettledSupport(
            { patronId: 'bob@onion', faction: 'embassy', residentName: 'res:pip', onionsSettled: 100, ts: '2026-06-03T00:00:00.000Z' },
            { standingLedger, lettersStore, onionsPerStandingPoint: 10 },
        );
        expect(standingLedger.points('bob@onion', 'embassy')).toBe(10); // 100 / 10
        expect(res.standingPointsApplied).toBe(10);
    });

    it('records nothing when the scaled amount is sub-point', () => {
        const res = recordSettledSupport(
            { patronId: 'carol@onion', faction: 'embassy', residentName: 'res:pip', onionsSettled: 5, ts: '2026-06-03T00:00:00.000Z' },
            { standingLedger, lettersStore, onionsPerStandingPoint: 10 },
        );
        expect(res.standingPointsApplied).toBe(0);
        expect(res.lettersAppended).toBe(0);
        expect(standingLedger.history('carol@onion', 'embassy')).toHaveLength(0);
        expect(lettersStore.readInbox('carol@onion')).toEqual([]);
    });

    it('keys standing + letters on patronId (the canonical identity passed in)', () => {
        recordSettledSupport(
            { patronId: 'person-123', faction: 'embassy', residentName: 'res:pip', onionsSettled: 30, ts: '2026-06-03T00:00:00.000Z' },
            { standingLedger, lettersStore },
        );
        expect(standingLedger.points('person-123', 'embassy')).toBe(30); // ally
        expect(lettersStore.readInbox('person-123').length).toBeGreaterThanOrEqual(1);
    });

    it('is NOT idempotent on its own — standing is additive (idempotency is the caller\'s job)', () => {
        // This pins the real contract: recordSettledSupport has NO internal dedup.
        // Calling it twice for the same grant doubles standing. The dashboard saga
        // relies on the upstream creditAttention `idempotent()` wrapper to never
        // fire onPatronSupport twice for one idempotencyKey — see service.ts.
        const ev = { patronId: 'dup@onion', faction: 'embassy', residentName: 'res:pip', onionsSettled: 10, ts: '2026-06-03T00:00:00.000Z' };
        recordSettledSupport(ev, { standingLedger, lettersStore });
        recordSettledSupport({ ...ev }, { standingLedger, lettersStore });
        expect(standingLedger.points('dup@onion', 'embassy')).toBe(20); // additive — proves NOT idempotent
        // Letters DO dedup on (kind, dispatchedAt, subject, recipient): the 2nd call
        // crosses no new tier (10->20, both Acquaintance), so still exactly one letter.
        expect(lettersStore.readInbox('dup@onion')).toHaveLength(1);
    });
});
