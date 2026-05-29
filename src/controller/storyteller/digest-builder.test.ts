import { buildDigest, buildFixtureDigest, sortByImportance, resetRefCounter } from './digest-builder';
import { cityEventDigestSchema, IMPORTANCE_WEIGHT } from './types';
import type { DigestEvent, ResidentSnapshot } from './types';

const WIN_START = new Date('2026-05-29T05:50:00.000Z');
const WIN_END = new Date('2026-05-29T06:00:00.000Z');
const TS_IN = '2026-05-29T05:55:00.000Z';
const TS_BEFORE = '2026-05-29T05:49:59.999Z';
const TS_AFTER = '2026-05-29T06:00:00.001Z';

function makeEvent(ref: string, kind: DigestEvent['kind'], importance: DigestEvent['importance'], ts = TS_IN): DigestEvent {
    return { ref, kind, residentName: 'res:test', ts, note: 'test', importance };
}

function makeResident(name: string, attention = 2000, isLowAp = false, isFaded = false): ResidentSnapshot {
    return { residentName: name, attention, isLowAp, isFaded, gpObserved: null };
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('cityEventDigestSchema', () => {
    beforeEach(() => resetRefCounter());

    it('validates the fixture digest without errors', () => {
        const { digest } = buildFixtureDigest();
        const result = cityEventDigestSchema.safeParse(digest);
        if (!result.success) {
            // surface the first issue for easier debugging
            throw new Error(JSON.stringify(result.error.issues[0]));
        }
        expect(result.success).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Window boundary enforcement
// ---------------------------------------------------------------------------

describe('buildDigest — window boundaries', () => {
    it('excludes AP events outside the window', () => {
        const before = makeEvent('before', 'ap_low', 'medium', TS_BEFORE);
        const after = makeEvent('after', 'ap_low', 'medium', TS_AFTER);
        const inside = makeEvent('inside', 'ap_low', 'medium', TS_IN);

        const { apEvents } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
            apEvents: [before, after, inside],
        });

        expect(apEvents).toHaveLength(1);
        expect(apEvents[0].ref).toBe('inside');
    });

    it('excludes GP events outside the window', () => {
        const inside = makeEvent('gp-in', 'gp_earned', 'high', TS_IN);
        const outside = makeEvent('gp-out', 'gp_earned', 'high', TS_BEFORE);

        const { gpEvents } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
            gpEvents: [inside, outside],
        });

        expect(gpEvents).toHaveLength(1);
        expect(gpEvents[0].ref).toBe('gp-in');
    });

    it('keeps events exactly at windowStart', () => {
        const atStart = makeEvent('at-start', 'ap_granted', 'low', WIN_START.toISOString());
        const { apEvents } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
            apEvents: [atStart],
        });
        expect(apEvents).toHaveLength(1);
    });

    it('keeps events exactly at windowEnd', () => {
        const atEnd = makeEvent('at-end', 'gp_observed', 'high', WIN_END.toISOString());
        const { gpEvents } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
            gpEvents: [atEnd],
        });
        expect(gpEvents).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Importance sorting
// ---------------------------------------------------------------------------

describe('sortByImportance', () => {
    it('returns events highest-importance first', () => {
        const events: DigestEvent[] = [
            makeEvent('a', 'quiet_resident', 'minimal'),
            makeEvent('b', 'resident_faded', 'critical'),
            makeEvent('c', 'gp_earned', 'high'),
            makeEvent('d', 'ap_low', 'medium'),
            makeEvent('e', 'patron_gift', 'low'),
        ];
        const sorted = sortByImportance(events);
        expect(sorted[0].ref).toBe('b'); // critical
        expect(sorted[1].ref).toBe('c'); // high
        expect(sorted[2].ref).toBe('d'); // medium
        expect(sorted[3].ref).toBe('e'); // low
        expect(sorted[4].ref).toBe('a'); // minimal
    });

    it('breaks ties by timestamp ascending', () => {
        const events: DigestEvent[] = [
            makeEvent('later', 'gp_earned', 'high', '2026-05-29T05:56:00.000Z'),
            makeEvent('earlier', 'gp_earned', 'high', '2026-05-29T05:53:00.000Z'),
        ];
        const sorted = sortByImportance(events);
        expect(sorted[0].ref).toBe('earlier');
        expect(sorted[1].ref).toBe('later');
    });

    it('does not mutate the original array', () => {
        const events: DigestEvent[] = [makeEvent('a', 'quiet_resident', 'minimal'), makeEvent('b', 'resident_faded', 'critical')];
        const original = [...events];
        sortByImportance(events);
        expect(events[0].ref).toBe(original[0].ref);
    });
});

// ---------------------------------------------------------------------------
// maxResidentMentions cap
// ---------------------------------------------------------------------------

describe('buildDigest — maxResidentMentions cap', () => {
    it('caps topEvents at maxResidentMentions', () => {
        const events = Array.from({ length: 20 }, (_, i) => makeEvent(`e${i}`, 'gp_earned', 'high', TS_IN));
        const { topEvents } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
            gpEvents: events,
            config: { maxResidentMentions: 5 },
        });
        expect(topEvents).toHaveLength(5);
    });

    it('caps residents at maxResidentMentions', () => {
        const residents = Array.from({ length: 20 }, (_, i) => makeResident(`res:r${i}`));
        const { residents: out } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents,
            config: { maxResidentMentions: 3 },
        });
        expect(out).toHaveLength(3);
    });
});

// ---------------------------------------------------------------------------
// AP and GP event separation
// ---------------------------------------------------------------------------

describe('buildDigest — AP/GP separation', () => {
    it('keeps AP ledger events in apEvents, not gpEvents', () => {
        const apEvent = makeEvent('ap1', 'ap_granted', 'low', TS_IN);
        const { apEvents, gpEvents } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
            apEvents: [apEvent],
        });
        expect(apEvents).toHaveLength(1);
        expect(gpEvents).toHaveLength(0);
    });

    it('keeps GP evidence events in gpEvents, not apEvents', () => {
        const gpEvent = makeEvent('gp1', 'gp_observed', 'high', TS_IN);
        const { apEvents, gpEvents } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
            gpEvents: [gpEvent],
        });
        expect(gpEvents).toHaveLength(1);
        expect(apEvents).toHaveLength(0);
    });

    it('keeps AP-for-GP exchange events in exchangeEvents', () => {
        const exEvent = makeEvent('ex1', 'ap_for_gp_exchange', 'high', TS_IN);
        const { exchangeEvents, apEvents, gpEvents } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
            exchangeEvents: [exEvent],
        });
        expect(exchangeEvents).toHaveLength(1);
        expect(apEvents).toHaveLength(0);
        expect(gpEvents).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// System health counters
// ---------------------------------------------------------------------------

describe('buildDigest — systemHealth', () => {
    it('counts faded, active, and low-AP residents correctly', () => {
        const residents: ResidentSnapshot[] = [
            makeResident('res:a', 2000, false, false),
            makeResident('res:b', 50, true, false),
            makeResident('res:c', 0, false, true),
            makeResident('res:d', 0, false, true),
        ];
        const { systemHealth } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents,
        });
        expect(systemHealth.totalResidents).toBe(4);
        expect(systemHealth.activeResidents).toBe(2);
        expect(systemHealth.fadedResidents).toBe(2);
        expect(systemHealth.lowApResidents).toBe(1);
    });

    it('returns zeros when no residents', () => {
        const { systemHealth } = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [],
        });
        expect(systemHealth.totalResidents).toBe(0);
        expect(systemHealth.activeResidents).toBe(0);
        expect(systemHealth.fadedResidents).toBe(0);
        expect(systemHealth.lowApResidents).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// Fixture coverage
// ---------------------------------------------------------------------------

describe('buildFixtureDigest', () => {
    beforeEach(() => resetRefCounter());

    it('produces a valid digest that passes schema validation', () => {
        const { digest } = buildFixtureDigest();
        expect(() => cityEventDigestSchema.parse(digest)).not.toThrow();
    });

    it('contains at least one AP event (ap_low)', () => {
        const { digest } = buildFixtureDigest();
        const kinds = digest.apEvents.map(e => e.kind);
        expect(kinds).toContain('ap_low');
    });

    it('contains GP evidence events referencing coin item 995', () => {
        const { digest } = buildFixtureDigest();
        expect(digest.gpEvents.length).toBeGreaterThan(0);
        const evidences = digest.gpEvents.map(e => e.evidence);
        expect(evidences.some(ev => ev?.itemId === 995)).toBe(true);
    });

    it('contains an AP-for-GP exchange event with both AP and GP fields', () => {
        const { digest } = buildFixtureDigest();
        expect(digest.exchangeEvents.length).toBeGreaterThan(0);
        const ex = digest.exchangeEvents[0];
        expect(ex.evidence?.apGranted).toBeDefined();
        expect(ex.evidence?.gpItemId).toBe(995);
    });

    it('contains an NCRI event', () => {
        const { digest } = buildFixtureDigest();
        expect(digest.ncriEvents.length).toBeGreaterThan(0);
    });

    it('contains a bounded goal completion event', () => {
        const { digest } = buildFixtureDigest();
        expect(digest.goalEvents.length).toBeGreaterThan(0);
        expect(digest.goalEvents[0].kind).toBe('goal_completed');
    });

    it('contains a stuck-then-recovered event', () => {
        const { digest } = buildFixtureDigest();
        expect(digest.stuckEvents.length).toBeGreaterThan(0);
        expect(digest.stuckEvents[0].kind).toBe('stuck_recovered');
    });

    it('contains a quiet resident event', () => {
        const { digest } = buildFixtureDigest();
        const quiet = digest.miscEvents.find(e => e.kind === 'quiet_resident');
        expect(quiet).toBeDefined();
    });

    it('topEvents are sorted highest importance first', () => {
        const { digest } = buildFixtureDigest();
        const weights = digest.topEvents.map(e => IMPORTANCE_WEIGHT[e.importance]);
        for (let i = 1; i < weights.length; i++) {
            expect(weights[i]).toBeLessThanOrEqual(weights[i - 1]);
        }
    });

    it('includes four resident snapshots', () => {
        const { digest } = buildFixtureDigest();
        expect(digest.residents).toHaveLength(4);
    });

    it('identifies the low-AP resident (res:alice)', () => {
        const { digest } = buildFixtureDigest();
        const alice = digest.residents.find(r => r.residentName === 'res:alice');
        expect(alice).toBeDefined();
        expect(alice?.isLowAp).toBe(true);
        expect(alice?.gpObserved).toBe(200);
    });

    it('exchange event evidence distinguishes AP (Attention Points) from GP (RuneScape gold)', () => {
        const { digest } = buildFixtureDigest();
        const ex = digest.exchangeEvents[0];
        // AP side — Null City ledger
        expect(ex.evidence?.apGranted).toBeDefined();
        // GP side — real RuneScape evidence
        expect(ex.evidence?.gpBurned).toBeDefined();
        expect(ex.evidence?.gpItemId).toBe(995);
    });

    it('digest schemaVersion is 1', () => {
        const { digest } = buildFixtureDigest();
        expect(digest.schemaVersion).toBe(1);
    });

    it('all topEvent refs exist in one of the event buckets', () => {
        const { digest } = buildFixtureDigest();
        const allRefs = new Set(
            [
                ...digest.apEvents,
                ...digest.gpEvents,
                ...digest.exchangeEvents,
                ...digest.ncriEvents,
                ...digest.goalEvents,
                ...digest.stuckEvents,
                ...digest.miscEvents,
            ].map(e => e.ref),
        );

        for (const top of digest.topEvents) {
            expect(allRefs.has(top.ref)).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// IMPORTANCE_WEIGHT sanity
// ---------------------------------------------------------------------------

describe('IMPORTANCE_WEIGHT', () => {
    it('critical > high > medium > low > minimal', () => {
        expect(IMPORTANCE_WEIGHT.critical).toBeGreaterThan(IMPORTANCE_WEIGHT.high);
        expect(IMPORTANCE_WEIGHT.high).toBeGreaterThan(IMPORTANCE_WEIGHT.medium);
        expect(IMPORTANCE_WEIGHT.medium).toBeGreaterThan(IMPORTANCE_WEIGHT.low);
        expect(IMPORTANCE_WEIGHT.low).toBeGreaterThan(IMPORTANCE_WEIGHT.minimal);
    });
});
