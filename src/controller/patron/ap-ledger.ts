import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { EconomyEventLog } from '../city-integration/economy-event';

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

/**
 * Optional context for AP-ledger emission to EconomyEventLog. When the
 * ledger is configured with both an EconomyEventLog and an EconomyContext,
 * each grant/decay/top-up/fade append also emits a normalized EconomyEvent
 * so the (gated) Storyteller's CityEventDigest can ground narration in
 * real AP movement.
 */
export interface ApLedgerEconomyContext {
    /** Resident this ledger belongs to (res:<slug>). Omitted -> no event emission. */
    residentName?: string;
}

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
    private economyEventLog_?: EconomyEventLog;
    private economyContext_: ApLedgerEconomyContext;

    private constructor(events: ApEvent[], economyEventLog?: EconomyEventLog, economyContext: ApLedgerEconomyContext = {}) {
        this.events_ = events;
        this.economyEventLog_ = economyEventLog;
        this.economyContext_ = economyContext;
    }

    static empty(economyEventLog?: EconomyEventLog, economyContext: ApLedgerEconomyContext = {}): ApLedger {
        return new ApLedger([], economyEventLog, economyContext);
    }

    static fromSnapshot(
        snapshot: ApLedgerSnapshot,
        economyEventLog?: EconomyEventLog,
        economyContext: ApLedgerEconomyContext = {},
    ): ApLedger {
        const parsed = apLedgerSnapshotSchema.parse(snapshot);
        return new ApLedger([...parsed.events], economyEventLog, economyContext);
    }

    static fromEvents(events: ApEvent[], economyEventLog?: EconomyEventLog, economyContext: ApLedgerEconomyContext = {}): ApLedger {
        return new ApLedger(
            events.map(e => apEventSchema.parse(e)),
            economyEventLog,
            economyContext,
        );
    }

    /**
     * Attach the EconomyEventLog + resident context after construction.
     * Useful when the ledger is built from a stored snapshot before the
     * runtime wires up its emission seam. Pass `{ replace: true }` to
     * intentionally rewire; without it, re-attaching throws to prevent
     * silent log-target switches.
     */
    attachEconomyEventLog(
        economyEventLog: EconomyEventLog,
        economyContext: ApLedgerEconomyContext = {},
        options: { replace?: boolean } = {},
    ): void {
        if (this.economyEventLog_ !== undefined && !options.replace) {
            throw new Error('attachEconomyEventLog: already attached; pass { replace: true } to replace');
        }
        this.economyEventLog_ = economyEventLog;
        this.economyContext_ = economyContext;
    }

    append(event: ApEvent): void {
        const validated = apEventSchema.parse(event);
        this.events_.push(validated);
        this.emitEconomyEvent(validated);
    }

    private emitEconomyEvent(event: ApEvent): void {
        const log = this.economyEventLog_;
        if (!log) {
            return;
        }
        const residentName = this.economyContext_.residentName;
        if (!residentName) {
            return;
        }
        const refId = `apledger:${randomUUID()}`;
        switch (event.kind) {
            case 'grant':
                log.append({
                    kind: 'ap_grant',
                    residentName,
                    apDelta: event.amount,
                    refId,
                    ts: event.ts,
                    ...(event.cityUserId !== undefined ? { cityUserId: event.cityUserId } : {}),
                    note: `granted ${event.amount} AP (${event.source})`,
                });
                return;
            case 'decay':
                if (event.amount > 0) {
                    log.append({
                        kind: 'ap_decay',
                        residentName,
                        apDelta: -event.amount,
                        refId,
                        ts: event.ts,
                        note: `decayed ${event.amount} AP (${event.curve})`,
                    });
                }
                return;
            case 'top_up':
                log.append({
                    kind: 'ap_topup',
                    residentName,
                    apDelta: event.amount,
                    refId,
                    ts: event.ts,
                    ...(event.cityUserId !== undefined ? { cityUserId: event.cityUserId } : {}),
                    note: `topped up ${event.amount} AP (${event.source})`,
                });
                return;
            case 'fade':
                // apDelta intentionally omitted: there is no signed delta to report on a fade event.
                // The preceding ap_decay event records the final AP consumed.
                log.append({
                    kind: 'ap_fade',
                    residentName,
                    refId,
                    ts: event.ts,
                    note: 'faded (AP reached 0)',
                });
                return;
            case 'spend':
            case 'resume':
                // spend is intra-tick action cost (too granular for digest);
                // resume is a runtime-state acknowledgement (no economic value beyond top_up).
                return;
        }
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
