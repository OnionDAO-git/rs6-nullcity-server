import {
    decayScheduleMultiplier,
    initialAttention,
    replayAttentionLedger,
    resolveAttentionCapacity,
    spendAttention,
    spendForAction,
    spendForLlm,
    type AttentionDecayScheduleConfig,
} from './attention';

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
        it('falls back to the economy config default before the hardcoded 5000', () => {
            expect(initialAttention({}, { startingAttention: 15000 })).toBe(15000);
            expect(initialAttention(undefined, { startingAttention: 15000 })).toBe(15000);
            // Soul-level startingAttention still wins over the config default.
            expect(initialAttention({ startingAttention: 14000, decayCurve: 'gentle' }, { startingAttention: 15000 })).toBe(14000);
        });
        it('clamps the starting value to the resolved capacity', () => {
            expect(initialAttention({ startingAttention: 200000, decayCurve: 'gentle' }, { maxAttention: 180000 })).toBe(180000);
            expect(initialAttention({ startingAttention: 120000, decayCurve: 'gentle' }, { maxAttention: 180000 })).toBe(120000);
            // Per-soul maxAttention overrides the config default for the clamp.
            expect(initialAttention({ startingAttention: 200000, maxAttention: 250000, decayCurve: 'gentle' }, { maxAttention: 180000 })).toBe(
                200000,
            );
        });
    });

    // Survivable-weekend capacity: the attention bar gets a configurable
    // maximum so support credits stop overflowing without bound. Per-soul
    // attentionProfile.maxAttention wins over the config default.
    describe('resolveAttentionCapacity', () => {
        it('prefers the per-soul maxAttention over the config default', () => {
            expect(resolveAttentionCapacity({ maxAttention: 90000 }, 180000)).toBe(90000);
        });
        it('falls back to the config default when the soul has no maxAttention', () => {
            expect(resolveAttentionCapacity({}, 180000)).toBe(180000);
            expect(resolveAttentionCapacity(undefined, 180000)).toBe(180000);
        });
        it('returns undefined (uncapped — today\'s behavior) when neither is set', () => {
            expect(resolveAttentionCapacity({}, undefined)).toBeUndefined();
            expect(resolveAttentionCapacity(undefined, undefined)).toBeUndefined();
        });
        it('ignores non-finite or non-positive values', () => {
            expect(resolveAttentionCapacity({ maxAttention: Number.NaN }, 180000)).toBe(180000);
            expect(resolveAttentionCapacity({ maxAttention: 0 }, undefined)).toBeUndefined();
            expect(resolveAttentionCapacity({ maxAttention: -5 }, Number.POSITIVE_INFINITY)).toBeUndefined();
        });
    });

    // Survivable-weekend decay schedule: attention decays slower in the
    // evening, at night, and on weekends (local time in the configured
    // timezone) so a resident with a full bar at Friday doors can reach
    // Monday morning without a patron top-up.
    describe('decayScheduleMultiplier', () => {
        const schedule: AttentionDecayScheduleConfig = {
            timezone: 'America/Chicago',
            weekendMultiplier: 0.5,
            eveningMultiplier: 0.5,
            nightMultiplier: 0.25,
            eveningStartHour: 18,
            nightStartHour: 22,
            nightEndHour: 8,
        };
        // America/Chicago is UTC-5 (CDT) on the June 2026 dates below.
        const at = (iso: string) => Date.parse(iso);

        it('returns 1.0 when no schedule is configured (backward compatible)', () => {
            expect(decayScheduleMultiplier(undefined, at('2026-06-13T17:00:00Z'))).toBe(1);
        });

        it('weekday daytime decays at the full rate (1.0)', () => {
            // Wed 2026-06-10 12:00 CDT
            expect(decayScheduleMultiplier(schedule, at('2026-06-10T17:00:00Z'))).toBe(1);
            // Thu 2026-06-11 08:00 CDT — night ends at 08:00 (exclusive end)
            expect(decayScheduleMultiplier(schedule, at('2026-06-11T13:00:00Z'))).toBe(1);
        });

        it('weekday evening (18:00-22:00 local) decays at 0.5', () => {
            // Wed 2026-06-10 19:00 CDT
            expect(decayScheduleMultiplier(schedule, at('2026-06-11T00:00:00Z'))).toBe(0.5);
            // Wed 2026-06-10 18:00 CDT — evening start is inclusive
            expect(decayScheduleMultiplier(schedule, at('2026-06-10T23:00:00Z'))).toBe(0.5);
        });

        it('weekday night (22:00-08:00 local) decays at 0.25', () => {
            // Wed 2026-06-10 23:00 CDT
            expect(decayScheduleMultiplier(schedule, at('2026-06-11T04:00:00Z'))).toBe(0.25);
            // Thu 2026-06-11 03:00 CDT — early-morning side of the wrap
            expect(decayScheduleMultiplier(schedule, at('2026-06-11T08:00:00Z'))).toBe(0.25);
            // Wed 2026-06-10 22:00 CDT — night start is inclusive
            expect(decayScheduleMultiplier(schedule, at('2026-06-11T03:00:00Z'))).toBe(0.25);
        });

        it('weekend day takes min(weekendMultiplier, time-of-day) = 0.5', () => {
            // Sat 2026-06-13 12:00 CDT
            expect(decayScheduleMultiplier(schedule, at('2026-06-13T17:00:00Z'))).toBe(0.5);
            // Sun 2026-06-14 12:00 CDT
            expect(decayScheduleMultiplier(schedule, at('2026-06-14T17:00:00Z'))).toBe(0.5);
        });

        it('weekend night takes min(weekendMultiplier, nightMultiplier) = 0.25', () => {
            // Sat 2026-06-13 23:00 CDT
            expect(decayScheduleMultiplier(schedule, at('2026-06-14T04:00:00Z'))).toBe(0.25);
            // Sat 2026-06-13 07:00 CDT — weekend morning still inside the night window
            expect(decayScheduleMultiplier(schedule, at('2026-06-13T12:00:00Z'))).toBe(0.25);
        });

        it('Monday early morning is weekday night (0.25), not weekend', () => {
            // Mon 2026-06-15 03:00 CDT
            expect(decayScheduleMultiplier(schedule, at('2026-06-15T08:00:00Z'))).toBe(0.25);
        });

        it('honors the configured timezone', () => {
            // 2026-06-13T01:00:00Z = Fri 2026-06-12 20:00 in America/Chicago
            // (weekday evening, 0.5) but Sat 01:00 in UTC (weekend night, 0.25).
            const instant = at('2026-06-13T01:00:00Z');
            expect(decayScheduleMultiplier(schedule, instant)).toBe(0.5);
            expect(decayScheduleMultiplier({ ...schedule, timezone: 'UTC' }, instant)).toBe(0.25);
        });

        it('an empty schedule block uses the documented defaults', () => {
            // Defaults: America/Chicago, weekend 0.5, evening 0.5 @18, night 0.25 @22-08.
            expect(decayScheduleMultiplier({}, at('2026-06-10T17:00:00Z'))).toBe(1); // Wed noon
            expect(decayScheduleMultiplier({}, at('2026-06-11T00:00:00Z'))).toBe(0.5); // Wed 19:00
            expect(decayScheduleMultiplier({}, at('2026-06-11T04:00:00Z'))).toBe(0.25); // Wed 23:00
            expect(decayScheduleMultiplier({}, at('2026-06-13T17:00:00Z'))).toBe(0.5); // Sat noon
        });

        it('fails open to 1.0 on an invalid timezone', () => {
            expect(decayScheduleMultiplier({ ...schedule, timezone: 'Not/AZone' }, at('2026-06-13T17:00:00Z'))).toBe(1);
        });

        it('feeds spendAttention as the per-tick multiplier', () => {
            const multiplier = decayScheduleMultiplier(schedule, at('2026-06-13T17:00:00Z')); // Sat noon → 0.5
            expect(spendAttention(100, 'standard', multiplier)).toBe(99.5);
        });
    });

    describe('replayAttentionLedger', () => {
        it('replays grant, spend, decay, top_up, and fade in order', () => {
            const replay = replayAttentionLedger(10, [
                { kind: 'grant', amount: 5 },
                { kind: 'spend', amount: 3 },
                { kind: 'decay', amount: 2 },
                { kind: 'top_up', amount: 4 },
                { kind: 'fade' },
            ]);

            expect(replay.currentAttention).toBe(0);
            expect(replay.faded).toBe(true);
            expect(replay.steps).toEqual([
                { kind: 'grant', amount: 5, before: 10, after: 15 },
                { kind: 'spend', amount: 3, before: 15, after: 12 },
                { kind: 'decay', amount: 2, before: 12, after: 10 },
                { kind: 'top_up', amount: 4, before: 10, after: 14 },
                { kind: 'fade', amount: 0, before: 14, after: 0 },
            ]);
        });

        it('clamps spend and decay at 0, then resumes after top_up', () => {
            const replay = replayAttentionLedger(3, [
                { kind: 'spend', amount: 10 },
                { kind: 'top_up', amount: 7 },
            ]);
            expect(replay.currentAttention).toBe(7);
            expect(replay.faded).toBe(false);
            expect(replay.steps).toEqual([
                { kind: 'spend', amount: 10, before: 3, after: 0 },
                { kind: 'top_up', amount: 7, before: 0, after: 7 },
            ]);
        });

        it('normalizes invalid amounts to 0', () => {
            const replay = replayAttentionLedger(2, [
                { kind: 'grant', amount: Number.NaN },
                { kind: 'spend', amount: -5 },
            ]);
            expect(replay.currentAttention).toBe(2);
            expect(replay.steps).toEqual([
                { kind: 'grant', amount: 0, before: 2, after: 2 },
                { kind: 'spend', amount: 0, before: 2, after: 2 },
            ]);
        });
    });
});
