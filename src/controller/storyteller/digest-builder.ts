import type { EconomyEvent } from '../city-integration/economy-event';
import type { GoalContract } from '../city-integration/goal-contract';
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

/**
 * Score a resident by narrative relevance:
 * - Sum of IMPORTANCE_WEIGHT for each window event that mentions them.
 * - +100 if faded (critical urgency, may need patron rescue).
 * - +50 if low AP and not faded (approaching fade).
 * - +10 if GP observed > 0 (economy signal).
 *
 * Higher score = should appear before the cap slice.
 */
export function residentRelevanceScore(resident: ResidentSnapshot, windowEvents: DigestEvent[]): number {
    let score = 0;
    for (const event of windowEvents) {
        if (event.residentName === resident.residentName) {
            score += IMPORTANCE_WEIGHT[event.importance];
        }
    }
    if (resident.isFaded) score += 100;
    else if (resident.isLowAp) score += 50;
    if (resident.gpObserved !== null && resident.gpObserved > 0) score += 10;
    return score;
}

/**
 * Rank residents by descending relevance score before the maxResidentMentions cap
 * so the most narratively important residents are never silently dropped.
 */
export function rankResidentsByRelevance(residents: ResidentSnapshot[], windowEvents: DigestEvent[]): ResidentSnapshot[] {
    return [...residents].sort((a, b) => residentRelevanceScore(b, windowEvents) - residentRelevanceScore(a, windowEvents));
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
    const residents = rankResidentsByRelevance(input.residents, allEvents).slice(0, config.maxResidentMentions);

    const fadedResidents = input.residents.filter(r => r.isFaded).length;
    const lowApResidents = input.residents.filter(r => r.isLowAp && !r.isFaded).length;
    const activeResidentNames = new Set(allEvents.map(event => event.residentName));
    const activeResidents = input.residents.filter(r => !r.isFaded && activeResidentNames.has(r.residentName)).length;

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
            totalResidents: input.residents.length,
            activeResidents,
            fadedResidents,
            lowApResidents,
        },
    };
}

// ---------------------------------------------------------------------------
// EconomyEvent → DigestEvent bucket adapter (S5b).
//
// Converts a flat EconomyEvent[] (from EconomyEventLog) into the pre-bucketed
// DigestEvent arrays that buildDigest() consumes. This is the bridge between
// the P0 economy event log and the Storyteller's grounded evidence packet.
//
// ap_decay events are skipped: they are too granular for the narrative layer
// and are already aggregated as apDecayedTotal in the CityEventDigest P0
// contract. Only structurally significant AP events (grant, topup, fade) and
// all GP/NCRI/exchange events produce DigestEvent entries.
// ---------------------------------------------------------------------------

export interface EconomyDigestBuckets {
    apEvents: DigestEvent[];
    gpEvents: DigestEvent[];
    exchangeEvents: DigestEvent[];
    ncriEvents: DigestEvent[];
}

/**
 * Convert EconomyEvent[] from EconomyEventLog into DigestEvent buckets for
 * buildDigest(). ap_decay is intentionally dropped (too granular). All other
 * kinds produce a DigestEvent in the appropriate bucket.
 *
 * NCRI flow: ncri_sale → ncriEvents (kind: ncri_created),
 *            ncri_redemption → ncriEvents (kind: ncri_redeemed).
 * This is the primary S5b bridge ensuring NCRI evidence reaches the Storyteller.
 */
export function economyEventsToDigestBuckets(events: EconomyEvent[]): EconomyDigestBuckets {
    const apEvents: DigestEvent[] = [];
    const gpEvents: DigestEvent[] = [];
    const exchangeEvents: DigestEvent[] = [];
    const ncriEvents: DigestEvent[] = [];

    for (const event of events) {
        const ref = event.id;
        const ts = event.ts;
        const residentName = event.residentName ?? 'unknown';
        const note = event.note ?? `${event.kind}`;
        const evidence: Record<string, unknown> = {};
        if (event.apDelta !== undefined) evidence['apDelta'] = event.apDelta;
        if (event.gpDelta !== undefined) evidence['gpDelta'] = event.gpDelta;
        if (event.ncriId !== undefined) evidence['ncriId'] = event.ncriId;
        if (event.refId !== undefined) evidence['refId'] = event.refId;
        if (event.cityUserId !== undefined) evidence['cityUserId'] = event.cityUserId;

        switch (event.kind) {
            case 'ap_grant':
            case 'ap_topup':
                // A patron actively supporting a resident is a notable narrative beat.
                apEvents.push({ ref, kind: 'ap_granted', residentName, ts, note, importance: 'high', evidence });
                break;
            case 'ap_fade':
                apEvents.push({ ref, kind: 'resident_faded', residentName, ts, note, importance: 'critical', evidence });
                break;
            case 'ap_decay':
                // Intentionally skipped — too granular for narrative; aggregated in CityEventDigest P0.
                break;
            case 'gp_observed':
                gpEvents.push({ ref, kind: 'gp_observed', residentName, ts, note, importance: 'high', evidence });
                break;
            case 'gp_earned':
                gpEvents.push({ ref, kind: 'gp_earned', residentName, ts, note, importance: 'high', evidence });
                break;
            case 'gp_traded':
                gpEvents.push({ ref, kind: 'gp_earned', residentName, ts, note, importance: 'high', evidence });
                break;
            case 'ap_gp_exchange':
                exchangeEvents.push({ ref, kind: 'ap_for_gp_exchange', residentName, ts, note, importance: 'high', evidence });
                break;
            case 'ncri_sale':
                // ncri_sale: admin created and sold an NCRI to a resident/owner.
                ncriEvents.push({ ref, kind: 'ncri_created', residentName, ts, note, importance: 'high', evidence });
                break;
            case 'ncri_redemption':
                // ncri_redemption: owner redeemed (consumed) the NCRI.
                ncriEvents.push({ ref, kind: 'ncri_redeemed', residentName, ts, note, importance: 'high', evidence });
                break;
        }
    }

    return { apEvents, gpEvents, exchangeEvents, ncriEvents };
}

// ---------------------------------------------------------------------------
// GoalContract → DigestEvent bridge (S9b).
//
// Converts GoalContract[] from GoalContractStore into goal_completed DigestEvents
// for the Storyteller's goalEvents bucket. Only GoalContracts with status
// 'achieved' and both achievedAt + achievedEvidence set produce evidence entries.
//
// Active and abandoned contracts are intentionally excluded: the Storyteller
// must not invent completions from aspirational or partial-progress data. This
// guard mirrors GoalContractStore.markAchieved()'s non-empty-evidence requirement.
//
// After calling this function, pass the returned array as goalEvents to
// buildDigest(). The window filter inside buildDigest will then exclude
// achievements whose achievedAt falls outside the digest window — so a "saved
// resident" whose goal was achieved weeks ago won't appear as current-window
// news unless the operator widens the window.
// ---------------------------------------------------------------------------

/**
 * Convert achieved GoalContracts into goal_completed DigestEvents for the
 * Storyteller's goalEvents bucket. Active, abandoned, or malformed contracts
 * produce no events — the Storyteller cannot cite unsupported completions.
 */
export function goalContractsToDigestGoalEvents(goals: GoalContract[]): DigestEvent[] {
    const events: DigestEvent[] = [];
    for (const goal of goals) {
        if (goal.status !== 'achieved') continue;
        if (!goal.achievedAt || !goal.achievedEvidence) continue;
        const evidence: Record<string, unknown> = {
            goalId: goal.id,
            goalText: goal.goalText,
            achievedEvidence: goal.achievedEvidence,
        };
        if (goal.completion?.condition !== undefined) {
            evidence['condition'] = goal.completion.condition;
        }
        events.push({
            ref: `goal:${goal.id}`,
            kind: 'goal_completed',
            residentName: goal.residentName,
            ts: goal.achievedAt,
            note: `${goal.residentName} achieved goal: "${goal.goalText}" (evidence: ${goal.achievedEvidence})`,
            importance: 'medium',
            evidence,
        });
    }
    return events;
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
        apGranted: string;
        gpObserved: string;
        gpEarned: string;
        exchange: string;
        ncri: string;
        goalCompleted: string;
        stuckRecovered: string;
        skillLevelUp: string;
        residentRevived: string;
        patronGift: string;
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
        apGranted: 'fixture-ap-granted-1',
        gpObserved: 'fixture-gp-observed-1',
        gpEarned: 'fixture-gp-earned-1',
        exchange: 'fixture-exchange-1',
        ncri: 'fixture-ncri-1',
        goalCompleted: 'fixture-goal-completed-1',
        stuckRecovered: 'fixture-stuck-recovered-1',
        skillLevelUp: 'fixture-skill-level-up-1',
        residentRevived: 'fixture-resident-revived-1',
        patronGift: 'fixture-patron-gift-1',
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
        makeFixtureEvent(
            refs.apGranted,
            'ap_granted',
            'res:alice',
            'Patron james granted 200 AP to Alice. Her attention is now 245.',
            'high',
            { apGranted: 200, source: 'patron_grant', patronHandle: 'james', attentionAfter: 245 },
            ts(8_000),
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
            refs.skillLevelUp,
            'skill_level_up',
            'res:bob',
            'Bob reached Firemaking level 5. His pyromancy is improving.',
            'high',
            { skill: 'Firemaking', level: 5, source: 'library.timeline' },
            ts(52_000),
        ),
        makeFixtureEvent(
            refs.residentRevived,
            'resident_revived',
            'res:carol',
            'Carol died and returned to Lumbridge. This is her second life in Null City.',
            'critical',
            { lifeIndex: 2, source: 'library.timeline' },
            ts(55_000),
        ),
        makeFixtureEvent(
            refs.patronGift,
            'patron_gift',
            'res:alice',
            'Patron james gifted AP to Alice. She now has enough attention to pursue her goal.',
            'high',
            { patronHandle: 'james', amount: 150, source: 'library.timeline' },
            ts(58_000),
        ),
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
