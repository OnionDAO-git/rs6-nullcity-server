import { composeStatusLine, DEFAULT_GOAL_SHARE_EVERY_TICKS } from './hybrid-agent-helpers';
import { shouldEmitPresenceBeacon } from '../spark/runescape-nervous-rules';

/**
 * Tone-down of the robotic presence chatter that dominated the live chat feed
 * (1,347 near-identical "I am online at 3231,3202. Goal: ..." lines in 2h).
 * Two debug-flavored levers, both pure + unit-tested here:
 *   1. composeStatusLine assembles the spoken status WITHOUT raw tile coordinates.
 *   2. DEFAULT_GOAL_SHARE_EVERY_TICKS cadence is widened so beacons are occasional,
 *      not constant. See docs/launch-capabilities-report-2026-06-02.md (P0-1).
 */

describe('composeStatusLine — de-debugged presence speech', () => {
    it('never includes raw tile coordinates', () => {
        const line = composeStatusLine({ prefix: 'I am working my route', goal: 'gather logs and light a fire', need: '' });
        expect(line).not.toMatch(/\d{3,4}\s*,\s*\d{3,4}/);
    });

    it('formats prefix + goal without a location clause', () => {
        const line = composeStatusLine({ prefix: 'I am scouting', goal: 'catch shrimp', need: '' });
        expect(line).toBe('I am scouting. Goal: catch shrimp.');
    });

    it('includes the next-step hint when provided', () => {
        const line = composeStatusLine({ prefix: 'I am online', goal: 'gather logs', next: 'find a woodcutting axe', need: '' });
        expect(line).toBe('I am online. Goal: gather logs. Next: find a woodcutting axe');
    });

    it('falls back to just the prefix sentence when there is no goal', () => {
        const line = composeStatusLine({ prefix: 'I am checking in', need: '' });
        expect(line).toBe('I am checking in.');
    });

    it('appends a survival need clause when present', () => {
        const line = composeStatusLine({ prefix: 'I am holding', goal: 'stay safe', need: ' Need: food or time to heal before fighting.' });
        expect(line).toBe('I am holding. Goal: stay safe. Need: food or time to heal before fighting.');
    });
});

describe('presence-beacon cadence — toned down for human viewers', () => {
    it('stays quiet well beyond the old 120-tick cadence', () => {
        expect(DEFAULT_GOAL_SHARE_EVERY_TICKS).toBeGreaterThanOrEqual(500);
    });

    it('suppresses a beacon 300 ticks after the last at the default cadence', () => {
        expect(
            shouldEmitPresenceBeacon({
                tick: 1300,
                hasActiveGoal: true,
                lastBeaconTick: 1000,
                lastGoalShareTick: 1000,
                interval: DEFAULT_GOAL_SHARE_EVERY_TICKS,
            }),
        ).toBe(false);
    });

    it('allows a beacon once the default cadence has fully elapsed', () => {
        expect(
            shouldEmitPresenceBeacon({
                tick: 1000 + DEFAULT_GOAL_SHARE_EVERY_TICKS,
                hasActiveGoal: true,
                lastBeaconTick: 1000,
                lastGoalShareTick: 1000,
                interval: DEFAULT_GOAL_SHARE_EVERY_TICKS,
            }),
        ).toBe(true);
    });
});

import { presenceBeaconPrefix, presenceBeaconAction, PRESENCE_BEACON_VARIETY_AFTER_TICKS } from './hybrid-agent-helpers';
import type { HelperContext } from './hybrid-agent-helpers';
import type { HybridPerception } from './hybrid-agent-utils';
import type { Soul } from '../soul/soul-schema';

function makeSoul(register = 'endurer', display = 'Hans'): Soul {
    return {
        frontmatter: { name: 'res:hans', display, archetype: 'endurer', voice: { register } },
    } as unknown as Soul;
}

/**
 * A nearby-rich perception: the OLD beacon prefix would inline
 * "Nearby I see 17 trees and 8 items" — the debug read-out the live audit
 * flagged. These tests assert the PUBLIC say string no longer carries it.
 */
function richPerception(): HybridPerception {
    return {
        tick: 1200,
        resident: { position: { x: 3231, y: 3202, level: 0 }, inventory: [] },
        nearby: {
            players: [{ kind: 'player', id: 'p1' }],
            npcs: [
                { kind: 'npc', id: 'n1' },
                { kind: 'npc', id: 'n2' },
            ],
            objects: [],
            worldItems: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }],
        },
    } as unknown as HybridPerception;
}

interface StubCtxOpts {
    tick: number;
    register?: string;
    cognition: Record<string, unknown>;
    hasGoal?: boolean;
    interval?: number;
}

function makeCtx(opts: StubCtxOpts): HelperContext {
    const cognition = opts.cognition;
    return {
        options: {
            soul: makeSoul(opts.register ?? 'endurer'),
            state: { tick: opts.tick, resident: 'res:hans' },
        },
        cognition: () => cognition,
        activeGoal: () => (opts.hasGoal === false ? undefined : { description: 'Master woodcutting and supply logs.' }),
        behavior: () => ({ shareGoalsEveryTicks: opts.interval ?? 600 }),
        visibilityAnchor: () => undefined,
    } as unknown as HelperContext;
}

describe('presenceBeaconPrefix — voice-skinned, telemetry stripped', () => {
    it('does not leak the nearby perception read-out into the public string', () => {
        const ctx = makeCtx({ tick: 1200, register: 'endurer', cognition: {} });
        const prefix = presenceBeaconPrefix(ctx, richPerception());
        expect(prefix).not.toMatch(/Nearby I see/i);
        expect(prefix).not.toMatch(/\btrees?\b/i);
        expect(prefix).not.toMatch(/\bNPCs?\b/i);
        expect(prefix).not.toMatch(/\bitems?\b/i);
        expect(prefix).not.toMatch(/\d+\s+(tree|item|NPC|player)/i);
        expect(prefix.length).toBeGreaterThan(0);
    });

    it('reflects the soul register (endurer vs mentor differ)', () => {
        const tick = PRESENCE_BEACON_VARIETY_AFTER_TICKS + 5;
        const endurer = presenceBeaconPrefix(makeCtx({ tick, register: 'endurer', cognition: {} }), richPerception());
        const mentor = presenceBeaconPrefix(makeCtx({ tick, register: 'mentor', cognition: {} }), richPerception());
        expect(endurer).not.toBe(mentor);
    });

    it('uses the warm-up "online"-style line before the variety threshold', () => {
        const ctx = makeCtx({ tick: 10, register: 'endurer', cognition: {} });
        const prefix = presenceBeaconPrefix(ctx, richPerception());
        expect(prefix).not.toMatch(/Nearby I see/i);
        expect(prefix.length).toBeGreaterThan(0);
    });
});

describe('presenceBeaconAction — consecutive-identical suppression', () => {
    it('emits a beacon, then suppresses an identical one on the next due tick', () => {
        const cognition: Record<string, unknown> = { lastGoalShareTick: 0 };
        // Fixed tick window keeps the deterministic phrase identical between calls.
        const first = presenceBeaconAction(makeCtx({ tick: 600, cognition, interval: 600 }), richPerception());
        expect(first).toBeDefined();
        expect(first?.kind).toBe('say');
        const firstText = first?.kind === 'say' ? first.text : undefined;
        expect(cognition.lastPresenceBeaconText).toBe(firstText);

        // Same phase/seed window → identical text → must be suppressed.
        const second = presenceBeaconAction(makeCtx({ tick: 600, cognition, interval: 600 }), richPerception());
        expect(second).toBeUndefined();
    });

    it('emits again when the beacon text actually changes', () => {
        const cognition: Record<string, unknown> = { lastPresenceBeaconText: '___never-matches___', lastGoalShareTick: 0 };
        const action = presenceBeaconAction(makeCtx({ tick: 600, cognition, interval: 600 }), richPerception());
        expect(action).toBeDefined();
        expect(action?.kind).toBe('say');
    });

    it('still respects the timing gate (no goal → no beacon)', () => {
        const cognition: Record<string, unknown> = { lastGoalShareTick: 0 };
        const action = presenceBeaconAction(makeCtx({ tick: 600, cognition, interval: 600, hasGoal: false }), richPerception());
        expect(action).toBeUndefined();
    });
});
