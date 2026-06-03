import type { LettersStore } from './letters-store';
import { StandingLedger } from './standing-ledger';
import { produceStandingTierLetter } from './letters-producer';

/**
 * T0.0b — Shards-free settled-support seam (Leg D).
 *
 * On a *settled* attention grant, record patron standing + dispatch tier letters
 * WITHOUT spending the controller "Shards"/CurrencyLedger. Modeled on
 * PatronGateway.witnessAt (which already does standing+letters with no debit).
 *
 * Two fixes over the old inline onPatronSupport handler:
 *  - `onionsPerStandingPoint` scale so standing is NOT 1:1 with onions
 *    (tiers are 10/30/75; a 500-onion check-in must not instantly top-tier).
 *  - keys on `patronId` (the canonical identity — patronHandle/personId —
 *    resolved upstream), falling back to cityUserId at the call site.
 *
 * Deliberately never imports or calls any CurrencyLedger.
 */
export interface SettledSupportEvent {
    /** Canonical patron identity (patronHandle/personId), or cityUserId fallback. */
    patronId: string;
    faction: string;
    residentName: string;
    /** Raw settled onion/AP units from the grant. */
    onionsSettled: number;
    /** ISO timestamp; doubles as the letter dispatchedAt + standing entry ts. */
    ts: string;
    reason?: string;
}

export interface SettledSupportDeps {
    standingLedger: StandingLedger;
    lettersStore?: LettersStore;
    /** Onions per 1 standing point. Default 1 (legacy 1:1). Set >1 to scale down. */
    onionsPerStandingPoint?: number;
}

export interface SettledSupportResult {
    standingPointsApplied: number;
    lettersAppended: number;
}

export function recordSettledSupport(event: SettledSupportEvent, deps: SettledSupportDeps): SettledSupportResult {
    const rate = deps.onionsPerStandingPoint && deps.onionsPerStandingPoint > 0 ? deps.onionsPerStandingPoint : 1;
    const standingPoints = Math.floor(event.onionsSettled / rate);
    if (standingPoints < 1) {
        return { standingPointsApplied: 0, lettersAppended: 0 };
    }

    const result = deps.standingLedger.recordSupport(event.patronId, event.faction, standingPoints, {
        reason: event.reason ?? 'settled_support',
        ts: event.ts,
    });

    let lettersAppended = 0;
    if (deps.lettersStore && result.tiersCrossed.length > 0) {
        for (const tierCrossed of result.tiersCrossed) {
            const letter = produceStandingTierLetter({
                humanId: event.patronId,
                faction: event.faction,
                residentName: event.residentName,
                tierCrossed,
                amount: standingPoints,
                ts: event.ts,
            });
            if (letter) {
                deps.lettersStore.append(letter);
                lettersAppended++;
            }
        }
    }

    return { standingPointsApplied: standingPoints, lettersAppended };
}
