/**
 * Tests for the RuneScape nervous-system reflex helpers extracted from the
 * monolith hybrid-agent-thinking-module.ts (Plan R-γ). Each describe block
 * targets one extracted helper; the fixtures double as behavioral
 * documentation of the move-verbatim contract.
 */

import { objectIds } from '@engine/world/config/object-ids';
import { explorationObjectCooldownKey } from './runescape-body-routines';
import {
    FENCE_OBSTACLE_IDS,
    OPENABLE_OBSTACLE_IDS,
    STUCK_OBSTACLE_RANGE,
    fleeTarget,
    latestCombatAttacker,
    shouldEmitPresenceBeacon,
    stuckBlockerReportAction,
    stuckHelpRequestAction,
    stuckOpenObstacleAction,
    type NervousActiveMoveState,
    type NervousHybridPerception,
} from './runescape-nervous-rules';

function perception(overrides: Partial<NervousHybridPerception> = {}): NervousHybridPerception {
    return {
        tick: 0,
        resident: {
            position: { x: 100, y: 100, level: 0 },
            ...(overrides.resident || {}),
        },
        nearby: {
            objects: [],
            ...(overrides.nearby || {}),
        },
        events: overrides.events ?? [],
    };
}

function activeMove(overrides: Partial<NervousActiveMoveState> = {}): NervousActiveMoveState {
    return {
        target: { x: 110, y: 110, level: 0 },
        startedAtTick: 0,
        lastTick: 0,
        ...overrides,
    };
}

describe('OPENABLE_OBSTACLE_IDS', () => {
    it('contains the canonical openable obstacle ids from the monolith', () => {
        // Sanity check: these are the object ids the monolith uses to detect
        // openable doors/gates during stuck-recovery. Locked in as a fixture.
        for (const id of [1530, 11707, 1533, 1516, 1519, 1536, 11993, 13001, 1551, 1553, 12986, 12987]) {
            expect(OPENABLE_OBSTACLE_IDS.has(id)).toBe(true);
        }
    });
});

describe('FENCE_OBSTACLE_IDS', () => {
    it('contains at least one fence id (e.g. the Kharid cow-pen fence)', () => {
        expect(FENCE_OBSTACLE_IDS.size).toBeGreaterThan(0);
    });
});

describe('STUCK_OBSTACLE_RANGE', () => {
    it('matches the monolith constant (2 tiles)', () => {
        expect(STUCK_OBSTACLE_RANGE).toBe(2);
    });
});

describe('stuckOpenObstacleAction', () => {
    const OPENABLE_ID = 1530; // a door id from OPENABLE_OBSTACLE_IDS
    const NON_OPENABLE_ID = 99999;

    it('returns an interact-open action when an openable obstacle is in range', () => {
        const obstacle = { objectId: OPENABLE_ID, position: { x: 101, y: 100, level: 0 } };
        const action = stuckOpenObstacleAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 } },
                nearby: { objects: [obstacle] },
            }),
            { x: 100, y: 100, level: 0 },
            activeMove(),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: obstacle,
            option: 'open',
            cause: 'stuck_open_obstacle',
        });
    });

    it('returns undefined when no openable obstacle is nearby', () => {
        const action = stuckOpenObstacleAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 } },
                nearby: {
                    objects: [{ objectId: NON_OPENABLE_ID, position: { x: 101, y: 100, level: 0 } }],
                },
            }),
            { x: 100, y: 100, level: 0 },
            activeMove(),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when the openable obstacle is out of range', () => {
        const action = stuckOpenObstacleAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 } },
                nearby: {
                    objects: [{ objectId: OPENABLE_ID, position: { x: 110, y: 100, level: 0 } }],
                },
            }),
            { x: 100, y: 100, level: 0 },
            activeMove(),
        );
        expect(action).toBeUndefined();
    });

    it('prefers the obstacle nearest to the resident', () => {
        const near = { objectId: OPENABLE_ID, position: { x: 101, y: 100, level: 0 } };
        const far = { objectId: 11707, position: { x: 102, y: 100, level: 0 } };
        const action = stuckOpenObstacleAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 } },
                nearby: { objects: [far, near] },
            }),
            { x: 100, y: 100, level: 0 },
            activeMove(),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: near,
            option: 'open',
            cause: 'stuck_open_obstacle',
        });
    });

    it('breaks ties by distance to the active-move target', () => {
        // Two obstacles equidistant from the resident; pick the one closer to active.target.
        const here = { x: 100, y: 100, level: 0 };
        const targetA = { objectId: OPENABLE_ID, position: { x: 101, y: 100, level: 0 } };
        const targetB = { objectId: 11707, position: { x: 99, y: 100, level: 0 } };
        const action = stuckOpenObstacleAction(
            perception({
                resident: { position: here },
                nearby: { objects: [targetB, targetA] },
            }),
            here,
            activeMove({ target: { x: 120, y: 100, level: 0 } }),
        );
        expect(action?.kind === 'interact' ? action.target : undefined).toBe(targetA);
    });

    it('does not retry an openable obstacle while its exploration cooldown is active', () => {
        const obstacle = { objectId: OPENABLE_ID, position: { x: 101, y: 100, level: 0 } };
        const action = stuckOpenObstacleAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 } },
                nearby: { objects: [obstacle] },
            }),
            { x: 100, y: 100, level: 0 },
            activeMove(),
            { [explorationObjectCooldownKey(obstacle)]: 90 },
            100,
        );
        expect(action).toBeUndefined();
    });
});

describe('stuckBlockerReportAction', () => {
    const FENCE_ID = objectIds.shortCuts.fenceNearKharidCows;

    it('returns a say-report when a fence blocker is within range', () => {
        const fence = { objectId: FENCE_ID, position: { x: 101, y: 100, level: 0 } };
        const action = stuckBlockerReportAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 } },
                nearby: { objects: [fence] },
            }),
            { x: 100, y: 100, level: 0 },
            activeMove(),
        );
        expect(action).toEqual({
            kind: 'say',
            text: 'I am stuck near a fence. I will step away and try another route.',
            cause: 'stuck_blocker_report',
        });
    });

    it('returns undefined when no fence is nearby', () => {
        const action = stuckBlockerReportAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 } },
                nearby: {
                    objects: [{ objectId: 1530, position: { x: 101, y: 100, level: 0 } }],
                },
            }),
            { x: 100, y: 100, level: 0 },
            activeMove(),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when the fence is out of range', () => {
        const action = stuckBlockerReportAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 } },
                nearby: {
                    objects: [{ objectId: FENCE_ID, position: { x: 110, y: 100, level: 0 } }],
                },
            }),
            { x: 100, y: 100, level: 0 },
            activeMove(),
        );
        expect(action).toBeUndefined();
    });
});

describe('stuckHelpRequestAction', () => {
    it("returns a help-request 'say' action when active.cause is stuck_move_recovery", () => {
        const action = stuckHelpRequestAction(
            { x: 100, y: 100, level: 0 },
            activeMove({ cause: 'stuck_move_recovery', target: { x: 120, y: 100, level: 0 } }),
        );
        expect(action).toEqual({
            kind: 'say',
            text: 'I am stuck near 100,100 trying to reach 120,100. Can someone lead me or open a route?',
            cause: 'stuck_help_request',
        });
    });

    it('returns undefined when active.cause is not stuck_move_recovery', () => {
        const action = stuckHelpRequestAction({ x: 100, y: 100, level: 0 }, activeMove({ cause: 'continue_move' }));
        expect(action).toBeUndefined();
    });

    it('returns undefined when active.cause is missing', () => {
        const action = stuckHelpRequestAction({ x: 100, y: 100, level: 0 }, activeMove());
        expect(action).toBeUndefined();
    });
});

describe('shouldEmitPresenceBeacon', () => {
    // Pure timing predicate extracted from the monolith's presenceBeaconAction.
    // Matches the monolith semantics:
    //   - never emit if no active goal
    //   - never emit on the very first tick (no last reference)
    //   - emit only if interval has elapsed since the last beacon (or last
    //     goal-share, as a fallback reference)
    //   - if interval <= 0, treat as "always due"

    it('returns false when there is no active goal', () => {
        expect(
            shouldEmitPresenceBeacon({
                tick: 100,
                hasActiveGoal: false,
                lastBeaconTick: 0,
                lastGoalShareTick: undefined,
                interval: 50,
            }),
        ).toBe(false);
    });

    it('returns false on first observation (no last beacon or goal-share reference)', () => {
        expect(
            shouldEmitPresenceBeacon({
                tick: 100,
                hasActiveGoal: true,
                lastBeaconTick: undefined,
                lastGoalShareTick: undefined,
                interval: 50,
            }),
        ).toBe(false);
    });

    it('returns false when the interval has not yet elapsed since the last beacon', () => {
        expect(
            shouldEmitPresenceBeacon({
                tick: 110,
                hasActiveGoal: true,
                lastBeaconTick: 100,
                lastGoalShareTick: undefined,
                interval: 50,
            }),
        ).toBe(false);
    });

    it('returns true when the interval has elapsed since the last beacon', () => {
        expect(
            shouldEmitPresenceBeacon({
                tick: 160,
                hasActiveGoal: true,
                lastBeaconTick: 100,
                lastGoalShareTick: undefined,
                interval: 50,
            }),
        ).toBe(true);
    });

    it('falls back to lastGoalShareTick when lastBeaconTick is undefined', () => {
        expect(
            shouldEmitPresenceBeacon({
                tick: 160,
                hasActiveGoal: true,
                lastBeaconTick: undefined,
                lastGoalShareTick: 100,
                interval: 50,
            }),
        ).toBe(true);
    });

    it('returns true when interval is <= 0 (treat as always due) provided some reference exists', () => {
        expect(
            shouldEmitPresenceBeacon({
                tick: 1,
                hasActiveGoal: true,
                lastBeaconTick: 0,
                lastGoalShareTick: undefined,
                interval: 0,
            }),
        ).toBe(true);
    });
});

describe('latestCombatAttacker', () => {
    const attacker = {
        id: 'npc:cow',
        kind: 'npc' as const,
        name: 'Cow',
        position: { x: 200, y: 200, level: 0 },
    };

    it('returns the most recent hit_taken / hit / attacked attacker', () => {
        const result = latestCombatAttacker({
            events: [
                { kind: 'hit', from: attacker },
                { kind: 'spoke', from: { id: 'p:1', kind: 'player', position: { x: 0, y: 0, level: 0 } } },
                { kind: 'hit_taken', from: attacker },
            ],
        });
        expect(result?.id).toBe('npc:cow');
        expect(result?.kind).toBe('npc');
    });

    it('returns undefined when no combat-related events are present', () => {
        const result = latestCombatAttacker({
            events: [{ kind: 'spoke', from: attacker }],
        });
        expect(result).toBeUndefined();
    });

    it('returns undefined when events is missing', () => {
        expect(latestCombatAttacker({})).toBeUndefined();
    });

    it('walks the event list from newest to oldest and stops at the first combat event', () => {
        // Reversal means later array entries are "newer". The first reverse-iteration
        // combat event whose `from` is a valid actor wins.
        const newer = { ...attacker, id: 'npc:newer' };
        const older = { ...attacker, id: 'npc:older' };
        const result = latestCombatAttacker({
            events: [
                { kind: 'hit', from: older },
                { kind: 'attacked', from: newer },
            ],
        });
        expect(result?.id).toBe('npc:newer');
    });
});

describe('fleeTarget', () => {
    it('returns a default east-shifted target when there is no known threat', () => {
        const target = fleeTarget({
            resident: { position: { x: 100, y: 100, level: 0 } },
        });
        expect(target).toEqual({ x: 104, y: 100, level: 0 });
    });

    it('flees away from a threat to the west (resident is east, threat is west)', () => {
        // here.x=100, threat.x=80 → here.x - threat.x = 20 → sign = 1 → x = 100 + 4 = 104
        // here.y=100, threat.y=100 → here.y - threat.y = 0 → sign(0||1)=1 → y = 100 + 4 = 104
        const target = fleeTarget({
            resident: {
                position: { x: 100, y: 100, level: 0 },
                combatTarget: {
                    id: 'npc:cow',
                    kind: 'npc',
                    name: 'Cow',
                    position: { x: 80, y: 100, level: 0 },
                },
            },
        });
        expect(target).toEqual({ x: 104, y: 104, level: 0 });
    });

    it('flees away from a threat to the east (resident is west, threat is east)', () => {
        // here.x=100, threat.x=120 → here.x - threat.x = -20 → sign = -1 → x = 100 - 4 = 96
        const target = fleeTarget({
            resident: {
                position: { x: 100, y: 100, level: 0 },
                combatTarget: {
                    id: 'npc:goblin',
                    kind: 'npc',
                    name: 'Goblin',
                    position: { x: 120, y: 100, level: 0 },
                },
            },
        });
        expect(target).toEqual({ x: 96, y: 104, level: 0 });
    });

    it('returns origin-based default when the resident has no position', () => {
        const target = fleeTarget({});
        expect(target).toEqual({ x: 4, y: 0, level: 0 });
    });

    it('prefers attacker from events over the resident.combatTarget when both are present', () => {
        const target = fleeTarget({
            resident: {
                position: { x: 100, y: 100, level: 0 },
                combatTarget: {
                    id: 'npc:other',
                    kind: 'npc',
                    name: 'Other',
                    position: { x: 80, y: 100, level: 0 },
                },
            },
            events: [
                {
                    kind: 'hit_taken',
                    from: {
                        id: 'npc:attacker',
                        kind: 'npc',
                        name: 'Attacker',
                        position: { x: 120, y: 100, level: 0 },
                    },
                },
            ],
        });
        // Event attacker is at x=120 (east of here), so retreat west → x = 96.
        expect(target.x).toBe(96);
    });
});
