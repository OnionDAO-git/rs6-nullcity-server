import type { DecayCurve } from '../soul/soul-schema';

export interface AttentionProfile {
    startingAttention: number;
    decayCurve: DecayCurve;
}

const decayByCurve: Record<DecayCurve, number> = {
    gentle: 0.5,
    standard: 1,
    steep: 2,
};

export function initialAttention(profile?: Partial<AttentionProfile>): number {
    return profile?.startingAttention || 5000;
}

export function spendAttention(current: number, curve: DecayCurve = 'standard', multiplier = 1): number {
    return Math.max(0, current - decayByCurve[curve] * multiplier);
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

export function spendForAction(current: number, actionKind: string): number {
    return Math.max(0, current - (actionSpend[actionKind] ?? 1));
}

export function spendForLlm(current: number, outcome: keyof typeof llmSpend): number {
    return Math.max(0, current - llmSpend[outcome]);
}
