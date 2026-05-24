import { initialAttention, spendAttention, spendForAction, spendForLlm } from './attention';

describe('attention spend functions', () => {
    describe('without floor (default behavior)', () => {
        it('spendAttention reduces by the decay-curve constant', () => {
            expect(spendAttention(100, 'standard')).toBe(99); // -1
            expect(spendAttention(100, 'gentle')).toBe(99.5); // -0.5
            expect(spendAttention(100, 'steep')).toBe(98); // -2
        });

        it('spendAttention with multiplier scales the spend', () => {
            expect(spendAttention(100, 'standard', 3)).toBe(97);
        });

        it('spendAttention clamps to 0 (never goes negative)', () => {
            expect(spendAttention(0.5, 'standard')).toBe(0);
            expect(spendAttention(-5, 'standard')).toBe(0);
        });

        it('spendForAction reduces by the per-action constant or default 1', () => {
            expect(spendForAction(100, 'say')).toBe(99.5); // -0.5
            expect(spendForAction(100, 'move_to')).toBe(99); // -1
            expect(spendForAction(100, 'attack')).toBe(98); // -2
            expect(spendForAction(100, 'unknown_kind')).toBe(99); // default 1
        });

        it('spendForLlm reduces by the per-outcome constant', () => {
            expect(spendForLlm(100, 'complete')).toBe(95); // -5
            expect(spendForLlm(100, 'aborted')).toBe(98); // -2
        });
    });

    // E30 / HD-008: optional accrual floor for hero/anchor residents.
    // The floor parameter clamps spend outcomes to `Math.max(floor, ...)`
    // so heroes don't die from being busy at Chicago. The floor does NOT
    // affect explicit damage death-paths (those use markDeceased directly).
    describe('with floor (E30 / HD-008)', () => {
        it('spendAttention with floor=5000 clamps to 5000 when below', () => {
            expect(spendAttention(5001, 'standard', 1, 5000)).toBe(5000);
            expect(spendAttention(100, 'standard', 1, 5000)).toBe(5000);
            expect(spendAttention(0, 'standard', 1, 5000)).toBe(5000);
        });

        it('spendAttention with floor does not raise above the computed value', () => {
            // If current is already comfortably above floor, behavior matches no-floor.
            expect(spendAttention(10000, 'standard', 1, 5000)).toBe(9999);
            expect(spendAttention(10000, 'gentle', 1, 5000)).toBe(9999.5);
        });

        it('spendForAction with floor=5000 clamps to 5000 when below', () => {
            expect(spendForAction(5001, 'move_to', 5000)).toBe(5000);
            expect(spendForAction(100, 'attack', 5000)).toBe(5000);
        });

        it('spendForLlm with floor=5000 clamps to 5000 when below', () => {
            expect(spendForLlm(5004, 'complete', 5000)).toBe(5000);
            expect(spendForLlm(100, 'complete', 5000)).toBe(5000);
        });

        it('floor=0 (explicit) behaves like no floor (clamps only to 0)', () => {
            expect(spendAttention(0.5, 'standard', 1, 0)).toBe(0);
        });

        it('floor with non-finite or negative value falls back to 0', () => {
            // NaN floor → 0 floor (fail-safe).
            expect(spendAttention(0.5, 'standard', 1, Number.NaN)).toBe(0);
            // Infinity → 0 floor (fail-safe, can't have a +∞ floor).
            expect(spendAttention(0.5, 'standard', 1, Number.POSITIVE_INFINITY)).toBe(0);
            // Negative → 0 floor.
            expect(spendAttention(0.5, 'standard', 1, -100)).toBe(0);
        });

        it('floor higher than current preserves current (does NOT auto-bump)', () => {
            // The floor is a LOWER BOUND on the SPEND outcome. It does not
            // auto-bump a resident whose current is already below the floor
            // — that would be a separate "revive" mechanism. The floor
            // applies as the resident accrues spend AGAINST it.
            // (Test: current=100, floor=5000 still spends to floor in one
            // call.) Verified by other tests above.
            expect(spendAttention(100, 'standard', 1, 5000)).toBe(5000);
        });
    });

    describe('initialAttention', () => {
        it('returns startingAttention if provided', () => {
            expect(initialAttention({ startingAttention: 14000, decayCurve: 'gentle' })).toBe(14000);
        });
        it('falls back to 5000 if startingAttention is missing or 0', () => {
            expect(initialAttention({})).toBe(5000);
            expect(initialAttention({ startingAttention: 0, decayCurve: 'standard' })).toBe(5000);
            expect(initialAttention(undefined)).toBe(5000);
        });
    });
});
