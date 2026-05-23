import fs from 'fs';
import path from 'path';
import { CurrencyLedger, CurrencyLedgerSnapshot } from './currency-ledger';
import { StandingLedger, StandingLedgerSnapshot } from './standing-ledger';

export class PatronStore {
    private readonly currencyPath: string;
    private readonly standingPath: string;

    constructor(private readonly memoryRoot: string) {
        this.currencyPath = path.join(memoryRoot, 'patron-currency.json');
        this.standingPath = path.join(memoryRoot, 'patron-standing.json');
    }

    loadCurrency(options = {}): CurrencyLedger {
        if (!fs.existsSync(this.currencyPath)) {
            return new CurrencyLedger(options);
        }
        try {
            const raw = fs.readFileSync(this.currencyPath, 'utf8');
            const snap = JSON.parse(raw) as CurrencyLedgerSnapshot;
            return CurrencyLedger.fromSnapshot(snap, options);
        } catch {
            return new CurrencyLedger(options);
        }
    }

    saveCurrency(ledger: CurrencyLedger): void {
        fs.mkdirSync(path.dirname(this.currencyPath), { recursive: true });
        const tempPath = `${this.currencyPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(ledger.snapshot(), null, 2), 'utf8');
        fs.renameSync(tempPath, this.currencyPath);
    }

    loadStanding(options = {}): StandingLedger {
        if (!fs.existsSync(this.standingPath)) {
            return new StandingLedger(options);
        }
        try {
            const raw = fs.readFileSync(this.standingPath, 'utf8');
            const snap = JSON.parse(raw) as StandingLedgerSnapshot;
            return StandingLedger.fromSnapshot(snap, options);
        } catch {
            return new StandingLedger(options);
        }
    }

    saveStanding(ledger: StandingLedger): void {
        fs.mkdirSync(path.dirname(this.standingPath), { recursive: true });
        const tempPath = `${this.standingPath}.tmp`;
        fs.writeFileSync(tempPath, JSON.stringify(ledger.snapshot(), null, 2), 'utf8');
        fs.renameSync(tempPath, this.standingPath);
    }
}
