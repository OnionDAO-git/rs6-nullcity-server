import {
    CURRENCY_NAME,
    CurrencyLedger,
    InsufficientBalanceError,
    type CurrencyLedgerSnapshot,
    currencyLedgerSnapshotSchema,
} from './currency-ledger';

describe('CurrencyLedger', () => {
    describe('canonical naming', () => {
        it("exports the canonical currency name 'AP' (Attention Points, updated from legacy 'Shards')", () => {
            expect(CURRENCY_NAME).toBe('AP');
        });
    });

    describe('balance + credit + debit', () => {
        it('starts every human at zero balance', () => {
            const ledger = new CurrencyLedger();
            expect(ledger.balance('alice')).toBe(0);
            expect(ledger.balance('bob')).toBe(0);
        });

        it('credits AP to a human and reflects in balance', () => {
            const ledger = new CurrencyLedger();
            ledger.credit('alice', 5, { reason: 'workshop-attendance', ts: '2026-05-23T03:00:00.000Z' });
            expect(ledger.balance('alice')).toBe(5);
        });

        it('debits AP from a human and reflects in balance', () => {
            const ledger = new CurrencyLedger();
            ledger.credit('alice', 10, { reason: 'workshop-attendance' });
            ledger.debit('alice', 3, { reason: 'mercy_infusion-to-res:agent' });
            expect(ledger.balance('alice')).toBe(7);
        });

        it('throws InsufficientBalanceError when debit exceeds balance', () => {
            const ledger = new CurrencyLedger();
            ledger.credit('alice', 2, { reason: 'workshop-attendance' });
            expect(() => ledger.debit('alice', 5, { reason: 'mercy_infusion' })).toThrow(InsufficientBalanceError);
            // Balance unchanged after failed debit.
            expect(ledger.balance('alice')).toBe(2);
        });

        it('rejects non-positive credit amounts', () => {
            const ledger = new CurrencyLedger();
            expect(() => ledger.credit('alice', 0, { reason: 'x' })).toThrow(/positive/i);
            expect(() => ledger.credit('alice', -1, { reason: 'x' })).toThrow(/positive/i);
        });

        it('rejects non-positive debit amounts', () => {
            const ledger = new CurrencyLedger();
            ledger.credit('alice', 5, { reason: 'workshop-attendance' });
            expect(() => ledger.debit('alice', 0, { reason: 'x' })).toThrow(/positive/i);
            expect(() => ledger.debit('alice', -1, { reason: 'x' })).toThrow(/positive/i);
        });

        it('rejects non-integer amounts (AP are atomic units)', () => {
            const ledger = new CurrencyLedger();
            expect(() => ledger.credit('alice', 1.5, { reason: 'x' })).toThrow(/integer/i);
            ledger.credit('alice', 5, { reason: 'workshop-attendance' });
            expect(() => ledger.debit('alice', 0.5, { reason: 'x' })).toThrow(/integer/i);
        });
    });

    describe('ledger history', () => {
        it('records every credit and debit entry with timestamp + reason', () => {
            const ledger = new CurrencyLedger();
            ledger.credit('alice', 5, { reason: 'workshop-attendance', ts: '2026-05-23T03:00:00.000Z' });
            ledger.debit('alice', 2, { reason: 'mercy_infusion-to-res:agent', ts: '2026-05-23T03:05:00.000Z' });

            const history = ledger.history('alice');
            expect(history).toHaveLength(2);
            expect(history[0]).toMatchObject({ kind: 'credit', amount: 5, reason: 'workshop-attendance', ts: '2026-05-23T03:00:00.000Z' });
            expect(history[1]).toMatchObject({
                kind: 'debit',
                amount: 2,
                reason: 'mercy_infusion-to-res:agent',
                ts: '2026-05-23T03:05:00.000Z',
            });
        });

        it('returns empty history for an unknown human', () => {
            const ledger = new CurrencyLedger();
            expect(ledger.history('never-seen')).toEqual([]);
        });

        it('assigns ts automatically when omitted', () => {
            const ledger = new CurrencyLedger({ now: () => new Date('2026-05-23T04:00:00.000Z') });
            ledger.credit('alice', 1, { reason: 'daily-checkin' });
            const [entry] = ledger.history('alice');
            expect(entry.ts).toBe('2026-05-23T04:00:00.000Z');
        });
    });

    describe('non-transferability (Notion canonical)', () => {
        it('does NOT expose a transfer() method — AP is bound to the badge holder', () => {
            const ledger = new CurrencyLedger() as unknown as Record<string, unknown>;
            expect(ledger.transfer).toBeUndefined();
        });
    });

    describe('snapshot + schema', () => {
        it('produces a snapshot that round-trips through the Zod schema', () => {
            const ledger = new CurrencyLedger();
            ledger.credit('alice', 10, { reason: 'workshop-attendance', ts: '2026-05-23T03:00:00.000Z' });
            ledger.debit('alice', 3, { reason: 'mercy_infusion', ts: '2026-05-23T03:05:00.000Z' });
            ledger.credit('bob', 2, { reason: 'daily-checkin', ts: '2026-05-23T03:10:00.000Z' });

            const snapshot = ledger.snapshot();
            const parsed = currencyLedgerSnapshotSchema.parse(snapshot);

            expect(parsed.schemaVersion).toBe(1);
            expect(parsed.balances).toEqual({ alice: 7, bob: 2 });
            expect(parsed.history.alice).toHaveLength(2);
            expect(parsed.history.bob).toHaveLength(1);
        });

        it('rehydrates from a snapshot with identical balances + history', () => {
            const snapshot: CurrencyLedgerSnapshot = {
                schemaVersion: 1,
                balances: { alice: 7 },
                history: {
                    alice: [
                        { kind: 'credit', amount: 10, reason: 'workshop-attendance', ts: '2026-05-23T03:00:00.000Z' },
                        { kind: 'debit', amount: 3, reason: 'mercy_infusion', ts: '2026-05-23T03:05:00.000Z' },
                    ],
                },
            };
            const ledger = CurrencyLedger.fromSnapshot(snapshot);
            expect(ledger.balance('alice')).toBe(7);
            expect(ledger.history('alice')).toHaveLength(2);
            expect(ledger.snapshot()).toEqual(snapshot);
        });
    });

    // S0b: prove patron-currency.json files written before the AP rename (when the
    // currency was called "Shards") still load without a migration step.
    // The persistence schema uses generic keys (schemaVersion/balances/history) so
    // "Shards" only ever appeared in human-facing display strings and reason texts,
    // not in field names — making the format forward-compatible with zero migration.
    describe('S0b legacy Shards snapshot backward compatibility', () => {
        it('loads a legacy patron-currency.json with Shards in reason strings without error', () => {
            const legacySnapshot: CurrencyLedgerSnapshot = {
                schemaVersion: 1,
                balances: { james: 15, alice: 7 },
                history: {
                    james: [
                        { kind: 'credit', amount: 10, reason: 'Shards workshop-attendance', ts: '2026-05-20T12:00:00.000Z' },
                        { kind: 'credit', amount: 5, reason: '5 Shards for referral (legacy)', ts: '2026-05-21T09:00:00.000Z' },
                    ],
                    alice: [{ kind: 'credit', amount: 7, reason: 'Shard check-in reward', ts: '2026-05-22T08:00:00.000Z' }],
                },
            };

            const ledger = CurrencyLedger.fromSnapshot(legacySnapshot);

            expect(ledger.balance('james')).toBe(15);
            expect(ledger.balance('alice')).toBe(7);
            // History is preserved verbatim — old reason strings are not rewritten
            expect(ledger.history('james')).toHaveLength(2);
            expect(ledger.history('james')[0].reason).toBe('Shards workshop-attendance');
            expect(ledger.history('alice')[0].reason).toBe('Shard check-in reward');
        });

        it('Zod schema parses a legacy snapshot containing Shards reason text without error', () => {
            const legacySnapshot = {
                schemaVersion: 1 as const,
                balances: { alice: 3 },
                history: {
                    alice: [{ kind: 'credit' as const, amount: 3, reason: 'Shards daily check-in', ts: '2026-05-22T08:00:00.000Z' }],
                },
            };

            expect(() => currencyLedgerSnapshotSchema.parse(legacySnapshot)).not.toThrow();
            const parsed = currencyLedgerSnapshotSchema.parse(legacySnapshot);
            expect(parsed.balances.alice).toBe(3);
            expect(parsed.history.alice[0].reason).toBe('Shards daily check-in');
        });

        it('new operations on a legacy ledger use AP terminology in error messages', () => {
            const legacySnapshot: CurrencyLedgerSnapshot = {
                schemaVersion: 1,
                balances: { james: 5 },
                history: {
                    james: [{ kind: 'credit', amount: 5, reason: 'Shards workshop-attendance', ts: '2026-05-20T12:00:00.000Z' }],
                },
            };

            const ledger = CurrencyLedger.fromSnapshot(legacySnapshot);

            // InsufficientBalanceError message now references AP, not Shards
            expect(() => ledger.debit('james', 100, { reason: 'too-much' })).toThrow(InsufficientBalanceError);
            expect(() => ledger.debit('james', 100, { reason: 'too-much' })).toThrow(/AP/);
        });

        it('round-trips a legacy snapshot back to identical JSON — no silent migration', () => {
            const legacySnapshot: CurrencyLedgerSnapshot = {
                schemaVersion: 1,
                balances: { bob: 12 },
                history: {
                    bob: [{ kind: 'credit', amount: 12, reason: 'Shard referral bonus', ts: '2026-05-19T10:00:00.000Z' }],
                },
            };

            const ledger = CurrencyLedger.fromSnapshot(legacySnapshot);
            // snapshot() must reproduce the exact same structure — Shards reason text preserved
            expect(ledger.snapshot()).toEqual(legacySnapshot);
        });
    });
});
