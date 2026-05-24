import { z } from 'zod';

/**
 * Standing tiers per OnionDAO Notion `Narrative V2` "Design Notes & Open
 * Questions": three named tiers (Acquaintance, Ally, Officer) at 10 / 30 / 75
 * Shards. `stranger` is an internal sentinel for the "no standing yet" state
 * so {@link StandingLedger.currentTier} can return a non-null value for every
 * (human, faction) pair; it MUST NEVER reach user-facing copy — the
 * LettersProducer must skip it. Use {@link isUserFacingTier} when in doubt.
 *
 * See `docs/superpowers/specs/2026-05-22-patron-loop-design.md` §3.
 */
export const STANDING_TIERS = [
    { name: 'stranger', minPoints: 0 }, // internal sentinel; never shown to humans
    { name: 'acquaintance', minPoints: 10 }, // canonical Notion tier 1
    { name: 'ally', minPoints: 30 }, // canonical Notion tier 2
    { name: 'officer', minPoints: 75 }, // canonical Notion tier 3
] as const;

export type StandingTier = (typeof STANDING_TIERS)[number]['name'];

/** Tier-crossing outcome returned by {@link StandingLedger.recordSupport}. */
export interface RecordSupportResult {
    previousTier: StandingTier;
    currentTier: StandingTier;
    /**
     * Back-compat shortcut: the **highest** user-facing tier crossed by this
     * support, or `null` if no threshold was reached. Prefer `tiersCrossed`
     * for letter dispatch — a single support that crosses multiple thresholds
     * (e.g. stranger → ally in one big sponsor) must produce one letter per
     * crossing, not just one letter for the final tier (HD-040 / E36-F36b).
     */
    tierCrossed: StandingTier | null;
    /**
     * **Every** user-facing tier crossed by this support, in ascending order.
     * Empty when no threshold was reached. The `stranger` sentinel is never
     * included (it has `minPoints: 0`, so it can never be "crossed").
     *
     * Drives the J-δ-β-2 letter dispatcher: callers iterate this list and
     * emit one letter per element, so a patron whose first sponsor jumps them
     * from stranger to officer receives Acquaintance + Ally + Officer letters
     * in their inbox rather than just the Officer letter (HD-040 fix).
     */
    tiersCrossed: StandingTier[];
}

/** A single mutation on a (human, faction) standing pair. */
export interface StandingLedgerEntry {
    humanId: string;
    faction: string;
    amount: number;
    reason: string;
    ts: string;
}

/** Serialisable snapshot for persistence + restoration. */
export interface StandingLedgerSnapshot {
    schemaVersion: 1;
    /** Key is `${humanId}|${faction}` for stable JSON keys. */
    points: Record<string, number>;
    history: Record<string, StandingLedgerEntry[]>;
}

const standingLedgerEntrySchema = z.object({
    humanId: z.string().min(1),
    faction: z.string().min(1),
    amount: z.number().int().positive(),
    reason: z.string().min(1),
    ts: z.string().min(1),
});

export const standingLedgerSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    points: z.record(z.string(), z.number().int().nonnegative()),
    history: z.record(z.string(), z.array(standingLedgerEntrySchema)),
});

export interface StandingLedgerOptions {
    now?: () => Date;
}

export interface RecordSupportOptions {
    reason: string;
    ts?: string;
}

/**
 * In-memory ledger of (humanId, faction) standing points + history.
 *
 * Stores point totals and append-only support history per pair. The
 * accompanying {@link recordSupport} call returns a tier-crossing outcome
 * that the LettersProducer (J-δ) consumes to fire standing letters.
 *
 * Persistence (atomic JSON write) is layered in {@link J-α-3}; this file is
 * the in-memory substrate only — same shape as `currency-ledger.ts`.
 */
export class StandingLedger {
    private readonly pointsByPair = new Map<string, number>();
    private readonly historyByPair = new Map<string, StandingLedgerEntry[]>();
    private readonly now: () => Date;

    constructor(options: StandingLedgerOptions = {}) {
        this.now = options.now ?? (() => new Date());
    }

    static fromSnapshot(snapshot: StandingLedgerSnapshot, options: StandingLedgerOptions = {}): StandingLedger {
        const parsed = standingLedgerSnapshotSchema.parse(snapshot);
        const ledger = new StandingLedger(options);
        for (const [key, value] of Object.entries(parsed.points)) {
            ledger.pointsByPair.set(key, value);
        }
        for (const [key, entries] of Object.entries(parsed.history)) {
            ledger.historyByPair.set(key, [...entries]);
        }
        return ledger;
    }

    points(humanId: string, faction: string): number {
        return this.pointsByPair.get(pairKey(humanId, faction)) ?? 0;
    }

    currentTier(humanId: string, faction: string): StandingTier {
        return tierForPoints(this.points(humanId, faction));
    }

    recordSupport(humanId: string, faction: string, amount: number, options: RecordSupportOptions): RecordSupportResult {
        requirePositiveInteger(amount);
        const key = pairKey(humanId, faction);
        const previousPoints = this.pointsByPair.get(key) ?? 0;
        const previousTier = tierForPoints(previousPoints);
        const nextPoints = previousPoints + amount;
        const nextTier = tierForPoints(nextPoints);

        this.pointsByPair.set(key, nextPoints);
        this.appendHistory(key, {
            humanId,
            faction,
            amount,
            reason: options.reason,
            ts: this.resolveTs(options.ts),
        });

        // HD-040: enumerate EVERY user-facing tier crossed (not just the
        // highest). A single grant that spans multiple thresholds must surface
        // each crossing so the J-δ-β-2 dispatcher can emit one letter per
        // tier. `stranger` (minPoints: 0) is the no-standing sentinel and can
        // never be "crossed" — filtered out by `minPoints > 0`.
        const tiersCrossed: StandingTier[] = STANDING_TIERS
            .filter(t => t.minPoints > 0 && t.minPoints > previousPoints && t.minPoints <= nextPoints)
            .map(t => t.name);

        return {
            previousTier,
            currentTier: nextTier,
            tierCrossed: previousTier === nextTier ? null : nextTier,
            tiersCrossed,
        };
    }

    history(humanId: string, faction: string): readonly StandingLedgerEntry[] {
        return this.historyByPair.get(pairKey(humanId, faction)) ?? [];
    }

    snapshot(): StandingLedgerSnapshot {
        const points: Record<string, number> = {};
        for (const [key, value] of this.pointsByPair.entries()) {
            points[key] = value;
        }
        const history: Record<string, StandingLedgerEntry[]> = {};
        for (const [key, entries] of this.historyByPair.entries()) {
            history[key] = entries.map(entry => ({ ...entry }));
        }
        return { schemaVersion: 1, points, history };
    }

    private appendHistory(key: string, entry: StandingLedgerEntry): void {
        const existing = this.historyByPair.get(key);
        if (existing) {
            existing.push(entry);
        } else {
            this.historyByPair.set(key, [entry]);
        }
    }

    private resolveTs(ts: string | undefined): string {
        if (ts !== undefined) {
            return ts;
        }
        return this.now().toISOString();
    }
}

/**
 * Returns false for the `stranger` sentinel (which represents "no standing
 * yet") and true for the three named Notion tiers. The LettersProducer must
 * call this before emitting a standing-tier letter to skip the no-op
 * sentinel.
 */
export function isUserFacingTier(tier: StandingTier): boolean {
    return tier !== 'stranger';
}

function pairKey(humanId: string, faction: string): string {
    return `${humanId}|${faction}`;
}

function tierForPoints(points: number): StandingTier {
    // STANDING_TIERS is ascending; pick the last whose threshold is met.
    let current: StandingTier = STANDING_TIERS[0].name;
    for (const tier of STANDING_TIERS) {
        if (points >= tier.minPoints) {
            current = tier.name;
        }
    }
    return current;
}

function requirePositiveInteger(amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`standing support amount must be positive; got ${amount}`);
    }
    if (!Number.isInteger(amount)) {
        throw new Error(`standing support amount must be an integer; got ${amount}`);
    }
}
