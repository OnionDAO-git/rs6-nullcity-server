/**
 * Tests for the RuneScape body-routine action helpers extracted from the
 * monolith hybrid-agent-thinking-module.ts (Plan R-β). Each describe block
 * targets one extracted helper; the fixtures double as behavioral
 * documentation of the move-verbatim contract.
 */

import { objectIds } from '@engine/world/config/object-ids';
import {
    buryBonesAction,
    combatLootOrPrayerAction,
    combatTrainingAction,
    explorationAction,
    explorationItemCooldownKey,
    explorationObjectCooldownKey,
    explorationPatrolCooldownKey,
    firemakingAction,
    LUMBRIDGE_CASTLE_KITCHEN_ENTRY,
    LUMBRIDGE_CASTLE_RANGE,
    LUMBRIDGE_STARTER_FISHING_SPOT,
    levelOneWoodcuttingAction,
    lowHealthRecoveryAction,
    opportunisticPickupAction,
    prayerTrainingAction,
    starterFishingAction,
    starterFishingCookingAction,
    starterFishingRouteAction,
    type BodyActor,
    type BodyHybridPerception,
    type BodyItem,
    type BodyWorldItem,
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
        const spot = fishingSpot(101, 100);
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

    it('clicks a visible distant fishing spot and lets the game walk to it', () => {
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

describe('starterFishingRouteAction', () => {
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

    it('prefers a visible fishing spot over a known-route waypoint', () => {
        const spot = fishingSpot(3230, 3204);
        const action = starterFishingRouteAction(
            perception({
                resident: { position: { x: 3228, y: 3204, level: 0 }, inventory: [item(SMALL_NET)] },
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

    it('routes a Lumbridge starter angler toward the river fishing spot when no spot is visible', () => {
        const action = starterFishingRouteAction(
            perception({
                resident: { position: { x: 3228, y: 3204, level: 0 }, inventory: [item(SMALL_NET)] },
                nearby: { npcs: [] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: LUMBRIDGE_STARTER_FISHING_SPOT,
            range: 7,
            cause: 'starter_fishing_seek_spot',
        });
    });

    it('does not path onto a known server spawn when already at bank-visible range but no spot is visible', () => {
        const action = starterFishingRouteAction(
            perception({
                resident: { position: { x: 3242, y: 3242, level: 0 }, inventory: [item(SMALL_NET)] },
                nearby: { npcs: [] },
            }),
        );

        expect(action).toEqual({
            kind: 'say',
            text: 'I am at the Lumbridge fishing water and looking for a net spot.',
            cause: 'starter_fishing_seek_spot',
        });
    });

    it('does not hijack non-Lumbridge starter anglers without a visible spot', () => {
        const action = starterFishingRouteAction(
            perception({
                resident: { position: { x: 3015, y: 3357, level: 0 }, inventory: [item(SMALL_NET)] },
                nearby: { npcs: [] },
            }),
        );

        expect(action).toBeUndefined();
    });
});

describe('buryBonesAction', () => {
    const BONES = 526;
    const BIG_BONES = 532;

    function bonesItem(itemId: number, x: number, y: number): BodyWorldItem {
        return { itemId, amount: 1, position: { x, y, level: 0 } };
    }

    it('returns an item_action "bury" when bones are in inventory', () => {
        const action = buryBonesAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(BONES)] },
            }),
        );
        expect(action).toEqual({
            kind: 'item_action',
            slot: 0,
            option: 'bury',
            cause: 'prayer_bury_bones',
        });
    });

    it('prefers inventory bury over ground pickup when both available', () => {
        const action = buryBonesAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(BONES)] },
                nearby: { worldItems: [bonesItem(BIG_BONES, 101, 100)] },
            }),
        );
        expect(action?.kind).toBe('item_action');
    });

    it('picks up bones from the ground when none are in inventory', () => {
        const ground = bonesItem(BONES, 102, 100);
        const action = buryBonesAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { worldItems: [ground] },
            }),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: ground,
            option: 'pick-up',
            cause: 'prayer_pickup_bones',
        });
    });

    it('picks the nearest of multiple ground bones', () => {
        const near = bonesItem(BONES, 101, 100);
        const far = bonesItem(BIG_BONES, 110, 100);
        const action = buryBonesAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { worldItems: [far, near] },
            }),
        );
        expect(action?.kind).toBe('interact');
        expect((action as unknown as { target: BodyWorldItem }).target).toBe(near);
    });

    it('returns undefined when no bones anywhere', () => {
        const action = buryBonesAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
            }),
        );
        expect(action).toBeUndefined();
    });
});

describe('starterFishingCookingAction', () => {
    const RAW_SHRIMP = 317;
    const RAW_ANCHOVIES = 321;
    const TINDERBOX = 590;
    const LOGS = 1511;
    const BRONZE_AXE = 1351;
    const COOKING_RANGE = 114;
    const FIRE_OBJECT = FIRE_OBJECT_ID;
    const KITCHEN_DOOR = 1530;
    const CASTLE_ENTRANCE_DOOR = 1516;
    const OPEN_CASTLE_ENTRANCE_DOOR = 1517;

    it('returns use_item_on against a heat source when raw fish is in inventory', () => {
        const heatSource = { objectId: COOKING_RANGE, position: { x: 100, y: 100, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [heatSource] },
            }),
        );
        expect(action).toEqual({
            kind: 'use_item_on',
            itemSlot: 0,
            target: heatSource,
            cause: 'starter_fishing_cook_catch',
        });
    });

    it('uses nearest heat source when multiple are visible', () => {
        const near = { objectId: COOKING_RANGE, position: { x: 101, y: 100, level: 0 } };
        const far = { objectId: FIRE_OBJECT, position: { x: 110, y: 100, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(RAW_ANCHOVIES)] },
                nearby: { objects: [far, near] },
            }),
        );
        expect((action as { target: unknown }).target).toBe(near);
    });

    it('walks around to the castle entrance before using an unreachable west kitchen door', () => {
        const range = { objectId: COOKING_RANGE, position: { x: 3212, y: 3215, level: 0 } };
        const door = { objectId: KITCHEN_DOOR, position: { x: 3208, y: 3211, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3204, y: 3213, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [range, door] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: { x: 3217, y: 3218, level: 0 },
            range: 0,
            cause: 'starter_fishing_reach_castle_entrance',
        });
    });

    it('approaches a visible castle entrance door before opening it from a distance', () => {
        const range = { objectId: COOKING_RANGE, position: { x: 3212, y: 3215, level: 0 } };
        const kitchenDoor = { objectId: KITCHEN_DOOR, position: { x: 3208, y: 3211, level: 0 } };
        const castleDoor = { objectId: CASTLE_ENTRANCE_DOOR, position: { x: 3217, y: 3218, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3204, y: 3213, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [range, kitchenDoor, castleDoor] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: castleDoor.position,
            range: 1,
            cause: 'starter_fishing_open_cooking_route',
        });
    });

    it('approaches the range when the castle entrance is already open but the range is distant', () => {
        const range = { objectId: COOKING_RANGE, position: { x: 3212, y: 3215, level: 0 } };
        const kitchenDoor = { objectId: KITCHEN_DOOR, position: { x: 3208, y: 3211, level: 0 } };
        const openCastleDoor = { objectId: OPEN_CASTLE_ENTRANCE_DOOR, position: { x: 3216, y: 3218, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3204, y: 3213, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [range, kitchenDoor, openCastleDoor] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: range.position,
            range: 1,
            cause: 'starter_fishing_find_range',
        });
    });

    it('routes southern Lumbridge range approaches through the castle entrance', () => {
        const range = { objectId: COOKING_RANGE, position: { x: 3212, y: 3215, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3209, y: 3202, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [range] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: LUMBRIDGE_CASTLE_KITCHEN_ENTRY,
            range: 0,
            cause: 'starter_fishing_reach_castle_entrance',
        });
    });

    it('does not treat a mixed open and closed castle entrance as pathable', () => {
        const range = { objectId: COOKING_RANGE, position: { x: 3212, y: 3215, level: 0 } };
        const closedCastleDoor = { objectId: CASTLE_ENTRANCE_DOOR, position: { x: 3217, y: 3218, level: 0 } };
        const openCastleDoor = { objectId: OPEN_CASTLE_ENTRANCE_DOOR, position: { x: 3216, y: 3218, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3204, y: 3213, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [range, closedCastleDoor, openCastleDoor] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: closedCastleDoor.position,
            range: 1,
            cause: 'starter_fishing_open_cooking_route',
        });
    });

    it('opens a visible kitchen door when adjacent before cooking on a distant range', () => {
        const range = { objectId: COOKING_RANGE, position: { x: 3212, y: 3215, level: 0 } };
        const door = { objectId: KITCHEN_DOOR, position: { x: 3208, y: 3211, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3207, y: 3211, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [range, door] },
            }),
        );

        expect(action).toEqual({
            kind: 'interact',
            target: door,
            option: 'open',
            cause: 'starter_fishing_open_cooking_route',
        });
    });

    it('approaches a visible cooking route door before opening it from a distance', () => {
        const range = { objectId: COOKING_RANGE, position: { x: 108, y: 100, level: 0 } };
        const door = { objectId: KITCHEN_DOOR, position: { x: 104, y: 100, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [range, door] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: door.position,
            range: 1,
            cause: 'starter_fishing_open_cooking_route',
        });
    });

    it('opens the castle entrance door when the cooking route reaches it', () => {
        const range = { objectId: COOKING_RANGE, position: { x: 3212, y: 3215, level: 0 } };
        const door = { objectId: CASTLE_ENTRANCE_DOOR, position: { x: 3217, y: 3218, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3217, y: 3218, level: 0 }, inventory: [item(RAW_SHRIMP)] },
                nearby: { objects: [range, door] },
            }),
        );

        expect(action).toEqual({
            kind: 'interact',
            target: door,
            option: 'open',
            cause: 'starter_fishing_open_cooking_route',
        });
    });

    it('falls back to lighting a cooking fire when no heat source but tinderbox+logs are carried', () => {
        const action = starterFishingCookingAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    inventory: [item(RAW_SHRIMP), item(TINDERBOX), item(LOGS)],
                },
            }),
        );
        expect(action).toEqual({
            kind: 'use_item_on_item',
            itemSlot: 1,
            targetSlot: 2,
            cause: 'starter_fishing_make_cooking_fire',
        });
    });

    it('picks up nearby logs before walking to a range when raw fish and a tinderbox are carried', () => {
        const logs = { itemId: LOGS, key: 'rs:logs', amount: 1, position: { x: 104, y: 100, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: {
                    id: 'res:qa-angler',
                    position: { x: 100, y: 100, level: 0 },
                    inventory: [item(RAW_SHRIMP), item(TINDERBOX)],
                },
                nearby: { worldItems: [logs] },
            }),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: logs,
            option: 'pick-up',
            cause: 'starter_fishing_pickup_cooking_logs',
        });
    });

    it('chops a visible tree for cooking logs before chasing a blocked range', () => {
        const tree = { objectId: 1278, position: { x: 103, y: 100, level: 0 } };
        const action = starterFishingCookingAction(
            perception({
                resident: {
                    id: 'res:qa-angler',
                    position: { x: 100, y: 100, level: 0 },
                    inventory: [item(RAW_SHRIMP), item(TINDERBOX), item(BRONZE_AXE)],
                },
                nearby: { objects: [tree] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: tree.position,
            range: 1,
            cause: 'starter_fishing_chop_cooking_logs',
        });
    });

    it('says when raw fish are carried but no heat source and no firemaking tools', () => {
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3209, y: 3213, level: 0 }, inventory: [item(RAW_SHRIMP)] },
            }),
        );
        expect(action).toEqual({
            kind: 'say',
            text: 'I have raw fish now. I need a fire or range to cook it.',
            cause: 'starter_fishing_missing_heat',
        });
    });

    it('walks toward Lumbridge Castle range when raw fish are carried without visible heat or logs', () => {
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3240, y: 3244, level: 0 }, inventory: [item(RAW_SHRIMP)] },
            }),
        );
        expect(action).toEqual({
            kind: 'move_to',
            target: LUMBRIDGE_CASTLE_RANGE,
            range: 1,
            cause: 'starter_fishing_find_range',
        });
    });

    it('routes southern fallback range approaches through the castle entrance when no heat is visible', () => {
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 3209, y: 3202, level: 0 }, inventory: [item(RAW_SHRIMP)] },
            }),
        );
        expect(action).toEqual({
            kind: 'move_to',
            target: LUMBRIDGE_CASTLE_KITCHEN_ENTRY,
            range: 0,
            cause: 'starter_fishing_reach_castle_entrance',
        });
    });

    it('returns undefined when no raw fish in inventory', () => {
        const action = starterFishingCookingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
            }),
        );
        expect(action).toBeUndefined();
    });
});

describe('opportunisticPickupAction', () => {
    const COINS = 995;
    const BONES = 526;
    const LOGS = 1511;

    function ground(itemId: number, x: number, y: number, key?: string, ownerId?: string): BodyWorldItem {
        return { itemId, amount: 1, position: { x, y, level: 0 }, key, ownerId };
    }

    it('returns "interact pick-up" when adjacent to a useful ground item with a free slot', () => {
        const coin = ground(COINS, 100, 100, 'rs:coins');
        const action = opportunisticPickupAction(
            perception({
                resident: { id: 'resident:player', position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [coin] },
            }),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: coin,
            option: 'pick-up',
            cause: 'opportunistic_pickup',
        });
    });

    it('clicks the item when out of interaction range so the game can walk and pick it up', () => {
        const coin = ground(COINS, 105, 100);
        const action = opportunisticPickupAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [coin] },
            }),
        );
        expect(action).toEqual({
            kind: 'interact',
            target: coin,
            option: 'pick-up',
            cause: 'opportunistic_pickup',
        });
    });

    it('prioritizes coins over food over logs over bones', () => {
        const coin = ground(COINS, 102, 100);
        const food = ground(99, 101, 100, 'rs:cooked_shrimp');
        const log = ground(LOGS, 100, 100);
        const bones = ground(BONES, 100, 101);
        const action = opportunisticPickupAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [bones, log, food, coin] },
            }),
        );
        // Coins win the priority tiebreaker even when further; the game interaction task handles the walk.
        expect(action?.kind).toBe('interact');
        expect((action as unknown as { target: { position: { x: number } } }).target.position.x).toBe(102);
    });

    it('skips non-food loot when low on health', () => {
        const coin = ground(COINS, 100, 100, 'rs:coins');
        const action = opportunisticPickupAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    hp: { current: 3, max: 10 },
                    inventory: [null],
                },
                nearby: { worldItems: [coin] },
            }),
        );

        expect(action).toBeUndefined();
    });

    it('only picks edible food opportunistically when low on health', () => {
        const coin = ground(COINS, 100, 100, 'rs:coins');
        const food = ground(315, 102, 100, 'rs:shrimps');
        const action = opportunisticPickupAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    hp: { current: 3, max: 10 },
                    inventory: [null],
                },
                nearby: { worldItems: [coin, food] },
            }),
        );

        expect(action).toEqual({
            kind: 'interact',
            target: food,
            option: 'pick-up',
            cause: 'opportunistic_pickup',
        });
    });

    it('skips logs when a nearby fire is present (suppress firemaking-log pickup)', () => {
        const log = ground(LOGS, 100, 100);
        const action = opportunisticPickupAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: {
                    worldItems: [log],
                    objects: [{ objectId: FIRE_OBJECT_ID, position: { x: 100, y: 100, level: 0 } }],
                },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('skips self-owned logs because they are usually stale after firemaking', () => {
        const log = ground(LOGS, 100, 100, 'rs:logs', 'player:res:agent');
        const action = opportunisticPickupAction(
            perception({
                resident: { id: 'resident:res:agent', position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [log] },
            }),
            'res:agent',
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when ground item is owned by a different actor', () => {
        const coin = ground(COINS, 100, 100, 'rs:coins', 'player:somebody-else');
        const action = opportunisticPickupAction(
            perception({
                resident: { id: 'resident:mine', position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [coin] },
            }),
            'resident:mine',
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when ground item is on cooldown', () => {
        const coin = ground(COINS, 100, 100);
        const cooldowns = { [`995::100,100,0`]: 100 };
        const action = opportunisticPickupAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [coin] },
            }),
            undefined,
            undefined,
            cooldowns,
            150,
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when ground item is on an exploration cooldown', () => {
        const coin = ground(COINS, 100, 100, 'rs:coins');
        const action = opportunisticPickupAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [coin] },
            }),
            undefined,
            undefined,
            undefined,
            150,
            { [explorationItemCooldownKey(coin)]: 100 },
        );

        expect(action).toBeUndefined();
    });

    it('respects the maxDistance filter when given', () => {
        const coin = ground(COINS, 110, 100);
        const action = opportunisticPickupAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [coin] },
            }),
            undefined,
            5,
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when inventory is full', () => {
        const inventory: Array<BodyItem | null> = Array.from({ length: 28 }, (_, i) => item(99 + i));
        const coin = ground(COINS, 100, 100);
        const action = opportunisticPickupAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory },
                nearby: { worldItems: [coin] },
            }),
        );
        expect(action).toBeUndefined();
    });
});

describe('lowHealthRecoveryAction', () => {
    const COINS = 995;

    function ground(itemId: number, x: number, y: number, key?: string, ownerId?: string): BodyWorldItem {
        return { itemId, amount: 1, position: { x, y, level: 0 }, key, ownerId };
    }

    it('eats carried food before continuing non-combat routines at low HP', () => {
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    hp: { current: 3, max: 10 },
                    inventory: [item(315, 'rs:shrimps')],
                    inCombat: false,
                },
            }),
        );

        expect(action).toEqual({ kind: 'eat', slot: 0, cause: 'low_health_eat' });
    });

    it('cooks carried raw starter fish instead of trying to eat it when low on health', () => {
        const fire = { objectId: FIRE_OBJECT_ID, position: { x: 100, y: 100, level: 0 } };
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    hp: { current: 3, max: 10 },
                    inventory: [item(317, 'rs:raw_shrimp')],
                    inCombat: false,
                },
                nearby: { objects: [fire] },
            }),
        );

        expect(action).toEqual({
            kind: 'use_item_on',
            itemSlot: 0,
            target: fire,
            cause: 'low_health_cook_food',
        });
    });

    it('retreats instead of taking a distant cooking route when hurt and threatened', () => {
        const range = { objectId: FIRE_OBJECT_ID, position: { x: 3212, y: 3215, level: 0 } };
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    id: 'resident:res:qa-guardian',
                    position: { x: 3253, y: 3230, level: 0 },
                    hp: { current: 1, max: 10 },
                    inventory: [item(317, 'rs:raw_shrimp')],
                    inCombat: false,
                },
                nearby: {
                    objects: [range],
                    npcs: [{ id: 'npc:goblin', kind: 'npc', name: 'Goblin', position: { x: 3255, y: 3230, level: 0 } }],
                },
            }),
            'res:qa-guardian',
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: { x: 3222, y: 3218, level: 0 },
            range: 6,
            cause: 'low_health_seek_safe_recovery',
        });
    });

    it('nets visible starter fish when hurt, carrying a small net, and no food is available', () => {
        const fishingSpot: BodyActor = {
            id: 'npc:fishing-spot',
            kind: 'npc',
            name: 'Fishing spot',
            position: { x: 101, y: 100, level: 0 },
        };
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    hp: { current: 3, max: 10 },
                    inventory: [item(303, 'rs:small_fishing_net')],
                    inCombat: false,
                },
                nearby: { npcs: [fishingSpot] },
            }),
        );

        expect(action).toEqual({
            kind: 'interact',
            target: fishingSpot,
            option: 'net',
            cause: 'low_health_fish_food',
        });
    });

    it('prioritizes visible ground food over coins when hurt and carrying no food', () => {
        const coins = ground(COINS, 100, 100, 'rs:coins');
        const food = ground(315, 103, 100, 'rs:shrimps');
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    id: 'resident:res:agent',
                    position: { x: 100, y: 100, level: 0 },
                    hp: { current: 3, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                nearby: { worldItems: [coins, food] },
            }),
            'res:agent',
        );

        expect(action).toEqual({
            kind: 'interact',
            target: food,
            option: 'pick-up',
            cause: 'low_health_pickup_food',
        });
    });

    it('does not treat raw ground fish as edible emergency food', () => {
        const rawFish = ground(317, 101, 100, 'rs:raw_shrimp');
        const cookedFish = ground(315, 104, 100, 'rs:shrimps');
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    id: 'resident:res:agent',
                    position: { x: 100, y: 100, level: 0 },
                    hp: { current: 3, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                nearby: { worldItems: [rawFish, cookedFish] },
            }),
            'res:agent',
        );

        expect(action).toEqual({
            kind: 'interact',
            target: cookedFish,
            option: 'pick-up',
            cause: 'low_health_pickup_food',
        });
    });

    it('walks away from goblin training when hurt, foodless, and no food source is visible', () => {
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    id: 'resident:res:qa-guardian',
                    position: { x: 3253, y: 3230, level: 0 },
                    hp: { current: 1, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                nearby: { npcs: [{ id: 'npc:goblin', kind: 'npc', name: 'Goblin', position: { x: 3255, y: 3230, level: 0 } }] },
            }),
            'res:qa-guardian',
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: { x: 3222, y: 3218, level: 0 },
            range: 6,
            cause: 'low_health_seek_safe_recovery',
        });
    });

    it('keeps walking to the recovery waypoint after leaving immediate goblin melee range', () => {
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    id: 'resident:res:qa-guardian',
                    position: { x: 3236, y: 3221, level: 0 },
                    hp: { current: 1, max: 10 },
                    inventory: [null],
                    inCombat: false,
                },
                nearby: { npcs: [{ id: 'npc:goblin', kind: 'npc', name: 'Goblin', position: { x: 3250, y: 3231, level: 0 } }] },
            }),
            'res:qa-guardian',
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: { x: 3222, y: 3218, level: 0 },
            range: 6,
            cause: 'low_health_seek_safe_recovery',
        });
    });

    it('does nothing when health is above the low-HP threshold', () => {
        const action = lowHealthRecoveryAction(
            perception({
                resident: {
                    position: { x: 100, y: 100, level: 0 },
                    hp: { current: 7, max: 10 },
                    inventory: [item(315, 'rs:shrimps')],
                },
            }),
        );

        expect(action).toBeUndefined();
    });
});

describe('prayerTrainingAction', () => {
    const BONES = 526;

    function safeNpc(name: string, x: number, y: number, id = `npc:${name}-${x}-${y}`): BodyActor {
        return {
            id,
            kind: 'npc',
            name,
            position: { x, y, level: 0 },
            hpFraction: 1,
        };
    }

    it('buries carried bones before anything else', () => {
        const action = prayerTrainingAction(
            perception({
                resident: { position: { x: 3220, y: 3220, level: 0 }, inventory: [item(BONES)] },
            }),
        );
        expect(action).toEqual({
            kind: 'item_action',
            slot: 0,
            option: 'bury',
            cause: 'prayer_bury_bones',
        });
    });

    it('attacks an adjacent safe bone-source NPC after bones are exhausted', () => {
        const chicken = safeNpc('Chicken', 3220, 3220);
        const action = prayerTrainingAction(
            perception({
                resident: { position: { x: 3220, y: 3220, level: 0 }, hp: { current: 10, max: 10 } },
                nearby: { npcs: [chicken] },
            }),
        );
        expect(action).toEqual({ kind: 'attack', target: chicken, cause: 'prayer_attack_safe_bone_source' });
    });

    it('clicks a far-away safe bone source NPC so the combat task can follow it', () => {
        const chicken = safeNpc('Chicken', 3225, 3220);
        const action = prayerTrainingAction(
            perception({
                resident: { position: { x: 3220, y: 3220, level: 0 }, hp: { current: 10, max: 10 } },
                nearby: { npcs: [chicken] },
            }),
        );
        expect(action).toEqual({ kind: 'attack', target: chicken, cause: 'prayer_attack_safe_bone_source' });
    });

    it('prefers low-risk bone source over a higher-risk one even when slightly farther', () => {
        const goblin = safeNpc('Goblin', 3221, 3220);
        const chicken = safeNpc('Chicken', 3222, 3220);
        const action = prayerTrainingAction(
            perception({
                resident: { position: { x: 3220, y: 3220, level: 0 }, hp: { current: 10, max: 10 } },
                nearby: { npcs: [goblin, chicken] },
            }),
        );
        expect(action?.kind).toBe('attack');
        expect((action as unknown as { target: { position: { x: number } } }).target.position.x).toBe(3222);
    });

    it('returns a move-to-waypoint when no safe source nearby and far from waypoint', () => {
        const action = prayerTrainingAction(
            perception({
                resident: { position: { x: 3000, y: 3000, level: 0 }, hp: { current: 10, max: 10 } },
                nearby: { npcs: [] },
            }),
        );
        expect(action).toEqual({
            kind: 'move_to',
            target: { x: 3222, y: 3218, level: 0 },
            range: 6,
            cause: 'prayer_seek_safe_bone_source',
        });
    });

    it('returns undefined when at the waypoint with no safe source visible (do not flap)', () => {
        const action = prayerTrainingAction(
            perception({
                resident: { position: { x: 3222, y: 3218, level: 0 }, hp: { current: 10, max: 10 } },
                nearby: { npcs: [] },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('returns undefined when below low-health threshold', () => {
        const action = prayerTrainingAction(
            perception({
                resident: { position: { x: 3220, y: 3220, level: 0 }, hp: { current: 2, max: 10 } },
                nearby: { npcs: [safeNpc('Chicken', 3220, 3220)] },
            }),
        );
        expect(action).toBeUndefined();
    });
});

describe('combatLootOrPrayerAction', () => {
    const BONES = 526;
    const COINS = 995;

    it('buries bones looted during combat before pickup considerations', () => {
        const action = combatLootOrPrayerAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(BONES)] },
            }),
        );
        expect(action).toEqual({
            kind: 'item_action',
            slot: 0,
            option: 'bury',
            cause: 'combat_bury_looted_bones',
        });
    });

    it('picks up nearby loot inside the combat radius (re-cause stamps "combat_loot_pickup")', () => {
        const coin: BodyWorldItem = { itemId: COINS, amount: 1, position: { x: 102, y: 100, level: 0 } };
        const action = combatLootOrPrayerAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [coin] },
            }),
        );
        expect(action?.cause).toBe('combat_loot_pickup');
    });

    it('returns undefined when nothing is in inventory and no loot inside the combat radius', () => {
        // place a coin OUTSIDE the COMBAT_LOOT_MAX_DISTANCE radius (6 tiles)
        const farCoin: BodyWorldItem = { itemId: COINS, amount: 1, position: { x: 110, y: 100, level: 0 } };
        const action = combatLootOrPrayerAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [null] },
                nearby: { worldItems: [farCoin] },
            }),
        );
        expect(action).toBeUndefined();
    });
});

describe('combatTrainingAction', () => {
    const COOKED_SHRIMP_KEY = 'rs:cooked_shrimp';

    function combatNpc(name: string, x: number, y: number): BodyActor {
        return {
            id: `npc:${name}-${x}-${y}`,
            kind: 'npc',
            name,
            position: { x, y, level: 0 },
            hpFraction: 1,
        };
    }

    it('attacks an adjacent safe combat target when healthy', () => {
        const chicken = combatNpc('Chicken', 3220, 3220);
        const action = combatTrainingAction(
            perception({
                resident: { position: { x: 3220, y: 3220, level: 0 }, hp: { current: 10, max: 10 }, inventory: [] },
                nearby: { npcs: [chicken] },
            }),
        );
        expect(action).toEqual({ kind: 'attack', target: chicken, cause: 'combat_attack_safe_target' });
    });

    it('eats food when low on HP and food is carried', () => {
        const action = combatTrainingAction(
            perception({
                resident: {
                    position: { x: 3220, y: 3220, level: 0 },
                    hp: { current: 2, max: 10 },
                    inventory: [item(7946, COOKED_SHRIMP_KEY)],
                },
            }),
        );
        expect(action).toEqual({ kind: 'eat', slot: 0, cause: 'combat_eat_before_training' });
    });

    it('says "too hurt" when low on HP and no food carried', () => {
        const action = combatTrainingAction(
            perception({
                resident: { position: { x: 3220, y: 3220, level: 0 }, hp: { current: 2, max: 10 }, inventory: [] },
            }),
        );
        expect(action).toEqual({
            kind: 'say',
            text: 'I am too hurt to start combat without food. I need to heal or get food first.',
        });
    });

    it('seeks a fixed waypoint when no safe target is in sight and resident is far away', () => {
        const action = combatTrainingAction(
            perception({
                resident: { position: { x: 3000, y: 3000, level: 0 }, hp: { current: 10, max: 10 }, inventory: [] },
                nearby: { npcs: [] },
            }),
        );
        expect(action).toEqual({
            kind: 'move_to',
            target: { x: 3222, y: 3218, level: 0 },
            range: 6,
            cause: 'combat_seek_safe_target',
        });
    });

    it('returns undefined when resident has no position', () => {
        const action = combatTrainingAction(
            perception({
                resident: { position: undefined, hp: { current: 10, max: 10 }, inventory: [] },
                nearby: { npcs: [combatNpc('Chicken', 3220, 3220)] },
            }),
        );
        expect(action).toBeUndefined();
    });

    it('clicks a non-adjacent safe combat target so the combat task can follow it', () => {
        const chicken = combatNpc('Chicken', 3225, 3220);
        const action = combatTrainingAction(
            perception({
                resident: { position: { x: 3220, y: 3220, level: 0 }, hp: { current: 10, max: 10 }, inventory: [] },
                nearby: { npcs: [chicken] },
            }),
        );
        expect(action).toEqual({ kind: 'attack', target: chicken, cause: 'combat_attack_safe_target' });
    });
});

describe('explorationAction', () => {
    function npc(name: string, x: number, y: number, id = `npc:${name}-${x}-${y}`): BodyActor {
        return { id, kind: 'npc', name, position: { x, y, level: 0 }, hpFraction: 1 };
    }

    it('returns an "interact talk-to" against an uncooldowned adjacent NPC', () => {
        const guide = npc('RuneScape Guide', 100, 100);
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [guide] },
            }),
        );
        expect(action).toEqual({ kind: 'interact', target: guide, option: 'talk-to', cause: 'explore_talk_to_npc' });
    });

    it('moves toward a far-away NPC instead of talking', () => {
        const guide = npc('RuneScape Guide', 105, 100);
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [guide] },
            }),
        );
        expect(action).toEqual({ kind: 'move_to', target: guide.position, range: 1, cause: 'explore_talk_to_npc' });
    });

    it('does not chase fishing spots as exploration conversation targets', () => {
        const fishingSpot = npc('Fishing spot', 105, 100);
        const fountain = { objectId: 879, position: { x: 103, y: 100, level: 0 } };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [fishingSpot], objects: [fountain] },
            }),
        );
        expect(action).toEqual({ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' });
    });

    it('skips NPC families that are already on the exploration cooldown', () => {
        const sheep = { ...npc('Sheep', 101, 100), key: 'rs:sheep' };
        const fountain = { objectId: 879, position: { x: 103, y: 100, level: 0 } };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [sheep], objects: [fountain] },
            }),
            undefined,
            undefined,
            undefined,
            150,
            { 'npc-key:rs:sheep': 100 },
        );

        expect(action).toEqual({ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' });
    });

    it('moves toward a visible landmark when no NPC is nearby', () => {
        const fountain = { objectId: 879, position: { x: 105, y: 100, level: 0 } };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [fountain] },
            }),
        );
        expect(action).toEqual({ kind: 'move_to', target: fountain.position, range: 2, cause: 'explore_visible_object' });
    });

    it('uses a visible tree stand as a scouting destination instead of a tiny patrol hop', () => {
        const nearbyTree = { objectId: objectIds.tree.normal[0].default, position: { x: 101, y: 100, level: 0 } };
        const distantTree = { objectId: objectIds.tree.normal[0].default, position: { x: 112, y: 100, level: 0 } };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [nearbyTree, distantTree] },
            }),
        );
        expect(action).toEqual({ kind: 'move_to', target: distantTree.position, range: 2, cause: 'explore_tree_stand' });
    });

    it('uses higher-level trees as scouting landmarks without turning them into woodcutting targets', () => {
        const oak = { objectId: objectIds.tree.oak[0].default, position: { x: 108, y: 100, level: 0 } };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [oak] },
            }),
        );
        expect(action).toEqual({ kind: 'move_to', target: oak.position, range: 2, cause: 'explore_tree_stand' });
    });

    it('prioritizes moving toward openable gates over nearby generic scenery while exploring', () => {
        const nearbyScenery = { objectId: 4735, position: { x: 105, y: 100, level: 0 } };
        const gate = { objectId: 11993, position: { x: 107, y: 102, level: 0 }, orientation: 1 };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [nearbyScenery, gate] },
            }),
        );
        expect(action).toEqual({ kind: 'move_to', target: gate.position, range: 1, cause: 'explore_open_obstacle' });
    });

    it('can skip brittle openable gates during autonomous scouting', () => {
        const nearbyScenery = { objectId: 4735, position: { x: 105, y: 100, level: 0 } };
        const gate = { objectId: 11993, position: { x: 101, y: 100, level: 0 }, orientation: 1 };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [nearbyScenery, gate] },
            }),
            undefined,
            undefined,
            undefined,
            200,
            undefined,
            { interactWithOpenables: false },
        );
        expect(action).toEqual({ kind: 'move_to', target: nearbyScenery.position, range: 2, cause: 'explore_visible_object' });
    });

    it('opens an adjacent gate while exploring instead of patrolling around it', () => {
        const gate = { objectId: 11993, position: { x: 101, y: 100, level: 0 }, orientation: 1 };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [gate] },
            }),
        );
        expect(action).toEqual({ kind: 'interact', target: gate, option: 'open', cause: 'explore_open_obstacle' });
    });

    it('still opens an adjacent gate after its approach tile was visited', () => {
        const gate = { objectId: 11993, position: { x: 101, y: 100, level: 0 }, orientation: 1 };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [gate] },
            }),
            undefined,
            undefined,
            undefined,
            200,
            { [explorationPatrolCooldownKey(gate.position)]: 199 },
        );

        expect(action).toEqual({ kind: 'interact', target: gate, option: 'open', cause: 'explore_open_obstacle' });
    });

    it('skips a gate when the object is cooling down from a blocked scouting attempt', () => {
        const nearbyScenery = { objectId: 4735, position: { x: 105, y: 100, level: 0 } };
        const gate = { objectId: 11993, position: { x: 107, y: 102, level: 0 }, orientation: 1 };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [nearbyScenery, gate] },
            }),
            undefined,
            undefined,
            undefined,
            200,
            { [explorationObjectCooldownKey(gate)]: 49 },
        );

        expect(action).toEqual({ kind: 'move_to', target: nearbyScenery.position, range: 2, cause: 'explore_visible_object' });
    });

    it('falls back to patrol when nothing is in sight (moves to a non-here patrol position)', () => {
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [], worldItems: [] },
            }),
            undefined,
            undefined,
            undefined,
            5,
        );
        expect(action?.kind).toBe('move_to');
        expect(action?.cause).toBe('explore_patrol');
    });

    it('avoids recently visited patrol targets while scouting', () => {
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [], worldItems: [] },
            }),
            undefined,
            undefined,
            undefined,
            5,
            { 'patrol:103,100,0': 0 },
        );

        expect(action).toEqual({ kind: 'move_to', target: { x: 100, y: 103, level: 0 }, range: 1, cause: 'explore_patrol' });
    });

    it('does not patrol onto a visibly object-occupied tile', () => {
        const nearbyScenery = { objectId: 879, position: { x: 101, y: 100, level: 0 } };
        const blockedTile = { objectId: 4735, position: { x: 103, y: 100, level: 0 } };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [nearbyScenery, blockedTile], worldItems: [] },
            }),
            undefined,
            undefined,
            undefined,
            5,
        );

        expect(action).toEqual({ kind: 'move_to', target: { x: 100, y: 103, level: 0 }, range: 1, cause: 'explore_patrol' });
    });

    it('expands patrol radius when nearby patrol targets are all on cooldown', () => {
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [], worldItems: [] },
            }),
            undefined,
            undefined,
            undefined,
            50,
            {
                'patrol:103,100,0': 49,
                'patrol:100,103,0': 49,
                'patrol:97,100,0': 49,
                'patrol:100,97,0': 49,
            },
        );

        expect(action?.kind).toBe('move_to');
        const target = (action as { target?: { x: number; y: number } } | undefined)?.target;
        expect(target).toBeDefined();
        expect(Math.max(Math.abs(Number(target?.x) - 100), Math.abs(Number(target?.y) - 100))).toBeGreaterThan(3);
    });

    it('skips an NPC that is on exploration cooldown', () => {
        const guide = npc('RuneScape Guide', 100, 100);
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [guide] },
            }),
            undefined,
            undefined,
            undefined,
            5,
            { [`npc:${guide.id}`]: 0 },
        );
        // No NPCs/objects/items remain after cooldown filter — falls back to patrol
        expect(action?.cause).toBe('explore_patrol');
    });

    it('reports a visible item label adjacent to the resident', () => {
        const coin: BodyWorldItem = { itemId: 995, key: 'rs:coins', amount: 5, position: { x: 100, y: 100, level: 0 } };
        const action = explorationAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [] },
                nearby: { npcs: [], objects: [], worldItems: [coin] },
            }),
        );
        // Coins are useful so opportunistic pickup wins first; verify cause string family.
        expect(['opportunistic_pickup', 'explore_visible_item']).toContain(action?.cause);
    });

    it('returns undefined when resident has no position', () => {
        const action = explorationAction(perception({ resident: { position: undefined, inventory: [] } }));
        expect(action).toBeUndefined();
    });
});
