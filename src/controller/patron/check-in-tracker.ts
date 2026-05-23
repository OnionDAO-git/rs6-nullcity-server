import { CurrencyLedger } from './currency-ledger';

/** Shards granted per UTC-day check-in. Canonical from Notion `Narrative V2`. */
export const DAILY_CHECK_IN_SHARDS = 1;

/** Shards granted to the referrer on a referred human's first workshop_attendance. */
export const REFERRAL_BONUS_SHARDS = 2;

export interface CheckInOptions {
    /** ISO timestamp of the check-in. Falls back to {@link CheckInTrackerOptions.now}. */
    ts?: string;
}

export interface CheckInResult {
    credited: boolean;
    shards: number;
}

export interface RecordWorkshopAttendanceOptions {
    ts?: string;
    /** Optional human handle that introduced the attendee (referrer). */
    referredBy?: string;
}

export interface RecordWorkshopAttendanceResult {
    referralCredited: boolean;
    referrer?: string;
}

export interface CheckInTrackerOptions {
    now?: () => Date;
}

/** Serialisable snapshot for J-α-3-style persistence (later slice). */
export interface CheckInTrackerSnapshot {
    schemaVersion: 1;
    /** Sorted ascending YYYY-MM-DD UTC dates per human. */
    checkInDates: Record<string, string[]>;
    /** Map of referred human → referrer (set on first credit; subsequent attendances are no-ops). */
    referralCredited: Record<string, string>;
}

/**
 * Tracks daily check-ins and one-shot referral bonuses, crediting the
 * {@link CurrencyLedger}. Stateful in-memory; the {@link snapshot}/
 * {@link fromSnapshot} pair lets a future persistence slice (J-α-3-style)
 * round-trip to disk.
 *
 * Idempotency rules:
 * - At most one daily-check-in credit per (humanId, UTC date).
 * - At most one referral bonus per referred humanId, regardless of how
 *   many times their workshop attendance is recorded.
 * - Self-referrals (referredBy === humanId) are rejected.
 *
 * See `docs/superpowers/specs/2026-05-22-patron-loop-design.md` §J7.
 */
export class CheckInTracker {
    /** Per-human set of YYYY-MM-DD UTC dates already credited. */
    private readonly checkInDates = new Map<string, Set<string>>();
    /** Referred-human → referrer mapping, set only on first credit. */
    private readonly referralCredited = new Map<string, string>();
    private readonly now: () => Date;

    constructor(
        private readonly ledger: CurrencyLedger,
        options: CheckInTrackerOptions = {},
    ) {
        this.now = options.now ?? (() => new Date());
    }

    /** Rehydrate from a previously-snapshotted state. */
    static fromSnapshot(ledger: CurrencyLedger, snapshot: CheckInTrackerSnapshot, options: CheckInTrackerOptions = {}): CheckInTracker {
        const tracker = new CheckInTracker(ledger, options);
        for (const [humanId, dates] of Object.entries(snapshot.checkInDates)) {
            tracker.checkInDates.set(humanId, new Set(dates));
        }
        for (const [referredHuman, referrer] of Object.entries(snapshot.referralCredited)) {
            tracker.referralCredited.set(referredHuman, referrer);
        }
        return tracker;
    }

    checkIn(humanId: string, options: CheckInOptions = {}): CheckInResult {
        const ts = this.resolveTs(options.ts);
        const date = toUtcDate(ts);
        const credited = this.checkInDates.get(humanId) ?? new Set<string>();

        if (credited.has(date)) {
            return { credited: false, shards: 0 };
        }

        this.ledger.credit(humanId, DAILY_CHECK_IN_SHARDS, { reason: 'daily-check-in', ts });
        credited.add(date);
        this.checkInDates.set(humanId, credited);
        return { credited: true, shards: DAILY_CHECK_IN_SHARDS };
    }

    recordWorkshopAttendance(humanId: string, options: RecordWorkshopAttendanceOptions = {}): RecordWorkshopAttendanceResult {
        const { referredBy } = options;
        if (!referredBy || referredBy === humanId) {
            return { referralCredited: false };
        }
        if (this.referralCredited.has(humanId)) {
            return { referralCredited: false, referrer: this.referralCredited.get(humanId) };
        }

        const ts = this.resolveTs(options.ts);
        this.ledger.credit(referredBy, REFERRAL_BONUS_SHARDS, {
            reason: `referral-bonus-for-${humanId}`,
            ts,
        });
        this.referralCredited.set(humanId, referredBy);
        return { referralCredited: true, referrer: referredBy };
    }

    snapshot(): CheckInTrackerSnapshot {
        const checkInDates: Record<string, string[]> = {};
        for (const [humanId, dates] of this.checkInDates.entries()) {
            checkInDates[humanId] = Array.from(dates).sort();
        }
        const referralCredited: Record<string, string> = {};
        for (const [referredHuman, referrer] of this.referralCredited.entries()) {
            referralCredited[referredHuman] = referrer;
        }
        return { schemaVersion: 1, checkInDates, referralCredited };
    }

    private resolveTs(ts: string | undefined): string {
        return ts ?? this.now().toISOString();
    }
}

function toUtcDate(iso: string): string {
    return iso.slice(0, 10); // YYYY-MM-DD from any ISO 8601 string starting with the date
}
