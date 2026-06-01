import type { DecayCurve } from '../soul/soul-schema';

export interface AttentionProfile {
    startingAttention: number;
    decayCurve: DecayCurve;
    /**
     * Optional lower bound for hero/anchor residents that must stay
     * "alive" through the IRL event without manual top-up. When provided,
     * `spendAttention` / `spendForAction` / `spendForLlm` clamp the
     * result to `Math.max(floor, computed)` so the resident's attention
     * never decays below this value from normal play.
     *
     * Filed in E30 / HD-008. Heroes were observed decaying from 5000 → 0
     * in <2 hours under live load (E29/F29a — Hans, Duke, Pip, Thrand
     * all died between 19:11-19:52 UTC). A floor of e.g. 5000 means
     * patron offers + idle decay still feel meaningful (attention rises
     * above the floor on engagement) but the resident never "dies from
     * being busy" — Chicago heroes can stay on-post for the full event.
     *
     * Excessive attention damage (death-from-damage etc.) is unaffected
     * because that path uses `markDeceased` in runtime-state directly,
     * not these accrual spend functions.
     */
    floor?: number;
}

export type AttentionLedgerEventKind = 'grant' | 'spend' | 'decay' | 'top_up' | 'fade';

export interface AttentionLedgerEvent {
    kind: AttentionLedgerEventKind;
    amount?: number;
}

export interface AttentionLedgerReplayStep {
    kind: AttentionLedgerEventKind;
    amount: number;
    before: number;
    after: number;
}

export interface AttentionLedgerReplay {
    currentAttention: number;
    faded: boolean;
    steps: AttentionLedgerReplayStep[];
}

const decayByCurve: Record<DecayCurve, number> = {
    gentle: 0.5,
    standard: 1,
    steep: 2,
};

export function initialAttention(profile?: Partial<AttentionProfile>): number {
    return profile?.startingAttention || 5000;
}

function clampToFloor(value: number, floor: number | undefined): number {
    const floorValue = typeof floor === 'number' && Number.isFinite(floor) && floor >= 0 ? floor : 0;
    return Math.max(floorValue, value);
}

export function spendAttention(current: number, curve: DecayCurve = 'standard', multiplier = 1, floor?: number): number {
    return clampToFloor(current - decayByCurve[curve] * multiplier, floor);
}

const actionSpend: Record<string, number> = {
    noop: 0,
    say: 0.5,
    whisper: 0.5,
    move_to: 1,
    face: 0.25,
    interact: 1,
    attack: 2,
    cast_spell: 3,
    equip: 0.5,
    unequip: 0.5,
    drop: 0.5,
    eat: 0.75,
    dialogue_continue: 0.5,
    dialogue_choice: 0.75,
    trade_request: 1,
    trade_offer_item: 1,
    trade_remove_item: 0.75,
    trade_accept_stage_1: 1,
    trade_accept_stage_2: 1,
    trade_decline: 0.5,
    logout: 0,
};

const llmSpend = {
    complete: 5,
    nooped: 1,
    aborted: 2,
    failed: 2,
};

export function spendForAction(current: number, actionKind: string, floor?: number): number {
    return clampToFloor(current - (actionSpend[actionKind] ?? 1), floor);
}

export function spendForLlm(current: number, outcome: keyof typeof llmSpend, floor?: number): number {
    return clampToFloor(current - llmSpend[outcome], floor);
}

function normalizeAmount(value: number | undefined): number {
    return Number.isFinite(value) ? Math.max(0, value as number) : 0;
}

/**
 * Replays AP lifecycle events into a deterministic attention balance.
 * This is a pure helper used by tests and replay/reporting layers.
 */
export function replayAttentionLedger(startingAttention: number, events: AttentionLedgerEvent[]): AttentionLedgerReplay {
    let currentAttention = clampToFloor(startingAttention, 0);
    let faded = currentAttention <= 0;
    const steps: AttentionLedgerReplayStep[] = [];

    for (const event of events) {
        const amount = normalizeAmount(event.amount);
        const before = currentAttention;
        switch (event.kind) {
            case 'grant':
            case 'top_up':
                currentAttention = before + amount;
                faded = currentAttention <= 0;
                break;
            case 'spend':
            case 'decay':
                currentAttention = clampToFloor(before - amount, 0);
                faded = currentAttention <= 0;
                break;
            case 'fade':
                currentAttention = 0;
                faded = true;
                break;
            default:
                break;
        }
        steps.push({
            kind: event.kind,
            amount,
            before,
            after: currentAttention,
        });
    }

    return { currentAttention, faded, steps };
}
