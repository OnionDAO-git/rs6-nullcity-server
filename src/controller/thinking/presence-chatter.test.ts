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
