/**
 * Tests for the RuneScape body-routine action helpers extracted from the
 * monolith hybrid-agent-thinking-module.ts (Plan R-β). Each describe block
 * targets one extracted helper; the fixtures double as behavioral
 * documentation of the move-verbatim contract.
 */

import { objectIds } from '@engine/world/config/object-ids';
import {
    firemakingAction,
    levelOneWoodcuttingAction,
    starterFishingAction,
    type BodyActor,
    type BodyHybridPerception,
    type BodyItem,
} from './runescape-body-routines';

const FIRE_OBJECT_ID = objectIds.fire;

function item(itemId: number, key?: string, amount = 1): BodyItem {
    return { itemId, key, amount };
}

function perception(overrides: Partial<BodyHybridPerception> = {}): BodyHybridPerception {
    return {
        tick: 0,
        resident: {
            position: { x: 100, y: 100, level: 0 },
            inventory: [],
            ...(overrides.resident || {}),
        },
        nearby: {
            objects: [],
            npcs: [],
            worldItems: [],
            players: [],
            ...(overrides.nearby || {}),
        },
        events: overrides.events ?? [],
    };
}

describe('firemakingAction', () => {
    it('returns use_item_on_item when tinderbox and logs are both in inventory and no nearby fire', () => {
        const action = firemakingAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    inventory: [item(590), item(1511)],
                },
            }),
        );
        expect(action).toEqual({
            kind: 'use_item_on_item',
            itemSlot: 0,
            targetSlot: 1,
            cause: 'firemaking_fallback',
        });
    });

    it('returns undefined when a fire is already adjacent (suppress duplicate firemaking)', () => {
        const action = firemakingAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    inventory: [item(590), item(1511)],
                },
                nearby: {
                    objects: [{ objectId: FIRE_OBJECT_ID, position: { x: 100, y: 100, level: 0 } }],
                },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when missing tinderbox', () => {
        const action = firemakingAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    inventory: [item(1511)],
                },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when missing logs', () => {
        const action = firemakingAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    inventory: [item(590)],
                },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('locates the first tinderbox and first log slot when inventory has multiples', () => {
        const action = firemakingAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    inventory: [null, item(1511, 'rs:logs'), item(590), item(1511)],
                },
            }),
        );
        expect(action).toEqual({
            kind: 'use_item_on_item',
            itemSlot: 2,
            targetSlot: 1,
            cause: 'firemaking_fallback',
        });
    });
});

describe('levelOneWoodcuttingAction', () => {
    const NORMAL_TREE = 1276;
    const DEAD_TREE = 1282;
    const AXE = 1351;

    it('returns interact "chop down" when adjacent to a normal tree with an axe', () => {
        const tree = { objectId: NORMAL_TREE, position: { x: 100, y: 100, level: 0 } };
        const action = levelOneWoodcuttingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(AXE)] },
                nearby: { objects: [tree] },
            }),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: tree,
            option: 'chop down',
            cause: 'woodcutting_level1_routine',
        });
    });

    it('moves toward the tree when out of interaction range', () => {
        const tree = { objectId: NORMAL_TREE, position: { x: 105, y: 100, level: 0 } };
        const action = levelOneWoodcuttingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(AXE)] },
                nearby: { objects: [tree] },
            }),
        );
        expect(action).toEqual({
            kind: 'move_to',
            target: { x: 105, y: 100, level: 0 },
            range: 1,
            cause: 'woodcutting_level1_routine',
        });
    });

    it('picks the nearest of multiple trees', () => {
        const nearTree = { objectId: NORMAL_TREE, position: { x: 102, y: 100, level: 0 } };
        const farTree = { objectId: DEAD_TREE, position: { x: 110, y: 100, level: 0 } };
        const action = levelOneWoodcuttingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(AXE)] },
                nearby: { objects: [farTree, nearTree] },
            }),
        );
        expect(action).toEqual({
            kind: 'move_to',
            target: nearTree.position,
            range: 1,
            cause: 'woodcutting_level1_routine',
        });
    });

    it('returns undefined when no axe is carried', () => {
        const tree = { objectId: NORMAL_TREE, position: { x: 100, y: 100, level: 0 } };
        const action = levelOneWoodcuttingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { objects: [tree] },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when no level-1 tree is in sight', () => {
        const action = levelOneWoodcuttingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(AXE)] },
                nearby: { objects: [{ objectId: 99999, position: { x: 100, y: 100, level: 0 } }] },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when resident has no position', () => {
        const action = levelOneWoodcuttingAction(
            perception({
                resident: { position: undefined, inventory: [item(AXE)] },
                nearby: { objects: [{ objectId: NORMAL_TREE, position: { x: 100, y: 100, level: 0 } }] },
            }),
        );
        expect(action).toBeUndefined();
    });
});

describe('starterFishingAction', () => {
    const SMALL_NET = 303;

    function fishingSpot(x: number, y: number): BodyActor {
        return {
            id: `npc:fishing-${x}-${y}`,
            kind: 'npc',
            name: 'Fishing spot',
            position: { x, y, level: 0 },
            hpFraction: 1,
        };
    }

    it('returns an "interact net" action when carrying a small net and a fishing spot is nearby', () => {
        const spot = fishingSpot(102, 100);
        const action = starterFishingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(SMALL_NET)] },
                nearby: { npcs: [spot] },
            }),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: spot,
            option: 'net',
            cause: 'starter_fishing_net',
        });
    });

    it('picks the nearest fishing spot of several', () => {
        const near = fishingSpot(101, 100);
        const far = fishingSpot(110, 100);
        const action = starterFishingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(SMALL_NET)] },
                nearby: { npcs: [far, near] },
            }),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: near,
            option: 'net',
            cause: 'starter_fishing_net',
        });
    });

    it('returns undefined when no small fishing net is carried', () => {
        const action = starterFishingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [fishingSpot(101, 100)] },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when there is no nearby fishing spot', () => {
        const action = starterFishingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(SMALL_NET)] },
                nearby: { npcs: [] },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when resident has no position', () => {
        const action = starterFishingAction(
            perception({
                resident: { position: undefined, inventory: [item(SMALL_NET)] },
                nearby: { npcs: [fishingSpot(101, 100)] },
            }),
        );
        expect(action).toBeUndefined();
    });
});
