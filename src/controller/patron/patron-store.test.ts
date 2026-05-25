import fs from 'fs';
import os from 'os';
import path from 'path';
import { PatronStore } from './patron-store';
import { CurrencyLedger } from './currency-ledger';

describe('PatronStore', () => {
    let tmpDir: string;
    let store: PatronStore;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullcity-patron-store-'));
        store = new PatronStore(tmpDir);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe('loadCurrency', () => {
        it('returns empty ledger when file does not exist', () => {
            const ledger = store.loadCurrency();
            expect(ledger.balance('alice')).toBe(0);
        });

        it('round-trips a saved ledger', () => {
            const ledger = store.loadCurrency();
            ledger.credit('alice', 42, { reason: 'workshop' });
            store.saveCurrency(ledger);

            const reloaded = store.loadCurrency();
            expect(reloaded.balance('alice')).toBe(42);
            expect(reloaded.history('alice')).toHaveLength(1);
        });

        it('quarantines a corrupt file and returns empty ledger', () => {
            const currencyPath = path.join(tmpDir, 'patron-currency.json');
            fs.writeFileSync(currencyPath, '{not valid json{{', 'utf8');

            const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
            const ledger = store.loadCurrency();
            stderrSpy.mockRestore();

            // Fresh ledger — no data from the corrupt file
            expect(ledger.balance('alice')).toBe(0);

            // Original file has been quarantined
            expect(fs.existsSync(currencyPath)).toBe(false);
            expect(fs.existsSync(`${currencyPath}.corrupt`)).toBe(true);
        });

        it('warns to stderr when quarantining', () => {
            const currencyPath = path.join(tmpDir, 'patron-currency.json');
            fs.writeFileSync(currencyPath, 'null', 'utf8');

            const stderrLines: string[] = [];
            const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(msg => {
                stderrLines.push(String(msg));
                return true;
            });
            store.loadCurrency();
            stderrSpy.mockRestore();

            expect(stderrLines.some(l => l.includes('[PatronStore] WARN'))).toBe(true);
            expect(stderrLines.some(l => l.includes('patron-currency.json'))).toBe(true);
        });
    });

    describe('loadStanding', () => {
        it('returns empty ledger when file does not exist', () => {
            const ledger = store.loadStanding();
            expect(ledger.points('alice', 'embassy')).toBe(0);
        });

        it('round-trips a saved standing ledger', () => {
            const ledger = store.loadStanding();
            ledger.recordSupport('alice', 'embassy', 15, { reason: 'offer' });
            store.saveStanding(ledger);

            const reloaded = store.loadStanding();
            expect(reloaded.points('alice', 'embassy')).toBe(15);
        });

        it('quarantines a corrupt standing file and returns empty ledger', () => {
            const standingPath = path.join(tmpDir, 'patron-standing.json');
            fs.writeFileSync(standingPath, 'TRUNCATED', 'utf8');

            const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
            const ledger = store.loadStanding();
            stderrSpy.mockRestore();

            expect(ledger.points('alice', 'embassy')).toBe(0);
            expect(fs.existsSync(standingPath)).toBe(false);
            expect(fs.existsSync(`${standingPath}.corrupt`)).toBe(true);
        });
    });

    describe('loadCheckIn', () => {
        it('returns fresh tracker when file does not exist', () => {
            const currency = new CurrencyLedger();
            const tracker = store.loadCheckIn(currency);
            expect(tracker).toBeDefined();
        });

        it('quarantines a corrupt check-in file and returns fresh tracker', () => {
            const checkInPath = path.join(tmpDir, 'patron-check-in.json');
            fs.writeFileSync(checkInPath, '[]', 'utf8');

            const currency = new CurrencyLedger();
            const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
            const tracker = store.loadCheckIn(currency);
            stderrSpy.mockRestore();

            expect(tracker).toBeDefined();
            expect(fs.existsSync(checkInPath)).toBe(false);
            expect(fs.existsSync(`${checkInPath}.corrupt`)).toBe(true);
        });
    });
});
