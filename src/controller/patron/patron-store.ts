import fs from 'fs';
import path from 'path';
import { CurrencyLedger, CurrencyLedgerSnapshot } from './currency-ledger';
import { StandingLedger, StandingLedgerSnapshot } from './standing-ledger';
import { CheckInTracker, CheckInTrackerSnapshot } from './check-in-tracker';

export class PatronStore {
    private readonly currencyPath: string;
    private readonly standingPath: string;
    private readonly checkInPath: string;

    constructor(private readonly memoryRoot: string) {
        this.currencyPath = path.join(memoryRoot, 'patron-currency.json');
        this.standingPath = path.join(memoryRoot, 'patron-standing.json');
        this.checkInPath = path.join(memoryRoot, 'patron-check-in.json');
    }

    loadCurrency(options = {}): CurrencyLedger {
        return this.loadOrQuarantine(
            this.currencyPath,
            raw => {
                const snap = JSON.parse(raw) as CurrencyLedgerSnapshot;
                return CurrencyLedger.fromSnapshot(snap, options);
            },
            () => new CurrencyLedger(options),
        );
    }

    saveCurrency(ledger: CurrencyLedger): void {
        fs.mkdirSync(path.dirname(this.currencyPath), { recursive: true });
        const tempPath = `${this.currencyPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(ledger.snapshot(), null, 2), 'utf8');
        fs.renameSync(tempPath, this.currencyPath);
    }

    loadStanding(options = {}): StandingLedger {
        return this.loadOrQuarantine(
            this.standingPath,
            raw => {
                const snap = JSON.parse(raw) as StandingLedgerSnapshot;
                return StandingLedger.fromSnapshot(snap, options);
            },
            () => new StandingLedger(options),
        );
    }

    saveStanding(ledger: StandingLedger): void {
        fs.mkdirSync(path.dirname(this.standingPath), { recursive: true });
        const tempPath = `${this.standingPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(ledger.snapshot(), null, 2), 'utf8');
        fs.renameSync(tempPath, this.standingPath);
    }

    loadCheckIn(ledger: CurrencyLedger): CheckInTracker {
        return this.loadOrQuarantine(
            this.checkInPath,
            raw => {
                const snap = JSON.parse(raw) as CheckInTrackerSnapshot;
                return CheckInTracker.fromSnapshot(ledger, snap);
            },
            () => new CheckInTracker(ledger),
        );
    }

    saveCheckIn(tracker: CheckInTracker): void {
        fs.mkdirSync(path.dirname(this.checkInPath), { recursive: true });
        const tempPath = `${this.checkInPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(tracker.snapshot(), null, 2), 'utf8');
        fs.renameSync(tempPath, this.checkInPath);
    }

    /**
     * Load a ledger file, or quarantine it if corrupt.
     *
     * When a file exists but is malformed (truncated, zero-byte, invalid JSON,
     * or fails schema validation), silently returning an empty ledger would
     * silently erase all Shard/standing history — a real risk at a live event.
     * Instead, the corrupt file is renamed to `<path>.corrupt` (preserving
     * evidence for post-incident debugging) and a warning is written to stderr
     * before returning a fresh fallback ledger.
     */
    private loadOrQuarantine<T>(filePath: string, parser: (raw: string) => T, fallback: () => T): T {
        if (!fs.existsSync(filePath)) {
            return fallback();
        }
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            return parser(raw);
        } catch (err) {
            const corruptPath = `${filePath}.corrupt`;
            try {
                fs.renameSync(filePath, corruptPath);
            } catch {
                // Quarantine rename failed (permissions, cross-device). The
                // original file stays in place and will fail to load again on
                // the next startup, giving operators a consistent signal.
            }
            const message = err instanceof Error ? err.message : String(err);
            process.stderr.write(
                `[PatronStore] WARN: corrupt ledger at ${filePath} (${message}) — quarantined to ${corruptPath}. Starting fresh.\n`,
            );
            return fallback();
        }
    }
}
