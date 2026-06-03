import {
    buildDigest,
    buildFixtureDigest,
    sortByImportance,
    resetRefCounter,
    economyEventsToDigestBuckets,
    goalContractsToDigestGoalEvents,
    rankResidentsByRelevance,
    residentRelevanceScore,
} from './digest-builder';
import { cityEventDigestSchema, IMPORTANCE_WEIGHT } from './types';
import type { DigestEvent, ResidentSnapshot } from './types';
import type { EconomyEvent } from '../city-integration/economy-event';
import type { GoalContract } from '../city-integration/goal-contract';

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

    it('counts system health from the full resident set, not the capped display list', () => {
        const residents = [
            ...Array.from({ length: 10 }, (_, i) => makeResident(`res:a${i}`, 2000, false, false)),
            ...Array.from({ length: 2 }, (_, i) => makeResident(`res:f${i}`, 0, false, true)),
            makeResident('res:low', 42, true, false),
        ];
        const digest = buildDigest({
            digestId: 'test',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents,
            apEvents: [
                ...Array.from({ length: 10 }, (_, i) => ({ ...makeEvent(`active-a${i}`, 'ap_granted', 'low'), residentName: `res:a${i}` })),
                { ...makeEvent('active-low', 'ap_low', 'medium'), residentName: 'res:low' },
            ],
            config: { maxResidentMentions: 3 },
        });

        expect(digest.residents).toHaveLength(3);
        expect(digest.systemHealth).toMatchObject({
            totalResidents: 13,
            activeResidents: 11,
            fadedResidents: 2,
            lowApResidents: 1,
        });
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
            apEvents: [
                { ...makeEvent('active-a', 'ap_granted', 'low'), residentName: 'res:a' },
                { ...makeEvent('active-b', 'ap_low', 'medium'), residentName: 'res:b' },
            ],
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

// ---------------------------------------------------------------------------
// goalContractsToDigestGoalEvents — S9b: GoalContract → DigestEvent bridge
//
// Converts GoalContract[] from GoalContractStore into goal_completed DigestEvents
// for the Storyteller digest. Only achieved contracts produce evidence; active
// and abandoned contracts are intentionally excluded so the Storyteller cannot
// invent completions from aspirational or partial-progress data.
// ---------------------------------------------------------------------------

const BASE_ACHIEVED_GOAL: GoalContract = {
    schemaVersion: 1,
    id: 'goal-test-001',
    residentName: 'res:bob',
    goalText: 'Cook a meal for the chef at the Lumbridge castle.',
    status: 'achieved',
    createdAt: '2026-05-29T01:00:00.000Z',
    updatedAt: '2026-05-29T05:00:00.000Z',
    achievedAt: '2026-05-29T05:00:00.000Z',
    achievedEvidence: 'quest_complete:cooks_assistant',
};

describe('goalContractsToDigestGoalEvents — S9b', () => {
    it('converts an achieved goal to a goal_completed DigestEvent', () => {
        const events = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL]);
        expect(events).toHaveLength(1);
        expect(events[0].kind).toBe('goal_completed');
        expect(events[0].residentName).toBe('res:bob');
        expect(events[0].ref).toBe('goal:goal-test-001');
        expect(events[0].importance).toBe('medium');
        expect(events[0].ts).toBe('2026-05-29T05:00:00.000Z');
    });

    it('includes goalId, goalText, and achievedEvidence in event evidence', () => {
        const [event] = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL]);
        expect(event.evidence?.goalId).toBe('goal-test-001');
        expect(event.evidence?.goalText).toBe('Cook a meal for the chef at the Lumbridge castle.');
        expect(event.evidence?.achievedEvidence).toBe('quest_complete:cooks_assistant');
    });

    it('includes binary completion condition when present', () => {
        const goal: GoalContract = {
            ...BASE_ACHIEVED_GOAL,
            id: 'goal-with-condition',
            completion: { condition: 'bank GP >= 100', evidenceSource: 'runtime:bank-balance' },
        };
        const [event] = goalContractsToDigestGoalEvents([goal]);
        expect(event.evidence?.condition).toBe('bank GP >= 100');
    });

    it('omits condition from evidence when goal has no binary completion', () => {
        const [event] = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL]);
        // BASE_ACHIEVED_GOAL has no completion field — condition should be absent/undefined
        expect(event.evidence?.condition).toBeUndefined();
    });

    it('skips active goals — no evidence of completion', () => {
        const activeGoal: GoalContract = {
            ...BASE_ACHIEVED_GOAL,
            id: 'goal-active',
            status: 'active',
            achievedAt: undefined,
            achievedEvidence: undefined,
        };
        expect(goalContractsToDigestGoalEvents([activeGoal])).toHaveLength(0);
    });

    it('skips abandoned goals — no evidence of completion', () => {
        const abandonedGoal: GoalContract = {
            ...BASE_ACHIEVED_GOAL,
            id: 'goal-abandoned',
            status: 'abandoned',
            achievedAt: undefined,
            achievedEvidence: undefined,
            abandonedAt: '2026-05-29T04:00:00.000Z',
            abandonedReason: 'resource shortage',
        };
        expect(goalContractsToDigestGoalEvents([abandonedGoal])).toHaveLength(0);
    });

    it('skips achieved goals missing achievedAt (malformed record)', () => {
        const malformed: GoalContract = { ...BASE_ACHIEVED_GOAL, achievedAt: undefined };
        expect(goalContractsToDigestGoalEvents([malformed])).toHaveLength(0);
    });

    it('skips achieved goals missing achievedEvidence (malformed record)', () => {
        const malformed: GoalContract = { ...BASE_ACHIEVED_GOAL, achievedEvidence: undefined };
        expect(goalContractsToDigestGoalEvents([malformed])).toHaveLength(0);
    });

    it('converts multiple achieved goals, one event per goal', () => {
        const goal2: GoalContract = {
            ...BASE_ACHIEVED_GOAL,
            id: 'goal-test-002',
            residentName: 'res:alice',
            goalText: 'Earn 100 GP per hour reliably.',
            achievedAt: '2026-05-29T04:30:00.000Z',
            achievedEvidence: 'gp_balance:102',
        };
        const events = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL, goal2]);
        expect(events).toHaveLength(2);
        expect(events[0].residentName).toBe('res:bob');
        expect(events[1].residentName).toBe('res:alice');
    });

    it('skips active goals mixed with achieved ones — only achieved goals produce events', () => {
        const activeGoal: GoalContract = {
            ...BASE_ACHIEVED_GOAL,
            id: 'goal-active-2',
            status: 'active',
            achievedAt: undefined,
            achievedEvidence: undefined,
        };
        const events = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL, activeGoal]);
        expect(events).toHaveLength(1);
        expect(events[0].ref).toBe('goal:goal-test-001');
    });

    it('returns an empty array when given an empty list', () => {
        expect(goalContractsToDigestGoalEvents([])).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// S9b integration: GoalContract → goalContractsToDigestGoalEvents → buildDigest
// → verifyDispatch — proving the full saved-resident citation chain
// ---------------------------------------------------------------------------

describe('S9b integration — GoalContract → digest → verifier', () => {
    function makeEmptyDigest() {
        return buildDigest({
            digestId: 'empty-s9b',
            windowStart: new Date('2026-05-29T04:00:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
        });
    }

    function makeS9bDispatch(publicBody: string, eventRefsUsed: string[] = []) {
        return {
            schemaVersion: 1 as const,
            dispatchId: 's9b-test-dispatch',
            digestId: 'test-digest',
            generatedAt: '2026-05-29T06:01:00.000Z',
            modelProfile: 'test',
            latencyMs: 100,
            estimatedCostUsd: null,
            inputTokens: null,
            outputTokens: null,
            publicTitle: 'City Update',
            publicBody,
            publicBullets: [],
            operatorSummary: 'Test.',
            operatorWarnings: [],
            eventRefsUsed,
            needsReview: false,
        };
    }

    it('achieved GoalContract flows into digest goalEvents as goal_completed', () => {
        const goalEvents = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL]);
        const digest = buildDigest({
            digestId: 's9b-integration-001',
            windowStart: new Date('2026-05-29T04:00:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            goalEvents,
        });
        expect(digest.goalEvents).toHaveLength(1);
        expect(digest.goalEvents[0].kind).toBe('goal_completed');
        expect(digest.goalEvents[0].residentName).toBe('res:bob');
    });

    it('verifier accepts goal_completed claim backed by achieved GoalContract in digest', () => {
        const { verifyDispatch } = require('./verifier') as typeof import('./verifier');
        const goalEvents = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL]);
        const digest = buildDigest({
            digestId: 's9b-integration-002',
            windowStart: new Date('2026-05-29T04:00:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            goalEvents,
        });
        const dispatch = makeS9bDispatch('Bob finished his goal and was saved to the Library.');
        const result = verifyDispatch(dispatch, digest);
        expect(result.warnings.some(w => w.includes('goal completion'))).toBe(false);
        expect(result.passed).toBe(true);
    });

    it('verifier rejects goal_completed claim when only active goals exist (no evidence)', () => {
        const { verifyDispatch } = require('./verifier') as typeof import('./verifier');
        const activeGoal: GoalContract = {
            ...BASE_ACHIEVED_GOAL,
            status: 'active',
            achievedAt: undefined,
            achievedEvidence: undefined,
        };
        const goalEvents = goalContractsToDigestGoalEvents([activeGoal]);
        expect(goalEvents).toHaveLength(0);
        const dispatch = makeS9bDispatch('Bob completed his goal today.');
        const result = verifyDispatch(dispatch, makeEmptyDigest());
        expect(result.warnings.some(w => w.includes('goal completion'))).toBe(true);
    });

    it('verifier accepts a goal ref from achieved GoalContract in eventRefsUsed', () => {
        const { verifyDispatch } = require('./verifier') as typeof import('./verifier');
        const goalEvents = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL]);
        const digest = buildDigest({
            digestId: 's9b-integration-003',
            windowStart: new Date('2026-05-29T04:00:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            goalEvents,
        });
        const goalRef = `goal:${BASE_ACHIEVED_GOAL.id}`;
        const dispatch = makeS9bDispatch('Bob achieved his goal.', [goalRef]);
        const result = verifyDispatch(dispatch, digest);
        expect(result.warnings.some(w => w.includes('unknown event ref'))).toBe(false);
        expect(result.passed).toBe(true);
    });

    it('achieved goal event appears in topEvents when it passes window filter', () => {
        const goalEvents = goalContractsToDigestGoalEvents([BASE_ACHIEVED_GOAL]);
        const digest = buildDigest({
            digestId: 's9b-integration-004',
            windowStart: new Date('2026-05-29T04:00:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            goalEvents,
        });
        const inTop = digest.topEvents.some(e => e.ref === `goal:${BASE_ACHIEVED_GOAL.id}`);
        expect(inTop).toBe(true);
    });

    it('achieved goal achieved outside the digest window does not appear in goalEvents', () => {
        const earlyGoal: GoalContract = {
            ...BASE_ACHIEVED_GOAL,
            id: 'goal-early',
            achievedAt: '2026-05-28T10:00:00.000Z', // before window
        };
        const goalEvents = goalContractsToDigestGoalEvents([earlyGoal]);
        const digest = buildDigest({
            digestId: 's9b-integration-005',
            windowStart: new Date('2026-05-29T04:00:00.000Z'),
            windowEnd: new Date('2026-05-29T06:00:00.000Z'),
            residents: [],
            goalEvents,
        });
        expect(digest.goalEvents).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// P0-S3: Resident relevance scoring and ranking (fixes alphabetical drop)
// ---------------------------------------------------------------------------

function makeResidentWithGp(name: string, opts: Partial<ResidentSnapshot> = {}): ResidentSnapshot {
    return { residentName: name, attention: 2000, isLowAp: false, isFaded: false, gpObserved: null, ...opts };
}

function makeResidentEvent(residentName: string, importance: DigestEvent['importance']): DigestEvent {
    return { ref: `${residentName}-evt`, kind: 'ap_low', residentName, ts: TS_IN, note: 'test', importance };
}

describe('residentRelevanceScore', () => {
    it('returns 0 for a resident with no events and no status flags', () => {
        const r = makeResidentWithGp('res:quiet');
        expect(residentRelevanceScore(r, [])).toBe(0);
    });

    it('adds IMPORTANCE_WEIGHT for each window event mentioning the resident', () => {
        const r = makeResidentWithGp('res:alice');
        const events: DigestEvent[] = [
            makeResidentEvent('res:alice', 'high'),   // weight 75
            makeResidentEvent('res:alice', 'medium'), // weight 50
            makeResidentEvent('res:bob', 'critical'), // not alice — ignored
        ];
        expect(residentRelevanceScore(r, events)).toBe(IMPORTANCE_WEIGHT.high + IMPORTANCE_WEIGHT.medium);
    });

    it('adds 100 for a faded resident', () => {
        const r = makeResidentWithGp('res:faded', { isFaded: true });
        expect(residentRelevanceScore(r, [])).toBe(100);
    });

    it('adds 50 for a low-AP resident (not faded)', () => {
        const r = makeResidentWithGp('res:lowap', { isLowAp: true });
        expect(residentRelevanceScore(r, [])).toBe(50);
    });

    it('does not add 50 for a faded resident (faded +100 already covers it)', () => {
        // faded=true, isLowAp=true — only +100, not +150
        const r = makeResidentWithGp('res:faded-low', { isFaded: true, isLowAp: true });
        expect(residentRelevanceScore(r, [])).toBe(100);
    });

    it('adds 10 for a resident with GP observed > 0', () => {
        const r = makeResidentWithGp('res:rich', { gpObserved: 500 });
        expect(residentRelevanceScore(r, [])).toBe(10);
    });

    it('does not add GP bonus when gpObserved is 0', () => {
        const r = makeResidentWithGp('res:broke', { gpObserved: 0 });
        expect(residentRelevanceScore(r, [])).toBe(0);
    });

    it('does not add GP bonus when gpObserved is null', () => {
        const r = makeResidentWithGp('res:unknown-gp', { gpObserved: null });
        expect(residentRelevanceScore(r, [])).toBe(0);
    });

    it('accumulates all bonuses: events + low-AP + GP', () => {
        const r = makeResidentWithGp('res:combo', { isLowAp: true, gpObserved: 200 });
        const events: DigestEvent[] = [makeResidentEvent('res:combo', 'critical')]; // +100
        // low-AP +50, GP +10, critical event +100 = 160
        expect(residentRelevanceScore(r, events)).toBe(IMPORTANCE_WEIGHT.critical + 50 + 10);
    });
});

describe('rankResidentsByRelevance', () => {
    it('does not mutate the input array', () => {
        const residents = [makeResidentWithGp('res:a'), makeResidentWithGp('res:b')];
        const original = residents.map(r => r.residentName);
        rankResidentsByRelevance(residents, []);
        expect(residents.map(r => r.residentName)).toEqual(original);
    });

    it('ranks faded resident above active resident', () => {
        const faded = makeResidentWithGp('res:faded', { isFaded: true });
        const active = makeResidentWithGp('res:active');
        const ranked = rankResidentsByRelevance([active, faded], []);
        expect(ranked[0].residentName).toBe('res:faded');
    });

    it('ranks low-AP resident above quiet resident', () => {
        const lowAp = makeResidentWithGp('res:lowap', { isLowAp: true });
        const quiet = makeResidentWithGp('res:quiet');
        const ranked = rankResidentsByRelevance([quiet, lowAp], []);
        expect(ranked[0].residentName).toBe('res:lowap');
    });

    it('ranks resident with a critical event above quiet resident', () => {
        const lead = makeResidentWithGp('res:lead');
        const quiet = makeResidentWithGp('res:quiet');
        const events: DigestEvent[] = [makeResidentEvent('res:lead', 'critical')];
        const ranked = rankResidentsByRelevance([quiet, lead], events);
        expect(ranked[0].residentName).toBe('res:lead');
    });

    it('preserves relative order for equal-score residents', () => {
        const a = makeResidentWithGp('res:a');
        const b = makeResidentWithGp('res:b');
        const ranked = rankResidentsByRelevance([a, b], []);
        // both score 0 — stable sort preserves original order
        expect(ranked[0].residentName).toBe('res:a');
        expect(ranked[1].residentName).toBe('res:b');
    });

    it('puts the resident with the most important events first across a mixed list', () => {
        const alice = makeResidentWithGp('res:alice');
        const bob = makeResidentWithGp('res:bob');
        const carol = makeResidentWithGp('res:carol', { isFaded: true });
        const dawn = makeResidentWithGp('res:dawn', { isLowAp: true });
        const events: DigestEvent[] = [
            makeResidentEvent('res:alice', 'high'),   // +75
            makeResidentEvent('res:bob', 'low'),      // +25
        ];
        // carol: +100 (faded), dawn: +50 (lowAp), alice: +75 (event), bob: +25 (event)
        const ranked = rankResidentsByRelevance([alice, bob, carol, dawn], events);
        expect(ranked[0].residentName).toBe('res:carol');   // 100
        expect(ranked[1].residentName).toBe('res:alice');   // 75
        expect(ranked[2].residentName).toBe('res:dawn');    // 50
        expect(ranked[3].residentName).toBe('res:bob');     // 25
    });
});

describe('buildDigest — resident ranking (P0-S3)', () => {
    it('ranked resident with critical event appears before an alphabetically-earlier quiet resident', () => {
        // Without ranking: 'res:alice' (A) before 'res:zed' (Z).
        // With ranking: 'res:zed' has a critical event so it should rank first.
        const alice = makeResidentWithGp('res:alice');
        const zed = makeResidentWithGp('res:zed');
        const criticalEvent: DigestEvent = { ref: 'zed-crit', kind: 'resident_faded', residentName: 'res:zed', ts: TS_IN, note: 'test', importance: 'critical' };
        const digest = buildDigest({
            digestId: 'rank-test-1',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [alice, zed],
            apEvents: [criticalEvent],
        });
        expect(digest.residents[0].residentName).toBe('res:zed');
    });

    it('faded resident appears first even when passed last', () => {
        const active1 = makeResidentWithGp('res:a-active');
        const active2 = makeResidentWithGp('res:b-active');
        const faded = makeResidentWithGp('res:z-faded', { isFaded: true });
        const digest = buildDigest({
            digestId: 'rank-test-2',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [active1, active2, faded],
        });
        expect(digest.residents[0].residentName).toBe('res:z-faded');
    });

    it('maxResidentMentions cap preserves the most-relevant residents', () => {
        // 4 residents, cap = 2. The two with events should survive.
        const eventful1 = makeResidentWithGp('res:eventful-1');
        const eventful2 = makeResidentWithGp('res:eventful-2');
        const quiet1 = makeResidentWithGp('res:quiet-1');
        const quiet2 = makeResidentWithGp('res:quiet-2');
        const events: DigestEvent[] = [
            { ref: 'e1', kind: 'gp_earned', residentName: 'res:eventful-1', ts: TS_IN, note: 'x', importance: 'high' },
            { ref: 'e2', kind: 'gp_earned', residentName: 'res:eventful-2', ts: TS_IN, note: 'x', importance: 'medium' },
        ];
        const digest = buildDigest({
            digestId: 'rank-test-3',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents: [quiet1, quiet2, eventful1, eventful2],
            gpEvents: events,
            config: { maxResidentMentions: 2 },
        });
        expect(digest.residents).toHaveLength(2);
        const names = digest.residents.map(r => r.residentName);
        expect(names).toContain('res:eventful-1');
        expect(names).toContain('res:eventful-2');
    });

    it('systemHealth.totalResidents counts ALL residents, not just the ranked slice', () => {
        const residents = Array.from({ length: 10 }, (_, i) => makeResidentWithGp(`res:r${i}`));
        const digest = buildDigest({
            digestId: 'rank-test-4',
            windowStart: WIN_START,
            windowEnd: WIN_END,
            residents,
            config: { maxResidentMentions: 3 },
        });
        expect(digest.systemHealth.totalResidents).toBe(10);
        expect(digest.residents).toHaveLength(3);
    });
});
