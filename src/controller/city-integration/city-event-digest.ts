import type { EconomyEvent, EconomyEventKind } from './economy-event';
import { ECONOMY_EVENT_KINDS } from './economy-event';
import type { GoalContract } from './goal-contract';

/**
 * CityEventDigest (P0 economy contract).
 *
 * A grounded evidence packet aggregated from the EconomyEvent log (and,
 * optionally, GoalContracts) over a time window. This is the structured input
 * the (gated) Storyteller will later narrate. It is PURE aggregation — no LLM,
 * no invented facts — so the Storyteller can never narrate something the
 * evidence does not contain.
 */
export interface ResidentEconomyRollup {
    residentName: string;
    apGranted: number;
    apDecayed: number;
    apNet: number;
    gpEarned: number;
    gpTraded: number;
    eventCount: number;
}

export interface NotableEvent {
    ts: string;
    kind: EconomyEventKind;
    residentName?: string;
    summary: string;
}

export interface GoalDigest {
    active: number;
    achieved: number;
    abandoned: number;
    recentlyAchieved: Array<{ residentName: string; goalText: string; achievedAt?: string }>;
}

export interface CityEventDigest {
    schemaVersion: 1;
    generatedAt: string;
    windowStart?: string;
    windowEnd?: string;
    totalEvents: number;
    countsByKind: Record<EconomyEventKind, number>;
    apGrantedTotal: number;
    apDecayedTotal: number;
    gpEarnedTotal: number;
    gpTradedTotal: number;
    residents: ResidentEconomyRollup[];
    notable: NotableEvent[];
    goals?: GoalDigest;
}

export interface BuildCityEventDigestOptions {
    generatedAt: string;
    windowStart?: string;
    windowEnd?: string;
    goals?: GoalContract[];
    /** |gpDelta| at or above this on a gp_earned/gp_traded event marks it notable. Default 100. */
    notableGpThreshold?: number;
    /** Cap on recentlyAchieved goals. Default 5. */
    recentAchievedLimit?: number;
}

function emptyCountsByKind(): Record<EconomyEventKind, number> {
    return Object.fromEntries(ECONOMY_EVENT_KINDS.map(k => [k, 0])) as Record<EconomyEventKind, number>;
}

export function buildCityEventDigest(events: EconomyEvent[], options: BuildCityEventDigestOptions): CityEventDigest {
    const { generatedAt, windowStart, windowEnd, goals, notableGpThreshold = 100, recentAchievedLimit = 5 } = options;

    // Half-open window [windowStart, windowEnd): events AT windowStart are included;
    // events AT windowEnd are excluded (prevents double-counting on scheduled boundary ticks).
    const inWindow = events.filter(event => {
        if (windowStart !== undefined && event.ts < windowStart) {
            return false;
        }
        if (windowEnd !== undefined && event.ts >= windowEnd) {
            return false;
        }
        return true;
    });

    const countsByKind = emptyCountsByKind();
    let apGrantedTotal = 0;
    let apDecayedTotal = 0;
    let gpEarnedTotal = 0;
    let gpTradedTotal = 0;
    const rollups = new Map<string, ResidentEconomyRollup>();
    const notable: NotableEvent[] = [];

    const rollupFor = (residentName: string): ResidentEconomyRollup => {
        let r = rollups.get(residentName);
        if (!r) {
            r = { residentName, apGranted: 0, apDecayed: 0, apNet: 0, gpEarned: 0, gpTraded: 0, eventCount: 0 };
            rollups.set(residentName, r);
        }
        return r;
    };

    for (const event of inWindow) {
        countsByKind[event.kind] += 1;

        const r = event.residentName !== undefined ? rollupFor(event.residentName) : undefined;
        if (r) {
            r.eventCount += 1;
        }

        if (typeof event.apDelta === 'number') {
            if (event.apDelta > 0) {
                apGrantedTotal += event.apDelta;
                if (r) r.apGranted += event.apDelta;
            } else if (event.apDelta < 0) {
                apDecayedTotal += -event.apDelta;
                if (r) r.apDecayed += -event.apDelta;
            }
            if (r) r.apNet += event.apDelta;
        }

        if (typeof event.gpDelta === 'number') {
            if (event.kind === 'gp_earned') {
                gpEarnedTotal += event.gpDelta;
                if (r) r.gpEarned += event.gpDelta;
            } else if (event.kind === 'gp_traded') {
                gpTradedTotal += Math.abs(event.gpDelta);
                if (r) r.gpTraded += Math.abs(event.gpDelta);
            }
        }

        const who = event.residentName ?? 'a resident';
        if (event.kind === 'ap_fade') {
            notable.push({ ts: event.ts, kind: event.kind, residentName: event.residentName, summary: `${who} faded (ran out of AP)` });
        } else if (event.kind === 'ncri_redemption') {
            notable.push({
                ts: event.ts,
                kind: event.kind,
                residentName: event.residentName,
                summary: `${who} redeemed NCRI ${event.ncriId ?? '(unknown)'}`,
            });
        } else if (
            (event.kind === 'gp_earned' || event.kind === 'gp_traded') &&
            typeof event.gpDelta === 'number' &&
            Math.abs(event.gpDelta) >= notableGpThreshold
        ) {
            const verb = event.kind === 'gp_earned' ? 'earned' : 'traded';
            notable.push({
                ts: event.ts,
                kind: event.kind,
                residentName: event.residentName,
                summary: `${who} ${verb} ${Math.abs(event.gpDelta)} GP`,
            });
        }
    }

    notable.sort((a, b) => a.ts.localeCompare(b.ts));
    const residents = [...rollups.values()].sort((a, b) => a.residentName.localeCompare(b.residentName));

    const digest: CityEventDigest = {
        schemaVersion: 1,
        generatedAt,
        ...(windowStart !== undefined ? { windowStart } : {}),
        ...(windowEnd !== undefined ? { windowEnd } : {}),
        totalEvents: inWindow.length,
        countsByKind,
        apGrantedTotal,
        apDecayedTotal,
        gpEarnedTotal,
        gpTradedTotal,
        residents,
        notable,
    };

    if (goals !== undefined) {
        const active = goals.filter(g => g.status === 'active').length;
        const achieved = goals.filter(g => g.status === 'achieved').length;
        const abandoned = goals.filter(g => g.status === 'abandoned').length;
        const recentlyAchieved = goals
            .filter(g => g.status === 'achieved')
            .sort((a, b) => (b.achievedAt ?? '').localeCompare(a.achievedAt ?? ''))
            .slice(0, recentAchievedLimit)
            .map(g => ({
                residentName: g.residentName,
                goalText: g.goalText,
                ...(g.achievedAt !== undefined ? { achievedAt: g.achievedAt } : {}),
            }));
        digest.goals = { active, achieved, abandoned, recentlyAchieved };
    }

    return digest;
}
