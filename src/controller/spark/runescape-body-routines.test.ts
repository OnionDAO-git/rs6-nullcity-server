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
    firemakingAction,
    LUMBRIDGE_CASTLE_RANGE,
    levelOneWoodcuttingAction,
    opportunisticPickupAction,
    prayerTrainingAction,
    starterFishingAction,
    starterFishingCookingAction,
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

    it('moves into interaction range before netting a distant fishing spot', () => {
        const spot = fishingSpot(102, 100);
        const action = starterFishingAction(
            perception({
                resident: { position: { x: 100, y: 100, level: 0 }, inventory: [item(SMALL_NET)] },
                nearby: { npcs: [spot] },
            }),
        );

        expect(action).toEqual({
            kind: 'move_to',
            target: spot.position,
            range: 1,
            cause: 'starter_fishing_approach',
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
    const COOKING_RANGE = 114;
    const FIRE_OBJECT = FIRE_OBJECT_ID;

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
            range: 4,
            cause: 'starter_fishing_find_range',
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
