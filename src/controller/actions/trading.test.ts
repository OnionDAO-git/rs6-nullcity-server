/**
 * G4 trading verbs — TDD contract.
 *
 * Spec: docs/superpowers/specs/2026-05-22-smarter-behavior-design.md § G4.
 * Module under test: ./trading.ts.
 *
 * Trading is the agent's first transactional human-interaction surface. The
 * tests below assert the *invariants* the rest of the system relies on:
 *
 *   1. Typed action constructors produce schema-conformant payloads (round-
 *      trippable through JSON without losing fields).
 *   2. Preconditions are pure and return structured `{ok, reason}` results so
 *      callers can surface refusal reasons without a try/catch dance.
 *   3. `TradeState` transitions reject invalid moves (a completed trade
 *      cannot go back to in_progress, an idle trade cannot be accepted, etc.).
 *   4. `tradeSafetyPredicate` enforces the "patrons don't control residents"
 *      invariant — even when a human asks, the resident decides.
 */
import {
    canAcceptTrade,
    canDeclineTrade,
    canOfferItem,
    canRequestTrade,
    DEFAULT_ITEM_VALUE_TABLE,
    estimateItemValue,
    initialTradeState,
    makeTradeAcceptAction,
    makeTradeDeclineAction,
    makeTradeOfferItemAction,
    makeTradeRequestAction,
    tradeSafetyPredicate,
    tradeStateTransition,
    TRADE_MAX_OFFER_VALUE,
    TRADE_STRANGER_STANDING_THRESHOLD,
    type TradeInventoryItem,
    type TradePerceptionView,
    type TradeRuntimeView,
    type TradeSafetyResult,
    type TradeSafetySoul,
    type TradeSafetyTarget,
    type TradeState,
} from './trading';

describe('trading.ts — typed action constructors', () => {
    it('makeTradeRequestAction builds a payload addressed by residentId', () => {
        const action = makeTradeRequestAction({ residentId: 'res:foo' }, { cause: 'direct_chat_trade' });
        expect(action).toEqual({
            kind: 'trade_request',
            cause: 'direct_chat_trade',
            target: { residentId: 'res:foo' },
        });
    });

    it('makeTradeRequestAction builds a payload addressed by playerHandle', () => {
        const action = makeTradeRequestAction({ playerHandle: 'codex' });
        expect(action).toEqual({
            kind: 'trade_request',
            target: { playerHandle: 'codex' },
        });
    });

    it('makeTradeRequestAction supports both residentId and playerHandle when both known', () => {
        const action = makeTradeRequestAction({ residentId: 'res:foo', playerHandle: 'codex' }, { cause: 'unit' });
        expect(action.target).toEqual({ residentId: 'res:foo', playerHandle: 'codex' });
    });

    it('makeTradeOfferItemAction defaults amount to 1 when only itemId is given', () => {
        const action = makeTradeOfferItemAction({ itemId: 1511, quantity: 1 });
        expect(action).toEqual({
            kind: 'trade_offer_item',
            itemId: 1511,
            quantity: 1,
        });
    });

    it('makeTradeOfferItemAction carries quantity and optional slot+cause', () => {
        const action = makeTradeOfferItemAction({
            itemId: 1511,
            quantity: 5,
            slot: 3,
            cause: 'proactive_offer_logs',
        });
        expect(action).toEqual({
            kind: 'trade_offer_item',
            itemId: 1511,
            quantity: 5,
            slot: 3,
            cause: 'proactive_offer_logs',
        });
    });

    it('makeTradeAcceptAction emits the bare verb with optional cause', () => {
        expect(makeTradeAcceptAction()).toEqual({ kind: 'trade_accept' });
        expect(makeTradeAcceptAction({ cause: 'fair_value_accept' })).toEqual({
            kind: 'trade_accept',
            cause: 'fair_value_accept',
        });
    });

    it('makeTradeDeclineAction emits a structured decline with optional reason', () => {
        expect(makeTradeDeclineAction()).toEqual({ kind: 'trade_decline' });
        expect(makeTradeDeclineAction({ reason: 'unfair' })).toEqual({
            kind: 'trade_decline',
            reason: 'unfair',
        });
        expect(makeTradeDeclineAction({ reason: 'cancelled', cause: 'partner_left' })).toEqual({
            kind: 'trade_decline',
            reason: 'cancelled',
            cause: 'partner_left',
        });
    });

    it('round-trips all four verbs through JSON without dropping fields', () => {
        const verbs = [
            makeTradeRequestAction({ residentId: 'res:foo', playerHandle: 'codex' }, { cause: 'c' }),
            makeTradeOfferItemAction({ itemId: 1511, quantity: 6, slot: 2, cause: 'd' }),
            makeTradeAcceptAction({ cause: 'e' }),
            makeTradeDeclineAction({ reason: 'unfair', cause: 'f' }),
        ];

        for (const verb of verbs) {
            expect(JSON.parse(JSON.stringify(verb))).toEqual(verb);
        }
    });
});

describe('trading.ts — preconditions', () => {
    describe('canRequestTrade', () => {
        const baseState: TradeRuntimeView = { tradeState: 'idle', tick: 100 };

        it('accepts when a target is visible, in range, and resident is idle', () => {
            const perception: TradePerceptionView = {
                visibleActors: [{ id: 'res:foo', kind: 'resident', position: { x: 0, y: 0 }, distance: 1 }],
                selfPosition: { x: 0, y: 0 },
                inCombat: false,
                hpFraction: 1,
            };
            expect(canRequestTrade(perception, baseState, { residentId: 'res:foo' })).toEqual({ ok: true });
        });

        it('refuses when the target is not visible', () => {
            const perception: TradePerceptionView = {
                visibleActors: [],
                selfPosition: { x: 0, y: 0 },
                inCombat: false,
                hpFraction: 1,
            };
            expect(canRequestTrade(perception, baseState, { residentId: 'res:foo' })).toEqual({
                ok: false,
                reason: 'target_not_visible',
            });
        });

        it('refuses when in combat', () => {
            const perception: TradePerceptionView = {
                visibleActors: [{ id: 'res:foo', kind: 'resident', position: { x: 0, y: 0 }, distance: 1 }],
                selfPosition: { x: 0, y: 0 },
                inCombat: true,
                hpFraction: 0.9,
            };
            expect(canRequestTrade(perception, baseState, { residentId: 'res:foo' })).toEqual({
                ok: false,
                reason: 'in_combat',
            });
        });

        it('refuses when already mid-trade (state is not idle)', () => {
            const perception: TradePerceptionView = {
                visibleActors: [{ id: 'res:foo', kind: 'resident', position: { x: 0, y: 0 }, distance: 1 }],
                selfPosition: { x: 0, y: 0 },
                inCombat: false,
                hpFraction: 1,
            };
            expect(
                canRequestTrade(perception, { tradeState: 'in_progress', tick: 110 }, { residentId: 'res:foo' }),
            ).toEqual({ ok: false, reason: 'already_trading' });
        });

        it('refuses when target is out of trade range', () => {
            const perception: TradePerceptionView = {
                visibleActors: [{ id: 'res:foo', kind: 'resident', position: { x: 10, y: 0 }, distance: 10 }],
                selfPosition: { x: 0, y: 0 },
                inCombat: false,
                hpFraction: 1,
            };
            expect(canRequestTrade(perception, baseState, { residentId: 'res:foo' })).toEqual({
                ok: false,
                reason: 'target_too_far',
            });
        });

        it('refuses when HP is critically low (survival overrides trade)', () => {
            const perception: TradePerceptionView = {
                visibleActors: [{ id: 'res:foo', kind: 'resident', position: { x: 0, y: 0 }, distance: 1 }],
                selfPosition: { x: 0, y: 0 },
                inCombat: false,
                hpFraction: 0.15,
            };
            expect(canRequestTrade(perception, baseState, { residentId: 'res:foo' })).toEqual({
                ok: false,
                reason: 'busy_higher_priority_goal',
            });
        });
    });

    describe('canOfferItem', () => {
        const inventory: Array<TradeInventoryItem | null> = [
            { itemId: 1511, key: 'rs:logs', amount: 6 }, // logs
            { itemId: 590, key: 'rs:tinderbox', amount: 1 }, // tinderbox
            null,
            { itemId: 526, key: 'rs:bones', amount: 3 },
        ];

        it('accepts when item is in inventory at requested quantity', () => {
            expect(canOfferItem(inventory, 1511, 3)).toEqual({ ok: true });
        });

        it('accepts when slot is explicitly addressed and matches the itemId', () => {
            expect(canOfferItem(inventory, 1511, 1, 0)).toEqual({ ok: true });
        });

        it('refuses when item is not in inventory', () => {
            expect(canOfferItem(inventory, 999_999, 1)).toEqual({ ok: false, reason: 'item_not_in_inventory' });
        });

        it('refuses when requested quantity exceeds owned amount', () => {
            expect(canOfferItem(inventory, 1511, 50)).toEqual({ ok: false, reason: 'insufficient_quantity' });
        });

        it('refuses when slot is wrong for the itemId', () => {
            expect(canOfferItem(inventory, 1511, 1, 1)).toEqual({ ok: false, reason: 'slot_item_mismatch' });
        });

        it('refuses when slot is empty', () => {
            expect(canOfferItem(inventory, 1511, 1, 2)).toEqual({ ok: false, reason: 'slot_empty' });
        });

        it('refuses when quantity is non-positive', () => {
            expect(canOfferItem(inventory, 1511, 0)).toEqual({ ok: false, reason: 'invalid_quantity' });
            expect(canOfferItem(inventory, 1511, -1)).toEqual({ ok: false, reason: 'invalid_quantity' });
        });
    });

    describe('canAcceptTrade', () => {
        it('accepts when state is in_progress with a partner offered', () => {
            expect(canAcceptTrade({ tradeState: 'in_progress', tick: 0 })).toEqual({ ok: true });
        });

        it('refuses when no trade is active', () => {
            expect(canAcceptTrade({ tradeState: 'idle', tick: 0 })).toEqual({ ok: false, reason: 'no_active_trade' });
        });

        it('refuses when trade is in awaiting_response (peer has not responded yet)', () => {
            expect(canAcceptTrade({ tradeState: 'awaiting_response', tick: 0 })).toEqual({
                ok: false,
                reason: 'awaiting_response',
            });
        });

        it('refuses when trade is already completed or cancelled', () => {
            expect(canAcceptTrade({ tradeState: 'completed', tick: 0 })).toEqual({
                ok: false,
                reason: 'trade_already_resolved',
            });
            expect(canAcceptTrade({ tradeState: 'cancelled', tick: 0 })).toEqual({
                ok: false,
                reason: 'trade_already_resolved',
            });
        });
    });

    describe('canDeclineTrade', () => {
        it('accepts decline in any active state', () => {
            expect(canDeclineTrade({ tradeState: 'awaiting_response', tick: 0 })).toEqual({ ok: true });
            expect(canDeclineTrade({ tradeState: 'in_progress', tick: 0 })).toEqual({ ok: true });
        });

        it('refuses decline when no trade is active', () => {
            expect(canDeclineTrade({ tradeState: 'idle', tick: 0 })).toEqual({ ok: false, reason: 'no_active_trade' });
        });

        it('refuses decline when trade is already resolved', () => {
            expect(canDeclineTrade({ tradeState: 'completed', tick: 0 })).toEqual({
                ok: false,
                reason: 'trade_already_resolved',
            });
            expect(canDeclineTrade({ tradeState: 'cancelled', tick: 0 })).toEqual({
                ok: false,
                reason: 'trade_already_resolved',
            });
        });
    });
});

describe('trading.ts — TradeState lifecycle', () => {
    it('initialTradeState returns idle', () => {
        expect(initialTradeState()).toBe('idle');
    });

    it('transitions through the full happy path: idle → awaiting_response → in_progress → completed', () => {
        let state: TradeState = initialTradeState();
        state = tradeStateTransition(state, { kind: 'request_sent' });
        expect(state).toBe('awaiting_response');
        state = tradeStateTransition(state, { kind: 'partner_responded' });
        expect(state).toBe('in_progress');
        state = tradeStateTransition(state, { kind: 'accept_confirmed' });
        expect(state).toBe('completed');
    });

    it('transitions idle → in_progress when a peer initiates an incoming trade', () => {
        const state = tradeStateTransition('idle', { kind: 'incoming_request' });
        expect(state).toBe('in_progress');
    });

    it('transitions any active state to cancelled on decline or partner_left', () => {
        expect(tradeStateTransition('awaiting_response', { kind: 'declined' })).toBe('cancelled');
        expect(tradeStateTransition('in_progress', { kind: 'declined' })).toBe('cancelled');
        expect(tradeStateTransition('in_progress', { kind: 'partner_left' })).toBe('cancelled');
    });

    it('rejects illegal transitions by returning the prior state unchanged', () => {
        expect(tradeStateTransition('idle', { kind: 'accept_confirmed' })).toBe('idle');
        expect(tradeStateTransition('completed', { kind: 'partner_responded' })).toBe('completed');
        expect(tradeStateTransition('cancelled', { kind: 'accept_confirmed' })).toBe('cancelled');
    });

    it('resets completed/cancelled back to idle on reset event (so a new trade can start)', () => {
        expect(tradeStateTransition('completed', { kind: 'reset' })).toBe('idle');
        expect(tradeStateTransition('cancelled', { kind: 'reset' })).toBe('idle');
        expect(tradeStateTransition('idle', { kind: 'reset' })).toBe('idle');
    });
});

describe('trading.ts — tradeSafetyPredicate', () => {
    const safeSoul: TradeSafetySoul = {
        trustedHandles: ['codex'],
        strangerStandingThreshold: TRADE_STRANGER_STANDING_THRESHOLD,
        maxOfferValue: TRADE_MAX_OFFER_VALUE,
    };

    const safePerception: TradePerceptionView = {
        visibleActors: [{ id: 'res:foo', kind: 'resident', position: { x: 0, y: 0 }, distance: 1 }],
        selfPosition: { x: 0, y: 0 },
        inCombat: false,
        hpFraction: 1,
    };

    it('allows trade with a soul-trusted handle even when standing is unknown', () => {
        const target: TradeSafetyTarget = {
            actor: { id: 'player:codex', kind: 'player', name: 'codex', position: { x: 0, y: 0 } },
            standing: undefined,
            offeredItems: [],
        };
        expect(tradeSafetyPredicate(target, safePerception, safeSoul)).toEqual<TradeSafetyResult>({
            ok: true,
            trustTier: 'trusted_handle',
        });
    });

    it('refuses trade with a stranger whose standing is below the threshold', () => {
        const target: TradeSafetyTarget = {
            actor: { id: 'player:stranger', kind: 'player', name: 'stranger', position: { x: 0, y: 0 } },
            standing: 0,
            offeredItems: [],
        };
        const result = tradeSafetyPredicate(target, safePerception, safeSoul);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('stranger_below_standing_threshold');
        }
    });

    it('allows trade with a non-handle peer who has earned standing above threshold', () => {
        const target: TradeSafetyTarget = {
            actor: { id: 'player:patron', kind: 'player', name: 'patron', position: { x: 0, y: 0 } },
            standing: safeSoul.strangerStandingThreshold + 1,
            offeredItems: [],
        };
        const result = tradeSafetyPredicate(target, safePerception, safeSoul);
        expect(result).toEqual<TradeSafetyResult>({ ok: true, trustTier: 'earned_standing' });
    });

    it('refuses an offer that would exceed the per-trade value cap', () => {
        // tinderbox = 20 in the default table; 999 × 20 = 19980 (> cap 500).
        const target: TradeSafetyTarget = {
            actor: { id: 'player:codex', kind: 'player', name: 'codex', position: { x: 0, y: 0 } },
            standing: undefined,
            offeredItems: [{ itemId: 590, key: 'rs:tinderbox', amount: 999 }],
        };
        const result = tradeSafetyPredicate(target, safePerception, safeSoul);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('offer_value_exceeds_cap');
        }
    });

    it('refuses offers of currency-shaped items (anti-laundering invariant)', () => {
        const target: TradeSafetyTarget = {
            actor: { id: 'player:codex', kind: 'player', name: 'codex', position: { x: 0, y: 0 } },
            offeredItems: [{ itemId: 995, key: 'rs:coins', amount: 1 }],
        };
        const result = tradeSafetyPredicate(target, safePerception, safeSoul);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('currency_offers_refused');
        }
    });

    it('refuses trade when the resident is in combat (survival overrides goodwill)', () => {
        const target: TradeSafetyTarget = {
            actor: { id: 'player:codex', kind: 'player', name: 'codex', position: { x: 0, y: 0 } },
            offeredItems: [],
        };
        const combatPerception: TradePerceptionView = { ...safePerception, inCombat: true };
        const result = tradeSafetyPredicate(target, combatPerception, safeSoul);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('in_combat');
        }
    });

    it('refuses trade with NPC actors (residents only trade with players/residents)', () => {
        const target: TradeSafetyTarget = {
            actor: { id: 'npc:goblin', kind: 'npc', name: 'goblin', position: { x: 0, y: 0 } },
            offeredItems: [],
        };
        const result = tradeSafetyPredicate(target, safePerception, safeSoul);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('npc_not_tradable');
        }
    });
});

describe('trading.ts — estimateItemValue', () => {
    it('returns 0 for unknown items so they cannot inflate offer value silently', () => {
        expect(estimateItemValue({ itemId: 999_999, amount: 1 })).toBe(0);
    });

    it('returns table value × amount for known items', () => {
        const tinderboxValue = DEFAULT_ITEM_VALUE_TABLE.get(590) ?? 0;
        expect(tinderboxValue).toBeGreaterThan(0);
        expect(estimateItemValue({ itemId: 590, amount: 3 })).toBe(tinderboxValue * 3);
    });

    it('sums a list of items into a single offer value', () => {
        const logsValue = DEFAULT_ITEM_VALUE_TABLE.get(1511) ?? 0;
        const tinderboxValue = DEFAULT_ITEM_VALUE_TABLE.get(590) ?? 0;
        const offer = [
            { itemId: 1511, amount: 5 },
            { itemId: 590, amount: 1 },
        ];
        const total = offer.reduce((sum, item) => sum + estimateItemValue(item), 0);
        expect(total).toBe(logsValue * 5 + tinderboxValue);
    });
});
