import { z } from 'zod';

/**
 * Canonical patron-currency name. From OnionDAO Notion (`Narrative V2` +
 * `Onion DAO 2026 Guide`): "Shards — the embassy's official unit of
 * attention". Non-transferable between humans; stored on the badge as
 * ESP-NOW packets in the IRL layer, mirrored here for in-game effects.
 */
export const CURRENCY_NAME = 'Shards';

/** A single mutation on a human's Shard balance. */
export interface CurrencyLedgerEntry {
    kind: 'credit' | 'debit';
    amount: number;
    reason: string;
    ts: string;
}

/** Serialisable snapshot for persistence + restoration. */
export interface CurrencyLedgerSnapshot {
    schemaVersion: 1;
    balances: Record<string, number>;
    history: Record<string, CurrencyLedgerEntry[]>;
}

const currencyLedgerEntrySchema = z.object({
    kind: z.enum(['credit', 'debit']),
    amount: z.number().int().positive(),
    reason: z.string().min(1),
    ts: z.string().min(1),
});

export const currencyLedgerSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    balances: z.record(z.string(), z.number().int().nonnegative()),
    history: z.record(z.string(), z.array(currencyLedgerEntrySchema)),
});

export interface CurrencyLedgerOptions {
    /** Injection point for deterministic timestamps in tests. */
    now?: () => Date;
}

export interface CreditDebitOptions {
    reason: string;
    ts?: string;
}

export class InsufficientBalanceError extends Error {
    constructor(
        public readonly humanId: string,
        public readonly attempted: number,
        public readonly available: number,
    ) {
        super(`Insufficient ${CURRENCY_NAME} for ${humanId}: attempted ${attempted}, available ${available}`);
        this.name = 'InsufficientBalanceError';
    }
}

/**
 * In-memory ledger of Shard balances + history per human.
 *
 * Deliberately does NOT expose a `transfer()` method: per OnionDAO Notion
 * canonical, Shards are bound to the badge holder. Inter-human flow happens
 * only via gateway-mediated `mercy_infusion` / `birth_sponsorship` events,
 * which debit one human and credit a resident's attention/standing — never
 * another human's balance.
 *
 * Persistence (file write / atomic rename) is layered in {@link J-α-3}; this
 * file is the in-memory substrate only.
 */
export class CurrencyLedger {
    private readonly balances = new Map<string, number>();
    private readonly historyByHuman = new Map<string, CurrencyLedgerEntry[]>();
    private readonly now: () => Date;

    constructor(options: CurrencyLedgerOptions = {}) {
        this.now = options.now ?? (() => new Date());
    }

    /** Construct a ledger pre-populated from a persisted snapshot. */
    static fromSnapshot(snapshot: CurrencyLedgerSnapshot, options: CurrencyLedgerOptions = {}): CurrencyLedger {
        const parsed = currencyLedgerSnapshotSchema.parse(snapshot);
        const ledger = new CurrencyLedger(options);
        for (const [humanId, balance] of Object.entries(parsed.balances)) {
            ledger.balances.set(humanId, balance);
        }
        for (const [humanId, entries] of Object.entries(parsed.history)) {
            ledger.historyByHuman.set(humanId, [...entries]);
        }
        return ledger;
    }

    balance(humanId: string): number {
        return this.balances.get(humanId) ?? 0;
    }

    credit(humanId: string, amount: number, options: CreditDebitOptions): void {
        this.requirePositiveInteger(amount);
        const next = this.balance(humanId) + amount;
        this.balances.set(humanId, next);
        this.appendHistory(humanId, { kind: 'credit', amount, reason: options.reason, ts: this.resolveTs(options.ts) });
    }

    debit(humanId: string, amount: number, options: CreditDebitOptions): void {
        this.requirePositiveInteger(amount);
        const available = this.balance(humanId);
        if (amount > available) {
            throw new InsufficientBalanceError(humanId, amount, available);
        }
        this.balances.set(humanId, available - amount);
        this.appendHistory(humanId, { kind: 'debit', amount, reason: options.reason, ts: this.resolveTs(options.ts) });
    }

    history(humanId: string): readonly CurrencyLedgerEntry[] {
        return this.historyByHuman.get(humanId) ?? [];
    }

    snapshot(): CurrencyLedgerSnapshot {
        const balances: Record<string, number> = {};
        for (const [humanId, value] of this.balances.entries()) {
            balances[humanId] = value;
        }
        const history: Record<string, CurrencyLedgerEntry[]> = {};
        for (const [humanId, entries] of this.historyByHuman.entries()) {
            history[humanId] = entries.map(entry => ({ ...entry }));
        }
        return { schemaVersion: 1, balances, history };
    }

    private appendHistory(humanId: string, entry: CurrencyLedgerEntry): void {
        const existing = this.historyByHuman.get(humanId);
        if (existing) {
            existing.push(entry);
        } else {
            this.historyByHuman.set(humanId, [entry]);
        }
    }

    private resolveTs(ts: string | undefined): string {
        if (ts !== undefined) {
            return ts;
        }
        return this.now().toISOString();
    }

    private requirePositiveInteger(amount: number): void {
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error(`${CURRENCY_NAME} amount must be positive; got ${amount}`);
        }
        if (!Number.isInteger(amount)) {
            throw new Error(`${CURRENCY_NAME} amount must be an integer; got ${amount}`);
        }
    }
}
