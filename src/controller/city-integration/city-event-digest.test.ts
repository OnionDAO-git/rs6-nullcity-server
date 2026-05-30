import { buildCityEventDigest } from './city-event-digest';
import type { EconomyEvent, EconomyEventKind } from './economy-event';
import type { GoalContract } from './goal-contract';

let seq = 0;
function ev(kind: EconomyEventKind, fields: Partial<EconomyEvent> = {}): EconomyEvent {
    seq += 1;
    return {
        schemaVersion: 1,
        id: `ev-${seq}`,
        ts: fields.ts ?? `2026-05-29T12:00:${String(seq).padStart(2, '0')}.000Z`,
        kind,
        ...fields,
    };
}

function goal(status: GoalContract['status'], overrides: Partial<GoalContract> = {}): GoalContract {
    return {
        schemaVersion: 1,
        id: overrides.id ?? `g-${Math.random()}`,
        residentName: overrides.residentName ?? 'res:hans',
        goalText: overrides.goalText ?? 'A goal.',
        status,
        createdAt: '2026-05-29T10:00:00.000Z',
        updatedAt: '2026-05-29T10:00:00.000Z',
        ...overrides,
    };
}

const GEN = '2026-05-29T18:00:00.000Z';

describe('buildCityEventDigest', () => {
    it('produces a zeroed digest for no events', () => {
        const d = buildCityEventDigest([], { generatedAt: GEN });
        expect(d.totalEvents).toBe(0);
        expect(d.apGrantedTotal).toBe(0);
        expect(d.gpEarnedTotal).toBe(0);
        expect(d.residents).toEqual([]);
        expect(d.notable).toEqual([]);
        expect(d.goals).toBeUndefined();
        expect(d.countsByKind.ap_grant).toBe(0);
        expect(Object.keys(d.countsByKind)).toHaveLength(12);
    });

    it('counts events by kind', () => {
        const d = buildCityEventDigest(
            [
                ev('ap_grant', { residentName: 'res:hans', apDelta: 5 }),
                ev('ap_grant', { residentName: 'res:pip', apDelta: 5 }),
                ev('gp_earned', { residentName: 'res:hans', gpDelta: 10 }),
            ],
            { generatedAt: GEN },
        );
        expect(d.totalEvents).toBe(3);
        expect(d.countsByKind.ap_grant).toBe(2);
        expect(d.countsByKind.gp_earned).toBe(1);
    });

    it('totals AP granted and decayed from signed deltas', () => {
        const d = buildCityEventDigest(
            [
                ev('ap_grant', { residentName: 'res:hans', apDelta: 5 }),
                ev('ap_topup', { residentName: 'res:hans', apDelta: 3 }),
                ev('ap_decay', { residentName: 'res:hans', apDelta: -2 }),
                ev('ap_fade', { residentName: 'res:hans', apDelta: -4 }),
            ],
            { generatedAt: GEN },
        );
        expect(d.apGrantedTotal).toBe(8);
        expect(d.apDecayedTotal).toBe(6);
    });

    it('totals GP earned and traded by kind', () => {
        const d = buildCityEventDigest(
            [ev('gp_earned', { residentName: 'res:hans', gpDelta: 120 }), ev('gp_traded', { residentName: 'res:hans', gpDelta: -50 })],
            { generatedAt: GEN },
        );
        expect(d.gpEarnedTotal).toBe(120);
        expect(d.gpTradedTotal).toBe(50);
    });

    it('builds per-resident rollups sorted by name', () => {
        const d = buildCityEventDigest(
            [
                ev('ap_grant', { residentName: 'res:pip', apDelta: 5 }),
                ev('ap_decay', { residentName: 'res:hans', apDelta: -2 }),
                ev('gp_earned', { residentName: 'res:hans', gpDelta: 100 }),
            ],
            { generatedAt: GEN },
        );
        expect(d.residents.map(r => r.residentName)).toEqual(['res:hans', 'res:pip']);
        const hans = d.residents.find(r => r.residentName === 'res:hans')!;
        expect(hans.apDecayed).toBe(2);
        expect(hans.apNet).toBe(-2);
        expect(hans.gpEarned).toBe(100);
        expect(hans.eventCount).toBe(2);
    });

    it('extracts notable fade, big GP, and NCRI-redemption events, sorted by ts', () => {
        const d = buildCityEventDigest(
            [
                ev('gp_earned', { residentName: 'res:hans', gpDelta: 250, ts: '2026-05-29T12:00:03.000Z' }),
                ev('ap_fade', { residentName: 'res:pip', apDelta: -1, ts: '2026-05-29T12:00:01.000Z' }),
                ev('ncri_redemption', { residentName: 'res:hans', ncriId: 'ncri-42', ts: '2026-05-29T12:00:02.000Z' }),
                ev('gp_earned', { residentName: 'res:hans', gpDelta: 5, ts: '2026-05-29T12:00:04.000Z' }), // below threshold
            ],
            { generatedAt: GEN },
        );
        expect(d.notable).toHaveLength(3);
        expect(d.notable.map(n => n.kind)).toEqual(['ap_fade', 'ncri_redemption', 'gp_earned']);
        expect(d.notable[0].summary).toContain('faded');
        expect(d.notable[1].summary).toContain('ncri-42');
        expect(d.notable[2].summary).toContain('250 GP');
    });

    it('honors a custom notableGpThreshold', () => {
        const d = buildCityEventDigest([ev('gp_earned', { residentName: 'res:hans', gpDelta: 30 })], {
            generatedAt: GEN,
            notableGpThreshold: 25,
        });
        expect(d.notable).toHaveLength(1);
    });

    it('filters events outside the window', () => {
        const d = buildCityEventDigest(
            [
                ev('ap_grant', { residentName: 'res:hans', apDelta: 5, ts: '2026-05-29T09:00:00.000Z' }),
                ev('ap_grant', { residentName: 'res:hans', apDelta: 5, ts: '2026-05-29T12:00:00.000Z' }),
                ev('ap_grant', { residentName: 'res:hans', apDelta: 5, ts: '2026-05-29T15:00:00.000Z' }),
            ],
            { generatedAt: GEN, windowStart: '2026-05-29T11:00:00.000Z', windowEnd: '2026-05-29T13:00:00.000Z' },
        );
        expect(d.totalEvents).toBe(1);
        expect(d.apGrantedTotal).toBe(5);
        expect(d.windowStart).toBe('2026-05-29T11:00:00.000Z');
        expect(d.windowEnd).toBe('2026-05-29T13:00:00.000Z');
    });

    it('summarizes goals when provided', () => {
        const d = buildCityEventDigest([], {
            generatedAt: GEN,
            goals: [
                goal('active'),
                goal('active', { residentName: 'res:pip' }),
                goal('achieved', { goalText: 'Banked 100 GP', achievedAt: '2026-05-29T16:00:00.000Z' }),
                goal('achieved', { goalText: 'Lit a fire', achievedAt: '2026-05-29T17:00:00.000Z' }),
                goal('abandoned'),
            ],
        });
        expect(d.goals).toBeDefined();
        expect(d.goals!.active).toBe(2);
        expect(d.goals!.achieved).toBe(2);
        expect(d.goals!.abandoned).toBe(1);
        // recentlyAchieved sorted by achievedAt desc
        expect(d.goals!.recentlyAchieved.map(g => g.goalText)).toEqual(['Lit a fire', 'Banked 100 GP']);
    });

    it('caps recentlyAchieved at the configured limit', () => {
        const goals = Array.from({ length: 8 }, (_, i) =>
            goal('achieved', { goalText: `g${i}`, achievedAt: `2026-05-29T1${i}:00:00.000Z` }),
        );
        const d = buildCityEventDigest([], { generatedAt: GEN, goals, recentAchievedLimit: 3 });
        expect(d.goals!.recentlyAchieved).toHaveLength(3);
    });

    it('omits goals digest when goals not provided', () => {
        const d = buildCityEventDigest([ev('ap_grant', { residentName: 'res:hans', apDelta: 5 })], { generatedAt: GEN });
        expect(d.goals).toBeUndefined();
    });

    it('ignores events with no residentName in rollups but still counts them', () => {
        const d = buildCityEventDigest([ev('gp_observed', { gpDelta: 0 })], { generatedAt: GEN });
        expect(d.totalEvents).toBe(1);
        expect(d.residents).toEqual([]);
        expect(d.countsByKind.gp_observed).toBe(1);
    });

    it('counts ncri_gift and ncri_admin_transfer but does NOT surface them as notable', () => {
        const d = buildCityEventDigest(
            [
                ev('ncri_gift', { residentName: 'res:hans', ncriId: 'ncri-7', cityUserId: 'user-bob' }),
                ev('ncri_admin_transfer', { ncriId: 'ncri-8', cityUserId: 'user-bob' }),
                ev('ncri_redemption', { residentName: 'res:hans', ncriId: 'ncri-9' }),
            ],
            { generatedAt: GEN },
        );
        expect(d.countsByKind.ncri_gift).toBe(1);
        expect(d.countsByKind.ncri_admin_transfer).toBe(1);
        expect(d.countsByKind.ncri_redemption).toBe(1);
        // notable only contains the redemption — gifts + admin transfers are intentionally quiet.
        expect(d.notable.map(n => n.kind)).toEqual(['ncri_redemption']);
    });
});
