import { z } from 'zod';

/**
 * Append-only AP (Attention Points) event ledger for a single resident.
 *
 * Distinct from CurrencyLedger (which tracks human patron AP balances).
 * This ledger records the resident's own AP lifecycle: ticks decay it, grants
 * and top-ups raise it, and fade/resume mark life-force state transitions.
 *
 * Design invariants:
 * - Balance is always >= 0 (decay clamps at 0).
 * - `fade` is emitted by the runtime when balance reaches 0; it does not
 *   change the balance itself — the balance is already 0 at that point.
 * - `top_up` (patron saves resident) clears the faded state and adds AP.
 * - `resume` is optional post-top-up acknowledgement; same semantics as top_up
 *   for balance purposes but distinguishes "runtime resumed" from "patron paid".
 */

export type ApEventKind = 'grant' | 'spend' | 'decay' | 'top_up' | 'fade' | 'resume';

export interface ApGrantEvent {
    kind: 'grant';
    amount: number;
    source: string;
    ts: string;
    cityUserId?: string;
    idempotencyKey?: string;
}

export interface ApSpendEvent {
    kind: 'spend';
    amount: number;
    reason: string;
    ts: string;
}

export interface ApDecayEvent {
    kind: 'decay';
    amount: number;
    curve: string;
    tick: number;
    ts: string;
}

export interface ApTopUpEvent {
    kind: 'top_up';
    amount: number;
    source: string;
    ts: string;
    cityUserId?: string;
}

export interface ApFadeEvent {
    kind: 'fade';
    tick: number;
    ts: string;
}

export interface ApResumeEvent {
    kind: 'resume';
    amount: number;
    ts: string;
}

export type ApEvent = ApGrantEvent | ApSpendEvent | ApDecayEvent | ApTopUpEvent | ApFadeEvent | ApResumeEvent;

export interface ApLedgerState {
    balance: number;
    faded: boolean;
    eventCount: number;
}

const apGrantEventSchema = z.object({
    kind: z.literal('grant'),
    amount: z.number().int().positive(),
    source: z.string().min(1),
    ts: z.string().min(1),
    cityUserId: z.string().optional(),
    idempotencyKey: z.string().optional(),
});

const apSpendEventSchema = z.object({
    kind: z.literal('spend'),
    amount: z.number().int().positive(),
    reason: z.string().min(1),
    ts: z.string().min(1),
});

const apDecayEventSchema = z.object({
    kind: z.literal('decay'),
    amount: z.number().nonnegative(),
    curve: z.string().min(1),
    tick: z.number().int().nonnegative(),
    ts: z.string().min(1),
});

const apTopUpEventSchema = z.object({
    kind: z.literal('top_up'),
    amount: z.number().int().positive(),
    source: z.string().min(1),
    ts: z.string().min(1),
    cityUserId: z.string().optional(),
});

const apFadeEventSchema = z.object({
    kind: z.literal('fade'),
    tick: z.number().int().nonnegative(),
    ts: z.string().min(1),
});

const apResumeEventSchema = z.object({
    kind: z.literal('resume'),
    amount: z.number().int().nonnegative(),
    ts: z.string().min(1),
});

export const apEventSchema = z.discriminatedUnion('kind', [
    apGrantEventSchema,
    apSpendEventSchema,
    apDecayEventSchema,
    apTopUpEventSchema,
    apFadeEventSchema,
    apResumeEventSchema,
]);

export const apLedgerSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    events: z.array(apEventSchema),
});

export type ApLedgerSnapshot = z.infer<typeof apLedgerSnapshotSchema>;

/**
 * Apply a single event to mutable balance/faded state.
 * Extracted so it can be used in replay() without allocating intermediate objects.
 */
function applyEvent(balance: number, faded: boolean, event: ApEvent): { balance: number; faded: boolean } {
    switch (event.kind) {
        case 'grant':
            return { balance: balance + event.amount, faded: false };
        case 'spend':
            return { balance: Math.max(0, balance - event.amount), faded };
        case 'decay':
            return { balance: Math.max(0, balance - event.amount), faded };
        case 'top_up':
            return { balance: balance + event.amount, faded: false };
        case 'fade':
            return { balance, faded: true };
        case 'resume':
            return { balance: balance + event.amount, faded: false };
    }
}

export class ApLedger {
    private readonly events_: ApEvent[];

    private constructor(events: ApEvent[]) {
        this.events_ = events;
    }

    static empty(): ApLedger {
        return new ApLedger([]);
    }

    static fromSnapshot(snapshot: ApLedgerSnapshot): ApLedger {
        const parsed = apLedgerSnapshotSchema.parse(snapshot);
        return new ApLedger([...parsed.events]);
    }

    static fromEvents(events: ApEvent[]): ApLedger {
        return new ApLedger(events.map(e => apEventSchema.parse(e)));
    }

    append(event: ApEvent): void {
        this.events_.push(apEventSchema.parse(event));
    }

    replay(): ApLedgerState {
        let balance = 0;
        let faded = false;
        for (const event of this.events_) {
            ({ balance, faded } = applyEvent(balance, faded, event));
        }
        return { balance, faded, eventCount: this.events_.length };
    }

    balance(): number {
        return this.replay().balance;
    }

    isFaded(): boolean {
        return this.replay().faded;
    }

    allEvents(): readonly ApEvent[] {
        return this.events_;
    }

    snapshot(): ApLedgerSnapshot {
        return { schemaVersion: 1, events: this.events_.map(e => ({ ...e })) };
    }
}
