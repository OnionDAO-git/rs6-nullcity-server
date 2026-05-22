/**
 * G4 trading verbs — typed action catalog + preconditions + safety.
 *
 * Spec: `docs/superpowers/specs/2026-05-22-smarter-behavior-design.md` § G4.
 *
 * This module is the kernel-level contract for resident trade interactions.
 * It owns four responsibilities:
 *
 *   1. **Typed action constructors.** `makeTradeRequestAction`,
 *      `makeTradeOfferItemAction`, `makeTradeAcceptAction`, and
 *      `makeTradeDeclineAction` produce `AgentAction`-compatible payloads
 *      addressed by a controller-friendly `TradeTarget` (residentId xor
 *      playerHandle xor both). The server-side `ActorRef` form lives in
 *      `engine/world/actor/resident/action/agent-action.ts`; we deliberately
 *      keep the controller-facing form thinner so brain/body code doesn't
 *      need to fabricate a full `ActorRef` to express intent.
 *
 *   2. **Preconditions.** `canRequestTrade`, `canOfferItem`, `canAcceptTrade`,
 *      and `canDeclineTrade` are pure `{ok, reason}` checks. They are the
 *      *only* place new "why did the trade fail" reason codes should be
 *      introduced. The reaction layer (and any future SPARK module) should
 *      consult these before submitting a trade action, so the agent can
 *      narrate `"That's not a fair trade — I'd need more."` rather than
 *      silently letting the engine bounce the action.
 *
 *   3. **TradeState lifecycle.** A small finite-state machine over the
 *      per-resident trade slot. The kernel/runtime is responsible for
 *      *storing* `TradeState` on `RuntimeState`; this module exports the
 *      pure transition function. Illegal transitions are no-ops (return
 *      prior state) so the state machine never throws.
 *
 *   4. **`tradeSafetyPredicate`.** The "patrons don't control residents"
 *      invariant. Even when a trusted human asks for an item, the resident
 *      decides whether to give it. This predicate refuses unsafe trades —
 *      strangers below the standing threshold, currency-shaped items
 *      (anti-laundering), oversized offers, NPC peers, in-combat. It is
 *      intentionally separate from the preconditions above because safety
 *      is *non-negotiable*: a brain module that wants to override a
 *      precondition (e.g., proactively initiate a trade) must still pass
 *      `tradeSafetyPredicate`.
 */

import type { AgentAction } from '../transport/message-codecs';

// =============================================================================
// 1. Typed action constructors
// =============================================================================

/** Controller-side trade target. Either residentId or playerHandle MUST be set;
 *  both may be set when the caller knows the player handle and the resident id
 *  of the same actor (e.g., a resident-as-player in Null City). */
export interface TradeTarget {
    residentId?: string;
    playerHandle?: string;
}

export interface TradeRequestAction {
    kind: 'trade_request';
    cause?: string;
    target: TradeTarget;
}

export interface TradeOfferItemAction {
    kind: 'trade_offer_item';
    cause?: string;
    itemId: number;
    quantity: number;
    slot?: number;
}

export interface TradeAcceptAction {
    kind: 'trade_accept';
    cause?: string;
}

/** Reason codes a polite decline may carry. Free-form strings are allowed for
 *  forward-compat with new refusal modes; the listed ones are the canonical
 *  set the rest of the kernel reads back. */
export type TradeDeclineReason = 'unfair' | 'no_target' | 'cancelled' | string;

export interface TradeDeclineAction {
    kind: 'trade_decline';
    cause?: string;
    reason?: TradeDeclineReason;
}

export type AnyTradeAction = TradeRequestAction | TradeOfferItemAction | TradeAcceptAction | TradeDeclineAction;

/** Construct a trade_request action. */
export function makeTradeRequestAction(target: TradeTarget, options: { cause?: string } = {}): TradeRequestAction & AgentAction {
    const payload: TradeRequestAction = { kind: 'trade_request', target: normalizeTarget(target) };
    if (options.cause !== undefined) {
        payload.cause = options.cause;
    }
    return payload as TradeRequestAction & AgentAction;
}

/** Construct a trade_offer_item action. */
export function makeTradeOfferItemAction(options: {
    itemId: number;
    quantity: number;
    slot?: number;
    cause?: string;
}): TradeOfferItemAction & AgentAction {
    const payload: TradeOfferItemAction = {
        kind: 'trade_offer_item',
        itemId: options.itemId,
        quantity: options.quantity,
    };
    if (options.slot !== undefined) {
        payload.slot = options.slot;
    }
    if (options.cause !== undefined) {
        payload.cause = options.cause;
    }
    return payload as TradeOfferItemAction & AgentAction;
}

/** Construct a trade_accept action. */
export function makeTradeAcceptAction(options: { cause?: string } = {}): TradeAcceptAction & AgentAction {
    const payload: TradeAcceptAction = { kind: 'trade_accept' };
    if (options.cause !== undefined) {
        payload.cause = options.cause;
    }
    return payload as TradeAcceptAction & AgentAction;
}

/** Construct a trade_decline action. */
export function makeTradeDeclineAction(
    options: { reason?: TradeDeclineReason; cause?: string } = {},
): TradeDeclineAction & AgentAction {
    const payload: TradeDeclineAction = { kind: 'trade_decline' };
    if (options.reason !== undefined) {
        payload.reason = options.reason;
    }
    if (options.cause !== undefined) {
        payload.cause = options.cause;
    }
    return payload as TradeDeclineAction & AgentAction;
}

function normalizeTarget(target: TradeTarget): TradeTarget {
    const normalized: TradeTarget = {};
    if (target.residentId !== undefined) {
        normalized.residentId = target.residentId;
    }
    if (target.playerHandle !== undefined) {
        normalized.playerHandle = target.playerHandle;
    }
    return normalized;
}

// =============================================================================
// 2. Preconditions
// =============================================================================

export type Precondition = { ok: true } | { ok: false; reason: string };

export interface TradeInventoryItem {
    itemId: number;
    key?: string;
    amount: number;
}

export interface TradeActorView {
    id: string;
    kind: 'player' | 'npc' | 'resident';
    name?: string;
    position: { x: number; y: number; level?: number };
    distance?: number;
}

export interface TradePerceptionView {
    visibleActors: TradeActorView[];
    selfPosition: { x: number; y: number; level?: number };
    inCombat: boolean;
    /** Fraction in [0, 1]. Values < 0.2 indicate critical HP. */
    hpFraction: number;
}

export interface TradeRuntimeView {
    tradeState: TradeState;
    /** Current tick — used by cooldown-aware predicates. */
    tick: number;
}

/** Trade interaction range. Mirrors the engine's `TRADE_REQUEST_RANGE = 1` but
 *  loosened to 2 to give the brain a tick to walk in if the target is adjacent
 *  diagonally. Walk-in is the body's responsibility; this predicate only
 *  asserts the target is close enough that an approach is feasible. */
export const TRADE_INTERACTION_RANGE = 2;

/** Minimum HP fraction below which trading is busy_higher_priority_goal. */
export const TRADE_CRITICAL_HP_THRESHOLD = 0.2;

/** Default value cap per offer. Coin-equivalents — see `DEFAULT_ITEM_VALUE_TABLE`. */
export const TRADE_MAX_OFFER_VALUE = 500;

/** Standing threshold (0..100) below which a non-handle peer is a stranger. */
export const TRADE_STRANGER_STANDING_THRESHOLD = 25;

export function canRequestTrade(
    perception: TradePerceptionView,
    state: TradeRuntimeView,
    target: TradeTarget,
): Precondition {
    if (state.tradeState !== 'idle') {
        return { ok: false, reason: 'already_trading' };
    }
    if (perception.inCombat) {
        return { ok: false, reason: 'in_combat' };
    }
    if (perception.hpFraction < TRADE_CRITICAL_HP_THRESHOLD) {
        return { ok: false, reason: 'busy_higher_priority_goal' };
    }

    const actor = findActorForTarget(perception.visibleActors, target);
    if (!actor) {
        return { ok: false, reason: 'target_not_visible' };
    }

    const dist = actorDistance(actor, perception.selfPosition);
    if (dist > TRADE_INTERACTION_RANGE) {
        return { ok: false, reason: 'target_too_far' };
    }

    return { ok: true };
}

export function canOfferItem(
    inventory: ReadonlyArray<TradeInventoryItem | null>,
    itemId: number,
    quantity: number,
    slot?: number,
): Precondition {
    if (!Number.isFinite(quantity) || quantity <= 0) {
        return { ok: false, reason: 'invalid_quantity' };
    }

    if (slot !== undefined) {
        if (slot < 0 || slot >= inventory.length) {
            return { ok: false, reason: 'slot_empty' };
        }
        const inSlot = inventory[slot];
        if (!inSlot) {
            return { ok: false, reason: 'slot_empty' };
        }
        if (inSlot.itemId !== itemId) {
            return { ok: false, reason: 'slot_item_mismatch' };
        }
        if (inSlot.amount < quantity) {
            return { ok: false, reason: 'insufficient_quantity' };
        }
        return { ok: true };
    }

    let totalOwned = 0;
    let seen = false;
    for (const entry of inventory) {
        if (entry && entry.itemId === itemId) {
            totalOwned += entry.amount;
            seen = true;
        }
    }
    if (!seen) {
        return { ok: false, reason: 'item_not_in_inventory' };
    }
    if (totalOwned < quantity) {
        return { ok: false, reason: 'insufficient_quantity' };
    }
    return { ok: true };
}

export function canAcceptTrade(state: TradeRuntimeView): Precondition {
    switch (state.tradeState) {
        case 'idle':
            return { ok: false, reason: 'no_active_trade' };
        case 'awaiting_response':
            return { ok: false, reason: 'awaiting_response' };
        case 'in_progress':
            return { ok: true };
        case 'completed':
        case 'cancelled':
            return { ok: false, reason: 'trade_already_resolved' };
    }
}

export function canDeclineTrade(state: TradeRuntimeView): Precondition {
    switch (state.tradeState) {
        case 'idle':
            return { ok: false, reason: 'no_active_trade' };
        case 'awaiting_response':
        case 'in_progress':
            return { ok: true };
        case 'completed':
        case 'cancelled':
            return { ok: false, reason: 'trade_already_resolved' };
    }
}

function findActorForTarget(actors: TradeActorView[], target: TradeTarget): TradeActorView | undefined {
    for (const actor of actors) {
        if (target.residentId && actor.id === target.residentId) {
            return actor;
        }
        if (
            target.playerHandle &&
            actor.kind === 'player' &&
            actor.name &&
            actor.name.toLowerCase() === target.playerHandle.toLowerCase()
        ) {
            return actor;
        }
    }
    return undefined;
}

function actorDistance(actor: TradeActorView, from: { x: number; y: number }): number {
    if (typeof actor.distance === 'number') {
        return actor.distance;
    }
    return Math.max(Math.abs(actor.position.x - from.x), Math.abs(actor.position.y - from.y));
}

// =============================================================================
// 3. TradeState lifecycle (finite state machine)
// =============================================================================

export type TradeState = 'idle' | 'awaiting_response' | 'in_progress' | 'completed' | 'cancelled';

export type TradeStateEvent =
    | { kind: 'request_sent' }
    | { kind: 'incoming_request' }
    | { kind: 'partner_responded' }
    | { kind: 'accept_confirmed' }
    | { kind: 'declined' }
    | { kind: 'partner_left' }
    | { kind: 'reset' };

export function initialTradeState(): TradeState {
    return 'idle';
}

export function tradeStateTransition(state: TradeState, event: TradeStateEvent): TradeState {
    switch (event.kind) {
        case 'request_sent':
            return state === 'idle' ? 'awaiting_response' : state;
        case 'incoming_request':
            return state === 'idle' ? 'in_progress' : state;
        case 'partner_responded':
            return state === 'awaiting_response' ? 'in_progress' : state;
        case 'accept_confirmed':
            return state === 'in_progress' ? 'completed' : state;
        case 'declined':
            return state === 'awaiting_response' || state === 'in_progress' ? 'cancelled' : state;
        case 'partner_left':
            return state === 'awaiting_response' || state === 'in_progress' ? 'cancelled' : state;
        case 'reset':
            return 'idle';
    }
}

// =============================================================================
// 4. Safety predicate (patrons don't control residents)
// =============================================================================

export interface TradeSafetySoul {
    /** Handles the soul author has explicitly trusted (legacy SOUL field). */
    trustedHandles: ReadonlyArray<string>;
    /** Standing below which a non-handle peer is treated as a stranger. */
    strangerStandingThreshold: number;
    /** Per-offer value cap (coin-equivalents). */
    maxOfferValue: number;
}

export interface TradeSafetyTarget {
    actor: { id: string; kind: 'player' | 'npc' | 'resident'; name?: string; position: { x: number; y: number; level?: number } };
    /** Standing earned through prior interaction. Undefined = unknown. */
    standing?: number;
    /** Items the target has currently offered (may be empty if no offer yet). */
    offeredItems: ReadonlyArray<TradeInventoryItem>;
}

export type TradeSafetyResult =
    | { ok: true; trustTier: 'trusted_handle' | 'earned_standing' }
    | { ok: false; reason: TradeSafetyReason };

export type TradeSafetyReason =
    | 'npc_not_tradable'
    | 'in_combat'
    | 'stranger_below_standing_threshold'
    | 'offer_value_exceeds_cap'
    | 'currency_offers_refused';

/** Patterns matching currency-shaped item keys. Coins, blood-money, tokens,
 *  Null City Shards — anything that smells like a fungible store of value
 *  the resident shouldn't be ferrying around for a human. */
export const CURRENCY_ITEM_IDS: ReadonlySet<number> = new Set([
    995, // gp / coins (RS canonical)
]);
export const CURRENCY_KEY_PATTERN = /\b(coins?|gp|shards?|blood_?money|tokens?)\b/i;

/** Static value table (coin-equivalents). Deliberately small — extend through
 *  pull requests, not silent inflation. Items not in the table value 0. */
export const DEFAULT_ITEM_VALUE_TABLE: ReadonlyMap<number, number> = new Map<number, number>([
    [1511, 2], // normal logs
    [1521, 5], // oak logs
    [1519, 12], // willow logs
    [1517, 25], // maple logs
    [590, 20], // tinderbox
    [526, 1], // bones
    [528, 2], // burnt bones
    [317, 3], // raw shrimp
    [315, 5], // cooked shrimp
    [321, 4], // raw anchovies
    [319, 6], // cooked anchovies
    [303, 5], // small fishing net
    [1351, 16], // bronze axe
    [1349, 40], // iron axe
    [1353, 75], // steel axe
]);

export function estimateItemValue(
    item: { itemId: number; amount: number },
    table: ReadonlyMap<number, number> = DEFAULT_ITEM_VALUE_TABLE,
): number {
    const unit = table.get(item.itemId);
    if (unit === undefined) {
        return 0;
    }
    return unit * item.amount;
}

export function tradeSafetyPredicate(
    target: TradeSafetyTarget,
    perception: TradePerceptionView,
    soul: TradeSafetySoul,
): TradeSafetyResult {
    if (target.actor.kind === 'npc') {
        return { ok: false, reason: 'npc_not_tradable' };
    }
    if (perception.inCombat) {
        return { ok: false, reason: 'in_combat' };
    }

    for (const item of target.offeredItems) {
        if (isCurrencyItem(item)) {
            return { ok: false, reason: 'currency_offers_refused' };
        }
    }

    const totalOfferedValue = target.offeredItems.reduce((sum, item) => sum + estimateItemValue(item), 0);
    if (totalOfferedValue > soul.maxOfferValue) {
        return { ok: false, reason: 'offer_value_exceeds_cap' };
    }

    const trustedByHandle = matchesTrustedHandle(target.actor, soul.trustedHandles);
    if (trustedByHandle) {
        return { ok: true, trustTier: 'trusted_handle' };
    }

    if ((target.standing ?? -1) > soul.strangerStandingThreshold) {
        return { ok: true, trustTier: 'earned_standing' };
    }

    return { ok: false, reason: 'stranger_below_standing_threshold' };
}

function isCurrencyItem(item: TradeInventoryItem): boolean {
    if (CURRENCY_ITEM_IDS.has(item.itemId)) {
        return true;
    }
    if (item.key && CURRENCY_KEY_PATTERN.test(item.key)) {
        return true;
    }
    return false;
}

function matchesTrustedHandle(
    actor: { name?: string; id: string },
    trustedHandles: ReadonlyArray<string>,
): boolean {
    const name = actor.name?.toLowerCase();
    return trustedHandles.some(handle => {
        const lower = handle.toLowerCase();
        return name === lower || actor.id.toLowerCase() === lower || actor.id.toLowerCase() === `player:${lower}`;
    });
}
