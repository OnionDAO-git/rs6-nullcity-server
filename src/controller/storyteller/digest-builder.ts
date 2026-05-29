import {
    type CityEventDigest,
    type DigestEvent,
    type ImportanceTier,
    type ResidentSnapshot,
    type StorytellerConfig,
    DEFAULT_STORYTELLER_CONFIG,
    IMPORTANCE_WEIGHT,
} from './types';

/** Monotonically-increasing counter for deterministic ref generation in tests. */
let _refCounter = 0;

export function makeRef(prefix: string): string {
    return `${prefix}-${++_refCounter}`;
}

/** Reset the ref counter — call in test beforeEach if deterministic refs are needed. */
export function resetRefCounter(): void {
    _refCounter = 0;
}

/** Merge all event buckets into one array and sort by importance descending, then timestamp ascending. */
export function sortByImportance(events: DigestEvent[]): DigestEvent[] {
    return [...events].sort((a, b) => {
        const weightDiff = IMPORTANCE_WEIGHT[b.importance] - IMPORTANCE_WEIGHT[a.importance];
        if (weightDiff !== 0) return weightDiff;
        return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
    });
}

export interface DigestBuilderInput {
    digestId: string;
    windowStart: Date;
    windowEnd: Date;
    now?: Date;
    residents: ResidentSnapshot[];
    apEvents?: DigestEvent[];
    gpEvents?: DigestEvent[];
    exchangeEvents?: DigestEvent[];
    ncriEvents?: DigestEvent[];
    goalEvents?: DigestEvent[];
    stuckEvents?: DigestEvent[];
    miscEvents?: DigestEvent[];
    config?: Partial<StorytellerConfig>;
}

/**
 * Build a CityEventDigest from pre-collected event buckets.
 * This is a pure function of its inputs — no I/O, no model calls.
 */
export function buildDigest(input: DigestBuilderInput): CityEventDigest {
    const config = { ...DEFAULT_STORYTELLER_CONFIG, ...input.config };
    const now = input.now ?? new Date();

    const apEvents = input.apEvents ?? [];
    const gpEvents = input.gpEvents ?? [];
    const exchangeEvents = input.exchangeEvents ?? [];
    const ncriEvents = input.ncriEvents ?? [];
    const goalEvents = input.goalEvents ?? [];
    const stuckEvents = input.stuckEvents ?? [];
    const miscEvents = input.miscEvents ?? [];

    // Enforce window boundary: drop events outside [windowStart, windowEnd]
    const start = input.windowStart.toISOString();
    const end = input.windowEnd.toISOString();

    function inWindow(e: DigestEvent): boolean {
        return e.ts >= start && e.ts <= end;
    }

    const allEvents = sortByImportance([
        ...apEvents.filter(inWindow),
        ...gpEvents.filter(inWindow),
        ...exchangeEvents.filter(inWindow),
        ...ncriEvents.filter(inWindow),
        ...goalEvents.filter(inWindow),
        ...stuckEvents.filter(inWindow),
        ...miscEvents.filter(inWindow),
    ]);

    const topEvents = allEvents.slice(0, config.maxResidentMentions);
    const residents = input.residents.slice(0, config.maxResidentMentions);

    const fadedResidents = residents.filter(r => r.isFaded).length;
    const lowApResidents = residents.filter(r => r.isLowAp && !r.isFaded).length;
    const activeResidents = residents.filter(r => !r.isFaded).length;

    return {
        schemaVersion: 1,
        digestId: input.digestId,
        windowStart: start,
        windowEnd: end,
        builtAt: now.toISOString(),
        apEvents: apEvents.filter(inWindow),
        gpEvents: gpEvents.filter(inWindow),
        exchangeEvents: exchangeEvents.filter(inWindow),
        ncriEvents: ncriEvents.filter(inWindow),
        goalEvents: goalEvents.filter(inWindow),
        stuckEvents: stuckEvents.filter(inWindow),
        miscEvents: miscEvents.filter(inWindow),
        topEvents,
        residents,
        systemHealth: {
            totalResidents: residents.length,
            activeResidents,
            fadedResidents,
            lowApResidents,
        },
    };
}

// ---------------------------------------------------------------------------
// Fixture factory — deterministic inputs for tests and dry-run CLI.
// Covers: low-AP resident, GP observed/earned, AP-for-GP exchange, NCRI,
//         bounded goal completion, stuck-then-recovered, quiet resident.
// ---------------------------------------------------------------------------

const BASE_TS = '2026-05-29T06:00:00.000Z';
const WINDOW_START = new Date('2026-05-29T05:50:00.000Z');
const WINDOW_END = new Date('2026-05-29T06:00:00.000Z');

function ts(offsetMs: number): string {
    return new Date(WINDOW_START.getTime() + offsetMs).toISOString();
}

function makeFixtureEvent(
    ref: string,
    kind: DigestEvent['kind'],
    residentName: string,
    note: string,
    importance: ImportanceTier,
    evidence?: Record<string, unknown>,
    tsOverride?: string,
): DigestEvent {
    return {
        ref,
        kind,
        residentName,
        ts: tsOverride ?? ts(30_000),
        note,
        importance,
        evidence,
    };
}

export interface FixtureDigest {
    digest: CityEventDigest;
    /** Named refs so tests can assert specific events were included. */
    refs: {
        apLow: string;
        gpObserved: string;
        gpEarned: string;
        exchange: string;
        ncri: string;
        goalCompleted: string;
        stuckRecovered: string;
        quietResident: string;
    };
}

/**
 * Build the canonical fixture digest used by dry-run CLI and S6a tests.
 * All timestamps are within [WINDOW_START, WINDOW_END].
 * Deterministic: same call always returns the same structure (modulo refCounter — call resetRefCounter() first).
 */
export function buildFixtureDigest(): FixtureDigest {
    const refs = {
        apLow: 'fixture-ap-low-1',
        gpObserved: 'fixture-gp-observed-1',
        gpEarned: 'fixture-gp-earned-1',
        exchange: 'fixture-exchange-1',
        ncri: 'fixture-ncri-1',
        goalCompleted: 'fixture-goal-completed-1',
        stuckRecovered: 'fixture-stuck-recovered-1',
        quietResident: 'fixture-quiet-1',
    };

    // Resident: res:alice — low AP, observed GP, exchanged AP-for-GP
    const alice: ResidentSnapshot = {
        residentName: 'res:alice',
        attention: 45,
        isLowAp: true,
        isFaded: false,
        gpObserved: 200,
        goalText: 'Find a reliable way to make 100 GP/hour and write the strategy into the Library.',
    };

    // Resident: res:bob — completed a bounded goal
    const bob: ResidentSnapshot = {
        residentName: 'res:bob',
        attention: 2800,
        isLowAp: false,
        isFaded: false,
        gpObserved: 150,
        goalText: 'Cook a meal for the chef at the Lumbridge castle.',
    };

    // Resident: res:carol — stuck then recovered
    const carol: ResidentSnapshot = {
        residentName: 'res:carol',
        attention: 1200,
        isLowAp: false,
        isFaded: false,
        gpObserved: null,
    };

    // Resident: res:dawn — quiet, no notable events
    const dawn: ResidentSnapshot = {
        residentName: 'res:dawn',
        attention: 3500,
        isLowAp: false,
        isFaded: false,
        gpObserved: 0,
    };

    const apEvents: DigestEvent[] = [
        makeFixtureEvent(
            refs.apLow,
            'ap_low',
            'res:alice',
            'Alice has only 45 AP — below survival threshold. Needs patron support.',
            'medium',
            { attentionCurrent: 45, threshold: 100 },
            ts(5_000),
        ),
    ];

    const gpEvents: DigestEvent[] = [
        makeFixtureEvent(
            refs.gpObserved,
            'gp_observed',
            'res:alice',
            'Alice observed carrying 200 GP (coin item 995, real RuneScape gold).',
            'high',
            { itemId: 995, amount: 200 },
            ts(10_000),
        ),
        makeFixtureEvent(
            refs.gpEarned,
            'gp_earned',
            'res:bob',
            'Bob earned 150 GP by picking up coins near the Lumbridge GE area.',
            'high',
            { itemId: 995, amountEarned: 150, source: 'ground_pickup' },
            ts(20_000),
        ),
    ];

    const exchangeEvents: DigestEvent[] = [
        makeFixtureEvent(
            refs.exchange,
            'ap_for_gp_exchange',
            'res:alice',
            'Alice traded 200 GP for 50 AP. Human gained GP; resident gained life-force.',
            'high',
            {
                // AP side — Null City ledger event
                apGranted: 50,
                cityUserId: 'patron:james',
                // GP side — real RuneScape evidence
                gpBurned: 200,
                gpItemId: 995,
                exchangeId: 'apgp:res:alice:fixture-001',
            },
            ts(30_000),
        ),
    ];

    const ncriEvents: DigestEvent[] = [
        makeFixtureEvent(
            refs.ncri,
            'ncri_created',
            'res:bob',
            'Admin minted NCRI "Lumbridge Egg" (item 1951). Bob is the current owner.',
            'high',
            { ncriId: 'ncri-lumbridge-egg-001', itemId: 1951, displayName: 'Lumbridge Egg', owner: 'res:bob' },
            ts(40_000),
        ),
    ];

    const goalEvents: DigestEvent[] = [
        makeFixtureEvent(
            refs.goalCompleted,
            'goal_completed',
            'res:bob',
            'Bob completed his bounded goal: delivered ingredients to the Lumbridge chef.',
            'medium',
            { goalText: 'Cook a meal for the chef at the Lumbridge castle.', evidenceSource: 'quest_complete', questId: 'cooks_assistant' },
            ts(50_000),
        ),
    ];

    const stuckEvents: DigestEvent[] = [
        makeFixtureEvent(
            refs.stuckRecovered,
            'stuck_recovered',
            'res:carol',
            'Carol was stuck at a door for 8 ticks. She recovered by taking an alternate route.',
            'medium',
            { stuckTicks: 8, resolution: 'alternate_route', targetId: 'door:lumbridge-basement' },
            ts(60_000),
        ),
    ];

    const miscEvents: DigestEvent[] = [
        makeFixtureEvent(
            refs.quietResident,
            'quiet_resident',
            'res:dawn',
            'Dawn had no notable events this window. Carrying 0 GP, attention healthy.',
            'minimal',
            { actionCount: 3 },
            ts(70_000),
        ),
    ];

    const digest = buildDigest({
        digestId: 'fixture-digest-001',
        windowStart: WINDOW_START,
        windowEnd: WINDOW_END,
        now: new Date(BASE_TS),
        residents: [alice, bob, carol, dawn],
        apEvents,
        gpEvents,
        exchangeEvents,
        ncriEvents,
        goalEvents,
        stuckEvents,
        miscEvents,
    });

    return { digest, refs };
}
