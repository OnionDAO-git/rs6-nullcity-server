import { buildDigest, buildFixtureDigest, sortByImportance, resetRefCounter, economyEventsToDigestBuckets } from './digest-builder';
import { cityEventDigestSchema, IMPORTANCE_WEIGHT } from './types';
import type { DigestEvent, ResidentSnapshot } from './types';
import type { EconomyEvent } from '../city-integration/economy-event';

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

// ---------------------------------------------------------------------------
// economyEventsToDigestBuckets — S5b: EconomyEvent → DigestEvent adapter
// ---------------------------------------------------------------------------

function makeEconomyEvent(overrides: Partial<EconomyEvent> & Pick<EconomyEvent, 'kind'>): EconomyEvent {
    return {
        schemaVersion: 1,
        id: `evt-${Math.random().toString(36).slice(2)}`,
        ts: '2026-05-29T05:55:00.000Z',
        residentName: 'res:test',
        ...overrides,
    };
}

describe('economyEventsToDigestBuckets — NCRI events (S5b core)', () => {
    it('maps ncri_sale to ncriEvents with kind ncri_created', () => {
        const event = makeEconomyEvent({ kind: 'ncri_sale', ncriId: 'ncri-001', note: 'NCRI sold' });
        const { ncriEvents, apEvents, gpEvents, exchangeEvents } = economyEventsToDigestBuckets([event]);
        expect(ncriEvents).toHaveLength(1);
        expect(ncriEvents[0].kind).toBe('ncri_created');
        expect(ncriEvents[0].ref).toBe(event.id);
        expect(ncriEvents[0].evidence?.['ncriId']).toBe('ncri-001');
        expect(apEvents).toHaveLength(0);
        expect(gpEvents).toHaveLength(0);
        expect(exchangeEvents).toHaveLength(0);
    });

    it('maps ncri_redemption to ncriEvents with kind ncri_redeemed', () => {
        const event = makeEconomyEvent({ kind: 'ncri_redemption', ncriId: 'ncri-002', note: 'NCRI redeemed' });
        const { ncriEvents } = economyEventsToDigestBuckets([event]);
        expect(ncriEvents).toHaveLength(1);
        expect(ncriEvents[0].kind).toBe('ncri_redeemed');
        expect(ncriEvents[0].evidence?.['ncriId']).toBe('ncri-002');
    });

    it('preserves refId in NCRI event evidence', () => {
        const event = makeEconomyEvent({ kind: 'ncri_sale', ncriId: 'ncri-003', refId: 'apgp:exchange:999' });
        const { ncriEvents } = economyEventsToDigestBuckets([event]);
        expect(ncriEvents[0].evidence?.['refId']).toBe('apgp:exchange:999');
    });

    it('preserves cityUserId in NCRI event evidence', () => {
        const event = makeEconomyEvent({ kind: 'ncri_redemption', ncriId: 'ncri-004', cityUserId: 'patron:james' });
        const { ncriEvents } = economyEventsToDigestBuckets([event]);
        expect(ncriEvents[0].evidence?.['cityUserId']).toBe('patron:james');
    });

    it('marks NCRI events as importance high', () => {
        const sale = makeEconomyEvent({ kind: 'ncri_sale', ncriId: 'ncri-005' });
        const redeem = makeEconomyEvent({ kind: 'ncri_redemption', ncriId: 'ncri-006' });
        const { ncriEvents } = economyEventsToDigestBuckets([sale, redeem]);
        expect(ncriEvents.every(e => e.importance === 'high')).toBe(true);
    });

    it('handles multiple NCRI events', () => {
        const events = [
            makeEconomyEvent({ kind: 'ncri_sale', ncriId: 'ncri-a' }),
            makeEconomyEvent({ kind: 'ncri_redemption', ncriId: 'ncri-b' }),
            makeEconomyEvent({ kind: 'ncri_sale', ncriId: 'ncri-c' }),
        ];
        const { ncriEvents } = economyEventsToDigestBuckets(events);
        expect(ncriEvents).toHaveLength(3);
        expect(ncriEvents[0].kind).toBe('ncri_created');
        expect(ncriEvents[1].kind).toBe('ncri_redeemed');
        expect(ncriEvents[2].kind).toBe('ncri_created');
    });
});

describe('economyEventsToDigestBuckets — AP events', () => {
    it('maps ap_grant to apEvents with kind ap_granted', () => {
        const event = makeEconomyEvent({ kind: 'ap_grant', apDelta: 100 });
        const { apEvents } = economyEventsToDigestBuckets([event]);
        expect(apEvents).toHaveLength(1);
        expect(apEvents[0].kind).toBe('ap_granted');
        expect(apEvents[0].importance).toBe('low');
    });

    it('maps ap_topup to apEvents with kind ap_granted', () => {
        const event = makeEconomyEvent({ kind: 'ap_topup', apDelta: 50 });
        const { apEvents } = economyEventsToDigestBuckets([event]);
        expect(apEvents).toHaveLength(1);
        expect(apEvents[0].kind).toBe('ap_granted');
    });

    it('maps ap_fade to apEvents with kind resident_faded and importance critical', () => {
        const event = makeEconomyEvent({ kind: 'ap_fade' });
        const { apEvents } = economyEventsToDigestBuckets([event]);
        expect(apEvents).toHaveLength(1);
        expect(apEvents[0].kind).toBe('resident_faded');
        expect(apEvents[0].importance).toBe('critical');
    });

    it('skips ap_decay — too granular for narrative layer', () => {
        const event = makeEconomyEvent({ kind: 'ap_decay', apDelta: -5 });
        const { apEvents, gpEvents, exchangeEvents, ncriEvents } = economyEventsToDigestBuckets([event]);
        expect(apEvents).toHaveLength(0);
        expect(gpEvents).toHaveLength(0);
        expect(exchangeEvents).toHaveLength(0);
        expect(ncriEvents).toHaveLength(0);
    });

    it('preserves apDelta in AP event evidence', () => {
        const event = makeEconomyEvent({ kind: 'ap_grant', apDelta: 200 });
        const { apEvents } = economyEventsToDigestBuckets([event]);
        expect(apEvents[0].evidence?.['apDelta']).toBe(200);
    });
});

describe('economyEventsToDigestBuckets — GP events', () => {
    it('maps gp_observed to gpEvents with kind gp_observed', () => {
        const event = makeEconomyEvent({ kind: 'gp_observed', gpDelta: 500 });
        const { gpEvents } = economyEventsToDigestBuckets([event]);
        expect(gpEvents).toHaveLength(1);
        expect(gpEvents[0].kind).toBe('gp_observed');
        expect(gpEvents[0].importance).toBe('high');
    });

    it('maps gp_earned to gpEvents with kind gp_earned', () => {
        const event = makeEconomyEvent({ kind: 'gp_earned', gpDelta: 150 });
        const { gpEvents } = economyEventsToDigestBuckets([event]);
        expect(gpEvents).toHaveLength(1);
        expect(gpEvents[0].kind).toBe('gp_earned');
    });

    it('maps gp_traded to gpEvents with kind gp_earned', () => {
        const event = makeEconomyEvent({ kind: 'gp_traded', gpDelta: -200 });
        const { gpEvents } = economyEventsToDigestBuckets([event]);
        expect(gpEvents).toHaveLength(1);
        expect(gpEvents[0].kind).toBe('gp_earned');
    });

    it('preserves gpDelta in GP event evidence', () => {
        const event = makeEconomyEvent({ kind: 'gp_earned', gpDelta: 300 });
        const { gpEvents } = economyEventsToDigestBuckets([event]);
        expect(gpEvents[0].evidence?.['gpDelta']).toBe(300);
    });
});

describe('economyEventsToDigestBuckets — exchange events', () => {
    it('maps ap_gp_exchange to exchangeEvents with kind ap_for_gp_exchange', () => {
        const event = makeEconomyEvent({ kind: 'ap_gp_exchange', apDelta: 50, gpDelta: -200 });
        const { exchangeEvents } = economyEventsToDigestBuckets([event]);
        expect(exchangeEvents).toHaveLength(1);
        expect(exchangeEvents[0].kind).toBe('ap_for_gp_exchange');
        expect(exchangeEvents[0].importance).toBe('high');
        expect(exchangeEvents[0].evidence?.['apDelta']).toBe(50);
        expect(exchangeEvents[0].evidence?.['gpDelta']).toBe(-200);
    });
});

describe('economyEventsToDigestBuckets — bucket isolation', () => {
    it('routes each event kind to exactly one bucket', () => {
        const events: EconomyEvent[] = [
            makeEconomyEvent({ kind: 'ap_grant', apDelta: 100 }),
            makeEconomyEvent({ kind: 'gp_earned', gpDelta: 150 }),
            makeEconomyEvent({ kind: 'ap_gp_exchange', apDelta: 50, gpDelta: -200 }),
            makeEconomyEvent({ kind: 'ncri_sale', ncriId: 'ncri-x' }),
            makeEconomyEvent({ kind: 'ncri_redemption', ncriId: 'ncri-y' }),
            makeEconomyEvent({ kind: 'ap_decay', apDelta: -5 }),
        ];
        const { apEvents, gpEvents, exchangeEvents, ncriEvents } = economyEventsToDigestBuckets(events);
        expect(apEvents).toHaveLength(1); // ap_grant (ap_decay skipped)
        expect(gpEvents).toHaveLength(1); // gp_earned
        expect(exchangeEvents).toHaveLength(1); // ap_gp_exchange
        expect(ncriEvents).toHaveLength(2); // ncri_sale + ncri_redemption
        const totalBucketed = apEvents.length + gpEvents.length + exchangeEvents.length + ncriEvents.length;
        expect(totalBucketed).toBe(5); // 6 events, 1 ap_decay skipped
    });

    it('returns empty buckets for an empty events array', () => {
        const { apEvents, gpEvents, exchangeEvents, ncriEvents } = economyEventsToDigestBuckets([]);
        expect(apEvents).toHaveLength(0);
        expect(gpEvents).toHaveLength(0);
        expect(exchangeEvents).toHaveLength(0);
        expect(ncriEvents).toHaveLength(0);
    });
});

describe('economyEventsToDigestBuckets — full pipeline (S5b end-to-end)', () => {
    it('NCRI sale event flows through buckets into buildDigest().ncriEvents', () => {
        const ncriSaleEvent = makeEconomyEvent({
            kind: 'ncri_sale',
            ncriId: 'ncri-lumbridge-egg',
            note: 'Admin sold Lumbridge Egg NCRI to res:alice',
        });
        const buckets = economyEventsToDigestBuckets([ncriSaleEvent]);
        const digest = buildDigest({
            digestId: 'pipeline-test-001',
            windowStart: new Date('2026-05-29T05:50:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            ...buckets,
        });
        expect(digest.ncriEvents).toHaveLength(1);
        expect(digest.ncriEvents[0].kind).toBe('ncri_created');
        expect(digest.ncriEvents[0].evidence?.['ncriId']).toBe('ncri-lumbridge-egg');
    });

    it('NCRI redemption event flows through buckets into buildDigest().ncriEvents', () => {
        const ncriRedemptionEvent = makeEconomyEvent({
            kind: 'ncri_redemption',
            ncriId: 'ncri-abyssal-whip',
            note: 'res:bob redeemed Abyssal Whip NCRI',
        });
        const buckets = economyEventsToDigestBuckets([ncriRedemptionEvent]);
        const digest = buildDigest({
            digestId: 'pipeline-test-002',
            windowStart: new Date('2026-05-29T05:50:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            ...buckets,
        });
        expect(digest.ncriEvents).toHaveLength(1);
        expect(digest.ncriEvents[0].kind).toBe('ncri_redeemed');
    });

    it('NCRI events appear in topEvents when important enough', () => {
        const ncriSaleEvent = makeEconomyEvent({
            kind: 'ncri_sale',
            ncriId: 'ncri-007',
            note: 'High-importance NCRI sale',
        });
        const buckets = economyEventsToDigestBuckets([ncriSaleEvent]);
        const digest = buildDigest({
            digestId: 'pipeline-test-003',
            windowStart: new Date('2026-05-29T05:50:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            ...buckets,
        });
        const ncriInTop = digest.topEvents.find(e => e.kind === 'ncri_created');
        expect(ncriInTop).toBeDefined();
    });

    it('NCRI events are separate from AP and GP event buckets in the digest', () => {
        const events: EconomyEvent[] = [
            makeEconomyEvent({ kind: 'ap_grant', apDelta: 100 }),
            makeEconomyEvent({ kind: 'gp_earned', gpDelta: 200 }),
            makeEconomyEvent({ kind: 'ncri_sale', ncriId: 'ncri-xyz' }),
        ];
        const buckets = economyEventsToDigestBuckets(events);
        const digest = buildDigest({
            digestId: 'pipeline-test-004',
            windowStart: new Date('2026-05-29T05:50:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            ...buckets,
        });
        expect(digest.apEvents).toHaveLength(1);
        expect(digest.gpEvents).toHaveLength(1);
        expect(digest.ncriEvents).toHaveLength(1);
        // Verify AP≠GP≠NCRI separation (S0a vocabulary rule)
        expect(digest.apEvents[0].kind).toBe('ap_granted');
        expect(digest.gpEvents[0].kind).toBe('gp_earned');
        expect(digest.ncriEvents[0].kind).toBe('ncri_created');
    });
});
