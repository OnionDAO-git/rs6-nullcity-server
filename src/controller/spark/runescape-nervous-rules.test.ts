/**
 * Tests for the RuneScape nervous-system reflex helpers extracted from the
 * monolith hybrid-agent-thinking-module.ts (Plan R-γ). Each describe block
 * targets one extracted helper; the fixtures double as behavioral
 * documentation of the move-verbatim contract.
 */

import {
    FENCE_OBSTACLE_IDS,
    OPENABLE_OBSTACLE_IDS,
    STUCK_OBSTACLE_RANGE,
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
});
