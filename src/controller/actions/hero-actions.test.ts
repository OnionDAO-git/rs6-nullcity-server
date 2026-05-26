import { canRequestAttention, canPrepareEpitaph, canTradeResource } from './hero-actions';
import { HERO_TIERS } from '../residents/hero-tier';
import type { RuntimeState } from '../memory/runtime-state';

describe('Hero Actions Preconditions', () => {
    const mockState = {} as RuntimeState;

    describe('canRequestAttention', () => {
        it('allows hero and novice tiers, rejects background tier', () => {
            expect(canRequestAttention(mockState, HERO_TIERS.hero)).toBe(true);
            expect(canRequestAttention(mockState, HERO_TIERS.novice)).toBe(true);
            expect(canRequestAttention(mockState, HERO_TIERS.background)).toBe(false);
        });
    });

    describe('canPrepareEpitaph', () => {
        it('allows hero and novice tiers, rejects background tier', () => {
            expect(canPrepareEpitaph(mockState, HERO_TIERS.hero)).toBe(true);
            expect(canPrepareEpitaph(mockState, HERO_TIERS.novice)).toBe(true);
            expect(canPrepareEpitaph(mockState, HERO_TIERS.background)).toBe(false);
        });
    });

    describe('canTradeResource', () => {
        it('rejects if the tier configuration does not support trading', () => {
            const check = canTradeResource(mockState, HERO_TIERS.background, [{ itemId: 1511, amount: 5 }], 'logs', 1, true);
            expect(check).toEqual({ ok: false, reason: "Tier 'background' does not permit trade_resource" });
        });

        it('rejects if the target is not visible', () => {
            const check = canTradeResource(mockState, HERO_TIERS.hero, [{ itemId: 1511, amount: 5, key: 'rs:logs' }], 'logs', 1, false);
            expect(check).toEqual({ ok: false, reason: 'target_not_visible' });
        });

        it('rejects if inventory is insufficient', () => {
            const check = canTradeResource(mockState, HERO_TIERS.hero, [{ itemId: 1511, amount: 2, key: 'rs:logs' }], 'logs', 5, true);
            expect(check).toEqual({ ok: false, reason: 'insufficient_inventory' });
        });

        it('allows logs matching by id, key, or rs:prefix', () => {
            const inventory = [{ itemId: 1511, amount: 5, key: 'rs:logs' }];
            const checkId = canTradeResource(mockState, HERO_TIERS.hero, inventory, '1511', 1, true);
            const checkKey = canTradeResource(mockState, HERO_TIERS.hero, inventory, 'logs', 1, true);
            const checkFullKey = canTradeResource(mockState, HERO_TIERS.hero, inventory, 'rs:logs', 1, true);

            expect(checkId.ok).toBe(true);
            expect(checkKey.ok).toBe(true);
            expect(checkFullKey.ok).toBe(true);
        });

        it('allows bones matching by key', () => {
            const inventory = [{ itemId: 526, amount: 5, key: 'rs:bones' }];
            const check = canTradeResource(mockState, HERO_TIERS.hero, inventory, 'bones', 2, true);
            expect(check.ok).toBe(true);
        });
    });
});
